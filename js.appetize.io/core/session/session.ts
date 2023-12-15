import {
    LiteralUnion,
    OmitUnion,
    createDeferredPromise,
    uuid,
} from '../../core/util';
import {
    WaitForEventOptions,
    waitFor,
    waitForEvent,
    waitForTimeout,
} from '../../core/waitFor';
import { EventEmitter } from '../EventEmitter';

import { InternalAPIMapper, PublicAPIMapper } from '../api/mapper';
import {
    Action,
    Element,
    ElementSelector,
    FindElementsAction,
    InternalRecorderAPI,
    PlayActionErrorResponse,
    PlayActionOptions,
    PlayActionResult,
    RecordedAction,
    SwipeAction,
    TapAction,
} from '../api/recorder';
import { AllUI } from '../api/recorder/public';
import { AppetizeApp } from '../api/types';
import { validateElementAttributes } from '../api/util';
import { uint8ArrayToBase64 } from '../buffer';
import { SwipeGesture } from '../builders/swipe-gesture';
import { DeviceInfo } from '../client';
import {
    ActionAmbiguousElementError,
    ActionElementNotFoundError,
    ActionError,
    ActionInternalError,
    ActionInvalidArgumentError,
    ActionTimeoutError,
    OperationalError,
    RecorderRequiredError,
    TimeoutError,
    captureOperationalError,
} from '../errors';
import { Logger } from '../logger';
import { SocketProtocol } from '../socket';

export interface SessionArgs {
    path: string;
    token: string;
    socket: SocketProtocol;
    config: SessionConfig;
    device: DeviceInfo;
    logger: Logger;
    app?: AppetizeApp;
}
export class Session<
    Events extends SessionEvents = SessionEvents
> extends EventEmitter {
    socket: SocketProtocol;
    logger: Logger;

    path: string;
    token: string;

    app?: AppetizeApp;
    device: DeviceInfo;
    config: SessionConfig;
    #adbConnection?: AdbConnectionInfo;
    #networkInspectorUrl?: string;

    /**
     * Session is ending due to session.end()
     */
    protected isEndingManually = false;

    /**
     * Countdown warning due to inactivity has been received
     */
    protected countdownWarning = false;

    protected ready = false;

    private _waitForAnimationsPromises: Set<Promise<void>> = new Set();

    constructor({
        socket,
        config,
        path,
        token,
        app,
        device,
        logger = new Logger(),
    }: SessionArgs) {
        super();
        this.config = config;
        this.socket = socket;
        this.device = device;
        this.app = app;
        this.path = path;
        this.token = token;
        this.logger = logger;

        const handleSocketEvent = ({ type, value }) => {
            const publicApiMapper = new PublicAPIMapper({
                platform: this.config.platform!,
                screen: this.device.screen,
                app: this.app,
            });
            const event = publicApiMapper.mapAppetizerEvent(type, value);

            switch (type) {
                case 'ready':
                    this.ready = true;
                    break;
                case 'adbOverTcp': {
                    this.#adbConnection = {
                        ...value,
                        command: getAdbShellCommand(value),
                    };
                    break;
                }
                case 'networkInspectorUrl':
                    this.#networkInspectorUrl = value;
                    break;
                case 'countdownWarning':
                    this.countdownWarning = true;
                    break;
                case 'timeoutReset':
                    this.countdownWarning = false;
                    break;
                case 'deviceInfo':
                    this.device = value;
                    break;
            }

            if (event) {
                this.emit(event.type, event.value);
                this.emit('*', event);
            } else if (event !== null) {
                this.emit(type, value);
                this.emit('*', { type, value });
            }
        };

        this.socket.on('*', handleSocketEvent);

        /**
         * remove socket event handler on disconnect
         *
         * this is important for embed/playwright, where the "socket" is
         * a connection to the iframe. if the session ends, the iframe/page may still
         * exist, so we need to "disconnect" this session instance from future postMessages.
         * otherwise, event listeners on the "old" session will fire.
         */
        this.on('disconnect' as Extract<keyof Events, string>, () => {
            this.socket.off('*', handleSocketEvent);

            if (!this.isEndingManually) {
                if (this.countdownWarning) {
                    this.logger.warn(
                        `Appetize session has ended due to inactivity`
                    );
                } else {
                    this.logger.warn(`Session disconnected`);
                }
            }
        });
    }

    on<K extends Extract<keyof Events, string>>(
        event: K,
        listener: (value: Events[K]) => void
    ): this {
        if (event === 'network' && this.config.proxy !== 'intercept') {
            this.logger.warn(
                'Session must be configured with `proxy: "intercept"` to listen to network events.'
            );
        }

        if (event === 'log' && this.config.debug !== true) {
            this.logger.warn(
                'Session must be configured with `debug: true` to listen to log events.'
            );
        }

        if (event === 'action' && this.config.record !== true) {
            this.logger.warn(
                'Session must configured with `record: true` to listen to action events.'
            );
        }

        return super.on(event, listener);
    }

    async waitUntilReady() {
        let isConnected = true;

        // we would like certain properties to be defined on the session before we resolve,
        // but we don't want to block the session from starting if not. so we wait a max of 3s
        const waitForValue = async (cb: () => boolean) => {
            return new Promise((res) => {
                const interval = setInterval(() => {
                    if (cb()) {
                        res(undefined);
                    }
                }, 10);

                setTimeout(() => {
                    clearInterval(interval);
                    res(undefined);
                }, 3000);
            });
        };

        const handleDisconnect = () => {
            isConnected = false;
        };

        this.socket.once('disconnect', handleDisconnect);

        // we could be at 'switching device' state, which if we're running against a single server
        // can take a long time when it's under load, so we give it a generous timeout
        try {
            await waitFor((bail) => {
                if (this.ready) {
                    return;
                }

                if (isConnected) {
                    throw new TimeoutError(
                        'Timed out after 180s waiting for session to be ready'
                    );
                } else {
                    bail(new Error('Session disconnected'));
                }
            }, 180000);
        } finally {
            this.socket.off('disconnect', handleDisconnect);
        }

        // wait for properties
        await Promise.all([
            this.config.proxy === 'intercept'
                ? waitForValue(() => Boolean(this.#networkInspectorUrl))
                : Promise.resolve(),
            this.config.enableAdb
                ? waitForValue(() => Boolean(this.#adbConnection))
                : Promise.resolve(),
        ]);
    }

    async waitForEvent<K extends keyof SessionEvents>(
        event: K,
        options?: WaitForEventOptions<SessionEvents[K]>
    ) {
        try {
            return await waitForEvent(this, event, options);
        } catch (e) {
            captureOperationalError(e, this.waitForEvent);
            throw e;
        }
    }

    /**
     * Ends the current session
     */
    async end() {
        this.isEndingManually = true;
        await this.socket.disconnect();
    }

    get networkInspectorUrl() {
        if (this.config.proxy !== 'intercept') {
            this.logger.warn(
                'Session must be configured with `proxy: "intercept"` to use the network inspector'
            );
        }

        return this.#networkInspectorUrl;
    }

    get adbConnection() {
        if (this.config.platform && this.config.platform !== 'android') {
            this.logger.warn(
                'Session must be connected to an Android device to use adb'
            );
        }

        if (!this.config.enableAdb) {
            this.logger.warn(
                'Session must be configured with `enableAdb: true` to use adb'
            );
        }

        if (this.#adbConnection) {
            return this.#adbConnection;
        }
    }

    /**
     * Rotates the device left or right by 90 degrees
     */

    async rotate(
        direction: 'left' | 'right'
    ): Promise<'portrait' | 'landscape'> {
        try {
            const [orientation] = await Promise.all([
                this.waitForEvent('orientationChanged'),
                this.socket.send('userInteraction', {
                    type: 'keypress',
                    key: direction === 'left' ? 'rotateLeft' : 'rotateRight',
                    timeStamp: Date.now(),
                }),
            ]);

            return orientation;
        } catch (e) {
            captureOperationalError(e, this.rotate);
            throw e;
        }
    }

    /**
     * Takes a screenshot of the device. Format returned can be either 'buffer' or 'base64'.
     *
     * If buffer format is requested on browser and Buffer is not polyfilled the result will be a Uint8Array.
     */
    async screenshot<
        T extends 'buffer' | 'base64',
        Data = T extends 'buffer' ? Buffer : string
    >(
        format: T = 'buffer' as T
    ): Promise<{
        data: Data;
        mimeType: string;
    }> {
        try {
            this.socket.send('getScreenshot', {});

            const result = await waitForEvent<{
                data: Uint8Array;
                success: boolean;
                mimeType: string;
                error?: string;
            }>(this.socket, 'screenshot', { timeout: 60000 });

            if (!result.success) {
                throw new OperationalError(result.error ?? `Screenshot failed`);
            }

            // if on Node, convert to buffer. otherwise leave as Uint8Array
            const toBuffer = (data: Uint8Array) => {
                return typeof window === 'undefined' ? Buffer.from(data) : data;
            };

            const data =
                format === 'buffer'
                    ? (toBuffer(result.data) as unknown as Data)
                    : (uint8ArrayToBase64(
                          new Uint8Array(result.data),
                          result.mimeType
                      ) as unknown as Data);

            return {
                data,
                mimeType: result.mimeType,
            };
        } catch (e) {
            captureOperationalError(e, this.screenshot);
            throw e;
        }
    }

    /**
     * Sends a heartbeat to the appetize server. This will reset the inactivity timer.
     **/
    async heartbeat() {
        try {
            return await this.socket.send('heartbeat');
        } catch (e) {
            captureOperationalError(e, this.heartbeat);
            throw e;
        }
    }

    /**
     * Types the given text
     */
    async type(text: string) {
        try {
            // on both iOS and Android, if a type comes after a tap on an input,
            // there seems to be a necessary delay for accurate typing.
            // TODO: a better solution here would be to track whether or not a tap was
            // the last action, and if so, do this wait.
            await waitForTimeout(1000);

            const result = await this.playAction({
                type: 'typeText',
                text: text,
            });

            // incase the user is tapping on an input next, wait an additional 500ms
            await waitForTimeout(500);

            return result;
        } catch (e) {
            captureOperationalError(e, this.type);
            throw e;
        }
    }

    /**
     * Sends a keypress event to the device.
     */
    async keypress(key: KeyValue, options?: { shift?: boolean }) {
        try {
            // temporary, until backend can emit this as a keypress
            if (key === 'ANDROID_KEYCODE_MENU') {
                return await this.socket.send('androidKeycodeMenu');
            }

            // if shift, we need to use legacy keypress api
            // character: 'HOME' not supported on android, will fix later.
            if (options?.shift || key === 'HOME') {
                switch (key) {
                    case 'ArrowUp':
                        key = 'arrowUp';
                        break;
                    case 'ArrowDown':
                        key = 'arrowDown';
                        break;
                    case 'ArrowLeft':
                        key = 'arrowLeft';
                        break;
                    case 'ArrowRight':
                        key = 'arrowRight';
                        break;
                    case 'Enter':
                        key = '\r';
                        break;
                    case 'Tab':
                        key = '\t';
                        break;
                    case 'Backspace':
                        key = '\b';
                        break;
                }

                return this.playAction({
                    type: 'keypress',
                    key,
                    shiftKey: !!options?.shift,
                });
            } else {
                return this.playAction({
                    type: 'keypress',
                    character: key,
                });
            }
        } catch (e) {
            captureOperationalError(e, this.keypress);
            throw e;
        }
    }

    /**
     * Sets the language and restarts the app
     */
    async setLanguage(language: string) {
        try {
            this.config.language = language;
            return await this.socket.send('setLanguage', {
                language,
                timeStamp: Date.now(),
            });
        } catch (e) {
            captureOperationalError(e, this.setLanguage);
            throw e;
        }
    }

    /**
     * Sets the location with the given latitude and longitude
     */
    async setLocation(latitude: number, longitude: number) {
        try {
            if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                throw new OperationalError(
                    `setLocation requires latitude and longitude to be numbers`
                );
            }

            const location = [latitude, longitude];
            this.config.location = location;

            return await this.socket.send('setLocation', {
                location: location,
                timeStamp: Date.now(),
            });
        } catch (e) {
            captureOperationalError(e, this.setLocation);
            throw e;
        }
    }

    /**
     * Opens a deep-link or regular URL
     */
    async openUrl(url: string) {
        try {
            return await this.socket.send('openUrl', {
                url: url,
                timeStamp: Date.now(),
            });
        } catch (e) {
            captureOperationalError(e, this.openUrl);
            throw e;
        }
    }

    /**
     * Sends shake gesture (iOS only)
     */
    async shake() {
        try {
            return await this.socket.send('shakeDevice');
        } catch (e) {
            captureOperationalError(e, this.swipe);
            throw e;
        }
    }

    async toggleSoftKeyboard() {
        try {
            if (this.config.platform !== 'ios') {
                throw new Error(
                    'toggleSoftKeyboard is only available on iOS devices'
                );
            }
            return await this.socket.send('toggleSoftKeyboard');
        } catch (e) {
            captureOperationalError(e, this.toggleSoftKeyboard);
            throw e;
        }
    }

    /**
     * Simulate a matching fingerprint (Android 8+ only)
     */
    async biometry({ match }: { match: boolean }) {
        try {
            return await this.socket.send(
                match ? 'biometryMatch' : 'biometryNoMatch'
            );
        } catch (e) {
            captureOperationalError(e, this.biometry);
            throw e;
        }
    }

    /**
     * Whether or not to allow interactions from the user on the device
     */
    async allowInteractions(allow: boolean): Promise<void> {
        try {
            return await this.socket.send(
                allow ? 'enableInteractions' : 'disableInteractions'
            );
        } catch (e) {
            captureOperationalError(e, this.allowInteractions);
            throw e;
        }
    }

    /**
     * Restarts the app
     */
    async restartApp() {
        try {
            this.socket.send('restartApp');

            const { platform } = this.config;

            if (platform === 'ios') {
                await this.waitForEvent('appLaunch', { timeout: 60000 });
            } else {
                await waitForTimeout(1000);
            }
        } catch (e) {
            captureOperationalError(e, this.restartApp);
            throw e;
        }
    }

    /**
     * Reinstalls the app
     */
    async reinstallApp() {
        try {
            this.socket.send('reinstallApp');

            await this.waitForEvent('appLaunch', { timeout: 60000 });
        } catch (e) {
            captureOperationalError(e, this.reinstallApp);
            throw e;
        }
    }

    async adbShellCommand(command: string) {
        if (this.config.platform !== 'android') {
            throw new Error(
                'adbShellCommand is only available on Android devices'
            );
        }

        try {
            return await this.socket.send('adbShellCommand', {
                command,
                timeStamp: Date.now(),
            });
        } catch (e) {
            captureOperationalError(e, this.adbShellCommand);
            throw e;
        }
    }

    async playAction<T extends Action | RecordedAction>(
        action: T,
        options: PlayActionOptions<T> = {}
    ): Promise<PlayActionResult<T>> {
        const { timeout = 10000 } = options;

        /**
         *  appetizer has a max timeout of 10s per playAction
         */
        const MAX_APP_RECORDER_TIMEOUT = 10000;

        /**
         * the longest we'll wait for appetizer to respond before throwing a timeout error.
         * this is to prevent the session from hanging if the server doesn't respond
         * (it's possible the server is slow, so it's generous)
         *
         * this can cause playAction() to run for up to this value past options.timeout, but it's
         * better than hanging forever or timing out too early.
         */
        const MAX_WAIT_FOR_RESPONSE = timeout + 10000;

        try {
            if (!this.config.record) {
                throw new RecorderRequiredError('playAction()');
            }

            if (isNaN(timeout)) {
                throw new OperationalError(
                    `Invalid timeout value: ${options.timeout}`
                );
            }

            if (timeout < 0) {
                throw new OperationalError(
                    `Timeout value cannot be negative: ${options.timeout}`
                );
            }

            if ('element' in action && action.element) {
                validateElementAttributes(action.element);
            }

            const mapper = new InternalAPIMapper({
                platform: this.config.platform!,
                screen: this.device.screen,
                app: this.app,
            });

            const noMap = (options as any).noMap; // for internal debug, not a public option

            const mappedAction = noMap
                ? (action as InternalRecorderAPI.Action)
                : mapper.mapAction(action);

            const payload = {
                id: uuid(),
                action: mappedAction,
                options: {
                    ...options,
                    timeout: Math.round(
                        // appetizer has a max timeout of 10s per playAction event
                        // (we will keep retrying until we use up the full timeout)
                        Math.min(timeout, MAX_APP_RECORDER_TIMEOUT) / 1000
                    ),
                },
            };

            try {
                const result = await new Promise<PlayActionResult<T>>(
                    (resolve, reject) => {
                        // set a hard timeout for incase the server doesn't respond within API_MAX_TIMEOUT
                        const hardTimeout = setTimeout(() => {
                            cleanup();
                            reject(
                                new ActionTimeoutError(
                                    {
                                        id: payload.id,
                                        action: action as Action,
                                        timeout: payload.options.timeout,
                                    },
                                    `Timed out waiting for response from device`
                                )
                            );
                        }, MAX_WAIT_FOR_RESPONSE);

                        const cleanup = () => {
                            this.off('playbackFoundAndSent', handleSuccess);
                            this.off('playbackError', handleError);
                            clearTimeout(hardTimeout);
                        };

                        const handleSuccess = async (
                            value: PlayActionResult<any>
                        ) => {
                            if (value.playback?.id !== payload.id) return;

                            cleanup();
                            resolve(value);
                        };

                        const handleError = async (
                            error: PlayActionErrorResponse<Action>
                        ) => {
                            if (error.playback?.id !== payload.id) return;

                            cleanup();

                            switch (error.errorId) {
                                case 'internalError':
                                    reject(new ActionInternalError(error));
                                    break;
                                case 'notFound': {
                                    reject(
                                        new ActionElementNotFoundError(error)
                                    );
                                    break;
                                }
                                case 'ambiguousMatch':
                                    reject(
                                        new ActionAmbiguousElementError(error)
                                    );
                                    break;
                                case 'invalidArgument': {
                                    reject(
                                        new ActionInvalidArgumentError(error)
                                    );
                                    break;
                                }
                                default:
                                    reject(new ActionError(error));
                                    break;
                            }
                        };

                        this.on('playbackFoundAndSent' as any, handleSuccess);
                        this.on('playbackError' as any, handleError);
                        this.socket.send('playAction', payload);
                    }
                );

                return result;
            } catch (e) {
                const remainingTimeout = Math.max(
                    0,
                    timeout - MAX_APP_RECORDER_TIMEOUT
                );

                // if not an internal or hard timeout error, try again until timeout elapsed
                if (
                    remainingTimeout > 0 &&
                    !(e instanceof ActionTimeoutError) &&
                    !(e instanceof ActionInternalError)
                ) {
                    return await this.playAction(action, {
                        ...options,
                        timeout: remainingTimeout,
                    });
                }

                throw e;
            }
        } catch (e) {
            captureOperationalError(e, this.playAction);
            throw e;
        }
    }

    async playActions<T extends Action | RecordedAction>(
        actions: T[],
        options: PlayActionOptions<any> = {}
    ) {
        try {
            if (!this.config.record) {
                throw new RecorderRequiredError('playActions()');
            }

            const results: PlayActionResult<any>[] = [];

            for (const action of actions) {
                const result = await this.playAction(action, options);

                results.push(result);

                const nextAction = actions[actions.indexOf(action) + 1];

                const isConsecutiveKeypress =
                    nextAction &&
                    nextAction.type === 'keypress' &&
                    action.type === 'keypress';

                // wait between each action unless we are playing back consecutive keypresses
                if (!isConsecutiveKeypress) {
                    // wait for animations to settle on screen for up to 2s
                    await this.waitForAnimations({ timeout: 2000 }).catch(
                        () => {
                            // no-op - continue if animations haven't settled yet
                        }
                    );
                }
            }

            return results;
        } catch (e) {
            captureOperationalError(e, this.playActions);
            throw e;
        }
    }

    async getUI({
        timeout = 30000,
    }: {
        timeout?: number;
    } = {}) {
        try {
            this.socket.send('dumpUi');

            const data = await waitForEvent<AllUI>(this, 'uiDump', {
                timeout,
            });

            return data;
        } catch (e) {
            captureOperationalError(e, this.getUI);
            throw e;
        }
    }

    async findElement(
        element: ElementSelector,
        options?: PlayActionOptions<FindElementsAction> &
            Pick<FindElementsAction, 'appId'>
    ): Promise<Element | undefined> {
        try {
            const result = await this.playAction(
                {
                    type: 'findElements',
                    element,
                    appId: options?.appId,
                },
                options
            );

            return result.matchedElements?.[0];
        } catch (e) {
            captureOperationalError(e, this.findElement);
            throw e;
        }
    }

    async findElements(
        element: ElementSelector,
        options?: PlayActionOptions<FindElementsAction> &
            Pick<FindElementsAction, 'appId'>
    ) {
        try {
            const result = await this.playAction(
                {
                    type: 'findElements',
                    element,
                    appId: options?.appId,
                },
                options
            );

            return result.matchedElements;
        } catch (e) {
            captureOperationalError(e, this.findElements);
            throw e;
        }
    }

    /**
     * Taps on the screen
     */
    async tap(
        args: OmitUnion<TapAction, 'type' | 'id'>,
        options?: PlayActionOptions<TapAction>
    ) {
        try {
            if (!this.config.record) {
                throw new RecorderRequiredError('tap()');
            }
            return await this.playAction(
                {
                    type: 'tap',
                    ...args,
                    duration: (args.duration ?? 0) / 1000,
                },
                options
            );
        } catch (e) {
            captureOperationalError(e, this.tap);
            throw e;
        }
    }

    /**
     * Swipes on the screen
     */
    async swipe(
        { duration, gesture, ...args }: SwipeArgs,
        options?: PlayActionOptions<SwipeAction>
    ) {
        try {
            if (!this.config.record) {
                throw new RecorderRequiredError('swipe()');
            }

            let action: SwipeAction;
            const g = new SwipeGesture({
                duration,
                // @ts-expect-error - experimental api option
                stepDuration: args.stepDuration,
            });

            if (typeof gesture === 'function') {
                gesture(g);
            } else {
                switch (gesture) {
                    case 'up':
                        g.up();
                        break;
                    case 'down':
                        g.down();
                        break;
                    case 'left':
                        g.left();
                        break;
                    case 'right':
                        g.right();
                        break;
                }
            }

            if ('element' in args) {
                action = {
                    type: 'swipe',
                    element: args.element,
                    localPosition: args.localPosition,
                    moves: g.build(),
                } as SwipeAction;
            } else if ('position' in args) {
                action = {
                    type: 'swipe',
                    position: args.position,
                    moves: g.build(),
                } as SwipeAction;
            } else {
                throw new Error('Either element or position must be specified');
            }

            return this.playAction(action, options);
        } catch (e) {
            captureOperationalError(e, this.swipe);
            throw e;
        }
    }

    /**
     * Waits until the there are no ongoing animations the screen
     * by waiting for the image to stabilize for at least 1 second
     */
    async waitForAnimations(
        options: {
            /**
             * The threshold for the amount of pixels (in %) that can change between frames
             * before the image is considered to be stable
             *
             * @default 0.01
             */
            imageThreshold?: number;

            /**
             * The maximum amount of time to wait for the image to stabilize
             *
             * @default 10000
             */
            timeout?: number;
        } = {}
    ) {
        try {
            const { imageThreshold = 0.001, timeout = 10000 } = options;

            let imageThresholdDuration = 1000;
            let lowestImageThreshold = 1;

            // this is undocumented - we're not sure we want to expose this yet
            if ((options as any).imageThresholdDuration) {
                imageThresholdDuration = (options as any)
                    .imageThresholdDuration;
            }

            const [promise, resolve, reject] = createDeferredPromise();

            const timeoutId = setTimeout(() => {
                let msg = `Timed out after ${timeout}ms waiting for animation to end.`;

                if (imageThreshold < lowestImageThreshold) {
                    msg += ` Waited for imageThreshold of ${imageThreshold} but lowest was ${
                        Math.round(lowestImageThreshold * 10000) / 10000
                    }`;
                }

                reject(new TimeoutError(msg));
            }, timeout);

            let lastTimeUnderThreshold: number | undefined;

            const handlePixelsChanged = ({
                percentage,
                timestamp,
            }: {
                percentage: number;
                timestamp: number;
            }) => {
                if (percentage < lowestImageThreshold) {
                    lowestImageThreshold = percentage;
                }

                if (percentage <= imageThreshold) {
                    if (!lastTimeUnderThreshold) {
                        lastTimeUnderThreshold = timestamp;
                    }

                    if (
                        lastTimeUnderThreshold &&
                        timestamp - lastTimeUnderThreshold >=
                            imageThresholdDuration
                    ) {
                        resolve();
                    }
                } else {
                    lastTimeUnderThreshold = undefined;
                }
            };

            this.socket.send('enablePixelChangeDetection');
            this.socket.on('pixelsChanged', handlePixelsChanged);
            this._waitForAnimationsPromises.add(promise);

            return await promise.finally(() => {
                clearTimeout(timeoutId);
                this.socket.off('pixelsChanged', handlePixelsChanged);
                this._waitForAnimationsPromises.delete(promise);

                // only disable pixel change detection if there are no more active waitForAnimations
                if (this._waitForAnimationsPromises.size === 0) {
                    this.socket.send('disablePixelChangeDetection');
                }
            });
        } catch (e) {
            captureOperationalError(e, this.waitForAnimations);
            throw e;
        }
    }

    /* DEBUG METHODS */
    /**
     *
     * @deprecated use `adbConnection` property instead
     */
    async getAdbInfo() {
        this.logger.warn(
            `getAdbInfo() is deprecated. Please use the \`adbConnection\` property instead.`
        );
        return Promise.resolve(this.#adbConnection);
    }

    /**
     *
     * @deprecated use `networkInspectorUrl` property instead
     */
    async getNetworkInspectorUrl() {
        this.logger.warn(
            `getNetworkInspectorUrl() is deprecated. Please use the \`networkInspectorUrl\` property instead.`
        );
        return Promise.resolve(this.#networkInspectorUrl);
    }

    /**
     *
     * @deprecated use `device` property instead
     */
    async getDeviceInfo() {
        this.logger.warn(
            `getDeviceInfo() is deprecated. Please use the \`device\` property instead.`
        );
        return Promise.resolve(this.device);
    }
}

export interface SessionInfo {
    path: string;
    token: string;
}

function getAdbShellCommand(connectionInfo: AdbConnectionInfo) {
    const template =
        'ssh -fN -o StrictHostKeyChecking=no -oHostKeyAlgorithms=+ssh-rsa -p SERVER_PORT USERNAME@HOSTNAME -L6000:FORWARD_DESTINATION:FORWARD_PORT && adb connect localhost:6000';
    if (!connectionInfo || !connectionInfo.forwards[0]) {
        return undefined;
    }
    let returnValue = template;
    returnValue = returnValue.replace(
        /SERVER_PORT/,
        connectionInfo.port.toString()
    );
    returnValue = returnValue.replace(/USERNAME/, connectionInfo.user);
    returnValue = returnValue.replace(/HOSTNAME/, connectionInfo.hostname);
    returnValue = returnValue.replace(
        /FORWARD_DESTINATION/,
        connectionInfo.forwards[0].destination
    );
    returnValue = returnValue.replace(
        /FORWARD_PORT/,
        connectionInfo.forwards[0].port.toString()
    );
    return returnValue;
}

/* -------------------------------------------------------------------------- */
/*                                    TYPES                                   */
/* -------------------------------------------------------------------------- */
export interface SessionEvents {
    log: { message: string };
    network: NetworkRequest | NetworkResponse;
    error: { message: string };
    action: RecordedAction;
    disconnect: void;
    interaction: {
        timeStamp: number;
        type: string;
        altKey?: boolean;
        shiftKey?: boolean;
        xPos?: number;
        yPos?: number;
    };
    heartbeat: void;
    orientationChanged: 'landscape' | 'portrait';
    appLaunch: void;
    firstFrameReceived: void;
    inactivityWarning: { secondsRemaining: number };
    ready: void;
    video: {
        buffer: Uint8Array;
        width: number;
        height: number;
        codec: 'h264' | 'jpeg';
    };
    audio: {
        buffer: Uint8Array;
        codec: 'aac';
        duration: number;
    };

    playbackFoundAndSent: PlayActionResult<Action>;
    playbackError: PlayActionErrorResponse<Action>;
}

export interface AdbConnectionInfo {
    command: string;
    forwards: Array<{ destination: string; port: number }>;
    hash: string;
    hostname: string;
    port: number;
    user: string;
}

export interface SessionConfig {
    device?: string;
    osVersion?: string;
    scale?: number | 'auto';
    autoplay?: boolean;
    adbShellCommand?: string;
    androidPackageManager?: boolean;
    appearance?: string;
    audio?: boolean;
    codec?: string;
    debug?: boolean;
    deviceColor?: string;
    disableSessionStart?: boolean;
    disableVirtualKeyboard?: boolean;
    enableAdb?: boolean;
    publicKey?: string;
    grantPermissions?: boolean;
    hidePasswords?: boolean;
    iosKeyboard?: string;
    iosAutocorrect?: string;
    language?: string;
    launchUrl?: string;
    launchArgs?: Array<string | number>;
    locale?: string;
    location?: number[];
    loopback?: boolean;
    noVideo?: boolean;
    orientation?: string;
    platform?: 'ios' | 'android';
    payerCode?: string;
    params?: Record<string, any>;
    plistEdit?: Record<string, any>;
    proxy?: string;
    record?: boolean;
    region?: string;
    screenOnly?: boolean;
    screenRecording?: boolean;
    showRotateButtons?: boolean;
    timezone?: string;
    xdocMsg?: boolean;
    endSessionRedirectUrl?: string;
    userInteractionDisabled?: boolean;
    volume?: number;
    debugSession?: boolean;
}

// config that is specifiable by the user
export type UserSessionConfig = Omit<SessionConfig, 'platform' | 'xdocMsg'>;

export interface NetworkRequest {
    type: 'request';
    serverIPAddress: string;
    requestId: string;
    request: {
        method: string;
        url: string;
        httpVersion: string;
        cookies: string[];
        headers: Array<{ name: string; value: string }>;
        queryString: string[];
        headersSize: number;
        bodySize: number;
    };
    cache: Record<string, any>;
}
export interface NetworkResponse extends Omit<NetworkRequest, 'type'> {
    type: 'response';
    response: {
        status: number;
        statusText: string;
        httpVersion: string;
        cookies: string[];
        headers: Array<{ name: string; value: string }>;
        redirectURL: string;
        headersSize: number;
        bodySize: number;
        content: {
            size: number;
            mimeType: string;
            compression: number;
            text: string;
        };
        postData?: {
            mimeType: string;
            text?: string;
        };
    };
}

export type KeyValue = LiteralUnion<
    'HOME' | 'VOLUME_UP' | 'VOLUME_DOWN' | 'ANDROID_KEYCODE_MENU',
    string
>;

type SimpleGesture = 'up' | 'down' | 'left' | 'right';

export type SwipeArgs = OmitUnion<SwipeAction, 'type' | 'moves'> & {
    duration?: number;
    gesture: SimpleGesture | ((gesture: SwipeGesture) => any);
};
