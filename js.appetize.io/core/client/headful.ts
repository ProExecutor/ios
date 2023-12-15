import { AppetizeApp } from '../api/types';
import { Client, ClientEvents, DeviceInfo } from '../client';
import { Logger } from '../logger';
import {
    Session,
    SessionConfig,
    SessionEvents,
    SessionInfo,
    UserSessionConfig,
} from '../session';
import { SocketProtocol } from '../socket';
import { cleanObject } from '../util';
import { waitFor } from '../waitFor';
import { AppetizeWindowProtocol } from '../window';

/**
 * Any client that interacts with the /embed Appetize.io page (embed, playwright)
 */
export class HeadfulClient<
    TSocket extends SocketProtocol,
    TEvents extends HeadfulClientEvents<TSession>,
    TSession extends Session<SessionEvents>
> extends Client<TSocket, TEvents, TSession> {
    device!: HeadfulDeviceInfo;
    app?: AppetizeApp;

    /**
     * an embed can only have 1 session at a time
     * but it can be started either by user clicking on the iframe,
     * or by calling client.startSession(). for either case,
     * we store that session reference here
     */
    protected session: TSession | undefined;
    protected window: AppetizeWindowProtocol;
    protected ready = false;

    constructor({
        socket,
        window,
        logger = new Logger(),
        config,
    }: {
        socket: TSocket;
        window: AppetizeWindowProtocol;
        logger?: Logger;
        config?: UserSessionConfig;
    }) {
        super({ socket, logger });
        this.window = window;

        if (config) {
            this._config = this.mapConfig(config);
        }

        this.window.on('*', async ({ type, value }) => {
            if (this.ready) {
                switch (type) {
                    case 'app':
                        this.app = value;
                        this.emit(type, value);
                        break;
                    case 'deviceInfo':
                        this.device = value;
                        this.emit(type, value);
                        break;
                    case 'config':
                        this._config = this.mapConfig(value);
                        break;
                }
            }
        });

        this.window.on('reinit', () => {
            this.ready = false;
            this.session = undefined;

            this.init({ isReinit: true });
        });

        this.socket.on('*', async ({ type, value }) => {
            if (this.ready) {
                switch (type) {
                    // when newSession is received, create the session instance
                    case 'newSession': {
                        try {
                            this.session = this.createSession(this._config!, {
                                path: value.path,
                                token: value.sessionToken,
                            });
                            await this.waitForSessionStart(this.session);
                            this.emit('session', this.session);
                        } catch (e) {
                            this.session = undefined;
                            this.emit('sessionError', e);
                        }
                    }
                }
            }
        });
        this.init();
    }

    protected async init(args: { isReinit?: boolean } = { isReinit: false }) {
        await this.window.waitUntilReady();

        const setConfig = async () => {
            if (args.isReinit) {
                const oldConfig = this._config;

                // get the new config from the window
                const newConfig = await this.setConfig({});

                // shallowly merge the old config with the new config
                return this.setConfig({
                    record: true,
                    ...oldConfig,
                    ...newConfig,
                });
            } else {
                return this.setConfig({
                    // always set record config unless explicitly set to false
                    record: true,
                    ...this._config,
                });
            }
        };
        const [app, deviceInfo] = await Promise.all([
            this.window.postMessage({ type: 'getApp' }, true),
            this.window.postMessage<HeadfulDeviceInfo>(
                { type: 'getDeviceInfo' },
                true
            ),
            setConfig(),
        ]);

        this.app = app;
        this.device = deviceInfo;
        // this.setConfig already sets this._config

        this.ready = true;
    }

    async waitUntilReady() {
        if (this.ready) {
            return;
        }

        return waitFor(async () => {
            if (!this.ready) {
                throw new Error('Timed out waiting for client to be ready');
            }
        }, 30000);
    }

    async startSession(config?: Partial<UserSessionConfig>) {
        // wait until client is ready
        try {
            await this.waitUntilReady();
        } catch (e) {
            const message = e instanceof Error ? e.message : e;
            throw new Error(`Failed to start session. ${message}`);
        }

        if (this.session) {
            await this.session.end();
        }

        // send through config
        await this.setConfig(config ?? {});

        // wait for session to be requested and received
        const [session] = await Promise.all([
            new Promise<TSession>((resolve, reject) => {
                const handleResolve = (data: TSession) => {
                    this.off('session' as any, handleResolve);
                    this.off('sessionError' as any, handleReject);
                    resolve(data);
                };

                const handleReject = (data: any) => {
                    this.off('session' as any, handleResolve);
                    this.off('sessionError' as any, handleReject);
                    reject(data);
                };

                this.on('session' as any, handleResolve);
                this.on('sessionError' as any, handleReject);
            }),
            this.window.postMessage({ type: 'requestSession' }, true),
        ]);

        return session;
    }

    /**
     * @deprecated Use client.setConfig()
     */
    async config(args: Partial<UserSessionConfig>): Promise<UserSessionConfig> {
        // TODO: remove in v2
        this.logger.warn(
            `client.config() is deprecated and will be removed in a future major release. Use client.setConfig() instead.`
        );
        return this.setConfig(args);
    }

    async setConfig({
        publicKey,
        ...config
    }: Partial<UserSessionConfig>): Promise<SessionConfig> {
        if (publicKey) {
            const response = await this.window.postMessage<
                AppetizeApp | { error: string }
            >(
                {
                    type: 'loadApp',
                    value: publicKey,
                },
                true
            );

            if (response && 'error' in response) {
                throw new Error(response.error);
            }
        }

        const value = await this.window
            .postMessage<SessionConfig>(
                {
                    type: 'setConfig',
                    value: this.validateConfig(config ?? {}),
                },
                true
            )
            .then(this.mapConfig.bind(this));

        this._config = value;
        return value;
    }

    /**
     * Maps config coming from the embed to the format we use in the client
     */
    private mapConfig(config: UserSessionConfig) {
        if (config.autoplay === true) {
            this.logger.warn.once(
                'autoplay=true may cause the session to start before the SDK is ready. You should start the session programmatically using client.startSession() instead.'
            );
        }

        return {
            ...cleanObject(config),
            device: (config as any).deviceType || config.device,
        };
    }

    /**
     * Runs during this.setConfig() before sending config options to the embed. Override this
     * to add default or validate config values
     */
    protected validateConfig(config: Partial<UserSessionConfig>) {
        return config;
    }

    /**
     * Called by either client.startSession() or when user starts a session manually.
     * This should simply assign this.session to a new Session instance
     */
    protected createSession(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        config: SessionConfig,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        info: SessionInfo
    ): TSession {
        throw new Error('Not implemented');
    }
}

export interface HeadfulClientEvents<TSession extends Session>
    extends ClientEvents {
    session: TSession;
    app: AppetizeApp;
    deviceInfo: HeadfulDeviceInfo;
    sessionRequested: void;
}

export interface HeadfulDeviceInfo extends DeviceInfo {
    embed: {
        width: number;
        height: number;
        screen: {
            width: number;
            height: number;
            offset: {
                x: number;
                y: number;
            };
        };
    };
}
