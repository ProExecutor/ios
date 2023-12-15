import { OperationalError } from '../errors';
import { cleanObject } from '../util';
import { Coordinates, Platform, ScreenBounds } from './recorder/common';
import * as InternalRecorderAPI from './recorder/internal';
import * as PublicRecorderAPI from './recorder/public';
import { parsePositionValue } from './recorder/util';
import { AppetizeApp } from './types';

export class InternalAPIMapper {
    platform: Platform;
    screen: ScreenBounds;
    app?: AppetizeApp;

    constructor({
        platform,
        screen,
        app,
    }: {
        platform: Platform;
        screen: ScreenBounds;
        app?: AppetizeApp;
    }) {
        this.platform = platform;
        this.screen = screen;
        this.app = app;
    }

    private pixelToDip(value: number) {
        return value / (this.screen.devicePixelRatio || 1);
    }

    private dipToPixel(value: number) {
        return value * (this.screen.devicePixelRatio || 1);
    }

    private getCoordinates(
        position: PublicRecorderAPI.Position,
        bounds: { width: number; height: number }
    ) {
        const x = parsePositionValue(position.x);
        const y = parsePositionValue(position.y);

        return {
            x: x * bounds.width,
            y: y * bounds.height,
        };
    }

    private mapHardwareKey(value?: string) {
        switch (value) {
            case 'HOME':
                return 'home';
            case 'VOLUME_UP':
                return 'volumeUp';
            case 'VOLUME_DOWN':
                return 'volumeDown';
        }

        return value;
    }

    mapAction(
        action: PublicRecorderAPI.Action | PublicRecorderAPI.RecordedAction
    ) {
        const map = () => {
            action = cleanObject(action);

            let element:
                | InternalRecorderAPI.Element
                | InternalRecorderAPI.ElementSelector
                | undefined;
            let coordinates: Coordinates | undefined;
            let localPosition: InternalRecorderAPI.Position | undefined;

            if ('element' in action && action.element) {
                element = this.mapElement(action.element);
            }

            if ('position' in action && action.position) {
                const x = parsePositionValue(action.position.x);
                const y = parsePositionValue(action.position.y);

                if (
                    !Validator.isValidNumber(x) ||
                    !Validator.isValidNumber(y)
                ) {
                    throw new OperationalError(
                        `Invalid position: (${action.position.x}, ${action.position.y}). Values must be a number or a percentage`
                    );
                }

                if (!Validator.isPositionWithinBounds(action.position)) {
                    if (typeof action.position.x === 'string') {
                        throw new Error(
                            `Invalid position: (${action.position.x}, ${action.position.y}) must be within (0%, 0%) and (100%, 100%)`
                        );
                    } else {
                        throw new Error(
                            `Invalid position: (${action.position.x}, ${action.position.y}) must be within (0, 0) and (1, 1)`
                        );
                    }
                }

                if (this.platform === 'android') {
                    coordinates = this.getCoordinates(action.position, {
                        width: this.dipToPixel(this.screen.width) - 1,
                        height: this.dipToPixel(this.screen.height) - 1,
                    });
                } else {
                    coordinates = this.getCoordinates(action.position, {
                        width: this.screen.width - 1,
                        height: this.screen.height - 1,
                    });
                }
            } else if ('coordinates' in action && action.coordinates) {
                if (
                    !Validator.isValidNumber(action.coordinates.x) ||
                    !Validator.isValidNumber(action.coordinates.y)
                ) {
                    throw new OperationalError(
                        `Invalid coordinates: (${action.coordinates.x}, ${action.coordinates.y}). Values must be a number`
                    );
                }

                if (
                    !Validator.isCoordinatesWithinBounds(action.coordinates, {
                        width: this.screen.width - 1,
                        height: this.screen.height - 1,
                    })
                ) {
                    throw new OperationalError(
                        `Invalid coordinates: (${action.coordinates.x}, ${
                            action.coordinates.y
                        }) exceed screen bounds (${this.screen.width - 1}, ${
                            this.screen.height - 1
                        })`
                    );
                }

                if (this.platform === 'android') {
                    coordinates = {
                        x: this.dipToPixel(action.coordinates.x),
                        y: this.dipToPixel(action.coordinates.y),
                    };
                } else {
                    coordinates = action.coordinates;
                }
            }

            if ('localPosition' in action && action.localPosition) {
                const x = parsePositionValue(action.localPosition.x);
                const y = parsePositionValue(action.localPosition.y);

                if (
                    !Validator.isValidNumber(x) ||
                    !Validator.isValidNumber(y)
                ) {
                    throw new OperationalError(
                        `Invalid localPosition: (${action.localPosition.x}, ${action.localPosition.y}). Values must be a number or a percentage`
                    );
                }

                // iOS sometimes reports localPosition values out of bounds. for the time being
                // we will disable this check.
                // if (!Validator.isPositionWithinBounds(action.localPosition)) {
                //     if (typeof action.localPosition.x === 'string') {
                //         throw new Error(
                //             `Invalid localPosition: (${action.localPosition.x}, ${action.localPosition.y}) must be within (0%, 0%) and (100%, 100%)`
                //         );
                //     } else {
                //         throw new Error(
                //             `Invalid localPosition: (${action.localPosition.x}, ${action.localPosition.y}) must be within (0, 0) and (1, 1)`
                //         );
                //     }
                // }

                localPosition = {
                    x,
                    y,
                };
            } else {
                if (element) {
                    localPosition = { x: 0.5, y: 0.5 };
                }
            }

            if ('duration' in action && action.duration) {
                if (!Validator.isValidNumber(action.duration)) {
                    throw new OperationalError(
                        `Invalid duration: ${action.duration}. Value must be a number`
                    );
                }
            }

            switch (action.type) {
                case 'tap': {
                    const { position, ...rest } = action;

                    return {
                        ...rest,
                        element,
                        localPosition,
                        coordinates,
                    } as InternalRecorderAPI.TapAction;
                }
                case 'swipe': {
                    const { position, ...rest } = action;

                    return {
                        ...rest,
                        element,
                        localPosition,
                        coordinates,
                        moves: action.moves.map((move) => {
                            if (this.platform === 'android') {
                                const { x, y } = this.getCoordinates(move, {
                                    width:
                                        this.dipToPixel(this.screen.width) - 1,
                                    height:
                                        this.dipToPixel(this.screen.height) - 1,
                                });
                                return {
                                    ...move,
                                    x,
                                    y,
                                };
                            } else {
                                const { x, y } = this.getCoordinates(move, {
                                    width: this.screen.width - 1,
                                    height: this.screen.height - 1,
                                });
                                return {
                                    ...move,
                                    x,
                                    y,
                                };
                            }
                        }),
                    } as InternalRecorderAPI.SwipeAction;
                }
                case 'keypress': {
                    const key = this.mapHardwareKey(action.key);
                    const character = this.mapHardwareKey(action.character);

                    return {
                        ...action,
                        key,
                        character,
                        shiftKey:
                            this.platform === 'ios'
                                ? booleanToNumber(action.shiftKey)
                                : action.shiftKey,
                    } as InternalRecorderAPI.KeypressAction;
                }
                case 'findElements': {
                    return {
                        ...action,
                        element,
                    } as InternalRecorderAPI.FindElementsAction;
                }
            }
            return action;
        };

        return cleanObject(map());
    }

    mapElement<
        T extends PublicRecorderAPI.Element | PublicRecorderAPI.ElementSelector
    >(
        element: T
    ): T extends PublicRecorderAPI.Element
        ? InternalRecorderAPI.Element
        : InternalRecorderAPI.ElementSelector {
        const { attributes, bounds, ...rest } = element;

        const mapBounds = () => {
            if (bounds) {
                const { x, y, width, height } = bounds;
                if (this.platform === 'android') {
                    return {
                        x: this.dipToPixel(x),
                        y: this.dipToPixel(y),
                        width: this.dipToPixel(width),
                        height: this.dipToPixel(height),
                    };
                } else {
                    return {
                        x: mapToObjCNumber(x),
                        y: mapToObjCNumber(y),
                        width: mapToObjCNumber(width),
                        height: mapToObjCNumber(height),
                    };
                }
            }
        };

        const mapAttributes = () => {
            if (attributes) {
                return Object.keys(attributes).reduce((acc, key) => {
                    if (this.platform === 'ios') {
                        switch (key) {
                            // convert boolean to '1' or '0'
                            case 'userInteractionEnabled':
                            case 'isHidden':
                                return {
                                    ...acc,
                                    [key]: attributes[key]
                                        ? '1'
                                        : ('0' as InternalRecorderAPI.BooleanString),
                                };
                        }
                    } else if (this.platform === 'android') {
                        // nothing yet
                    }

                    return {
                        ...acc,
                        [key]: attributes[key],
                    };
                }, {}) as InternalRecorderAPI.Element['attributes'];
            }
        };

        return cleanObject({
            ...rest,
            bounds: mapBounds(),
            attributes: mapAttributes(),
            // internal does not use accessibilityElements for playback, so just remove it
            accessibilityElements: undefined,
        }) as T extends PublicRecorderAPI.Element
            ? InternalRecorderAPI.Element
            : InternalRecorderAPI.ElementSelector;
    }
}

export class PublicAPIMapper {
    platform: Platform;
    screen: ScreenBounds;
    app?: AppetizeApp;

    constructor({
        platform,
        screen,
        app,
    }: {
        platform: Platform;
        screen: ScreenBounds;
        app?: AppetizeApp;
    }) {
        this.platform = platform;
        this.screen = screen;
        this.app = app;
    }

    private pixelToDip(value: number) {
        return value / (this.screen.devicePixelRatio || 1);
    }

    private dipToPixel(value: number) {
        return value * (this.screen.devicePixelRatio || 1);
    }

    private getPosition(
        coordinates: Coordinates,
        bounds: { width: number; height: number }
    ) {
        return {
            x: coordinates.x / bounds.width,
            y: coordinates.y / bounds.height,
        };
    }

    private mapHardwareKey(value?: string) {
        switch (value) {
            case 'home':
                return 'HOME';
            case 'volumeUp':
                return 'VOLUME_UP';
            case 'volumeDown':
                return 'VOLUME_DOWN';
        }

        return value;
    }

    mapAction(
        action: InternalRecorderAPI.Action | InternalRecorderAPI.RecordedAction
    ): PublicRecorderAPI.Action | PublicRecorderAPI.RecordedAction {
        const map = () => {
            let element:
                | PublicRecorderAPI.Element
                | PublicRecorderAPI.ElementSelector
                | undefined;
            let coordinates: Coordinates | undefined;
            let position: PublicRecorderAPI.Position | undefined;
            let localPosition: PublicRecorderAPI.Position | undefined =
                // if this is a playback result payload, localPosition may be defined
                'localPosition' in action ? action.localPosition : undefined;

            if ('coordinates' in action && action.coordinates) {
                coordinates = {
                    x: this.pixelToDip(action.coordinates.x),
                    y: this.pixelToDip(action.coordinates.y),
                };

                position = this.getPosition(coordinates, {
                    width: this.screen.width - 1,
                    height: this.screen.height - 1,
                });
            }

            if ('element' in action && action.element) {
                element = this.mapElement(action.element);

                if (coordinates && element.bounds) {
                    localPosition = this.getPosition(
                        {
                            x: coordinates.x - element.bounds.x,
                            y: coordinates.y - element.bounds.y,
                        },
                        {
                            width: element.bounds.width,
                            height: element.bounds.height,
                        }
                    );
                }
            }

            switch (action.type) {
                case 'tap': {
                    return {
                        ...action,
                        element,
                        position,
                        localPosition,
                    } as PublicRecorderAPI.TapAction;
                }
                case 'swipe': {
                    return {
                        ...action,
                        element,
                        position,
                        localPosition,
                        moves: action.moves.map((move) => {
                            const { x, y } = this.getPosition(
                                {
                                    x: this.pixelToDip(move.x),
                                    y: this.pixelToDip(move.y),
                                },
                                {
                                    width: this.screen.width - 1,
                                    height: this.screen.height - 1,
                                }
                            );

                            return {
                                x,
                                y,
                                t: move.t,
                            };
                        }),
                    } as PublicRecorderAPI.SwipeAction;
                }

                case 'keypress': {
                    const key = this.mapHardwareKey(action.key);
                    const character = this.mapHardwareKey(action.character);

                    return {
                        ...action,
                        key,
                        character,
                        shiftKey:
                            typeof action.shiftKey === 'number'
                                ? numberToBoolean(action.shiftKey)
                                : Boolean(action.shiftKey),
                    } as PublicRecorderAPI.KeypressAction;
                }
                case 'findElements': {
                    return {
                        ...action,
                        element,
                    } as PublicRecorderAPI.FindElementsAction;
                }
            }

            return action;
        };

        return cleanObject(map());
    }

    mapUI(
        ui: Record<string, InternalRecorderAPI.FullElement[]>
    ): PublicRecorderAPI.AllUI {
        const appUi = ui.ui ?? ui.result;
        const springboardUi = ui.springboard;

        const mapRecursive = (
            element: InternalRecorderAPI.FullElement
        ): PublicRecorderAPI.FullElement => {
            return {
                ...this.mapElement(element),
                children: element.children?.map(mapRecursive),
            };
        };

        const result: PublicRecorderAPI.AllUI = [];

        if (appUi) {
            if (this.platform === 'ios') {
                result.push({
                    type: 'app',
                    appId: this.app?.bundle,
                    children: appUi.map(mapRecursive),
                });
            } else {
                // on android, everything is one tree. in the future they will separate.
                result.push({
                    type: 'app',
                    children: appUi.map(mapRecursive),
                });
            }
        }

        if (springboardUi) {
            result.push({
                type: 'app',
                appId: 'com.apple.springboard',
                children: springboardUi.map(mapRecursive),
            });
        }

        return result;
    }

    mapElement<
        T extends
            | InternalRecorderAPI.Element
            | InternalRecorderAPI.ElementSelector
    >(
        element: T
    ): T extends InternalRecorderAPI.Element
        ? PublicRecorderAPI.Element
        : PublicRecorderAPI.ElementSelector {
        const { attributes, bounds, accessibilityElements, ...rest } = element;

        const mapBounds = (bounds: InternalRecorderAPI.ElementBounds) => {
            if (this.platform === 'android') {
                return {
                    x: this.pixelToDip(bounds.x as number),
                    y: this.pixelToDip(bounds.y as number),
                    width: this.pixelToDip(bounds.width as number),
                    height: this.pixelToDip(bounds.height as number),
                };
            } else {
                return {
                    x: parseObjCNumber(bounds.x),
                    y: parseObjCNumber(bounds.y),
                    width: parseObjCNumber(bounds.width),
                    height: parseObjCNumber(bounds.height),
                };
            }
        };

        const mapAttributes = (
            attributes:
                | InternalRecorderAPI.IOSElementAttributes
                | InternalRecorderAPI.IOSAccessibilityAttributes
        ) => {
            return Object.keys(attributes).reduce((acc, key) => {
                switch (key) {
                    // convert boolean to '1' or '0'
                    case 'userInteractionEnabled':
                    case 'isHidden':
                        return {
                            ...acc,
                            [key]: attributes[key] === '1' ? true : false,
                        };
                    default:
                        return {
                            ...acc,
                            [key]: attributes[key],
                        };
                }
            }, {}) as PublicRecorderAPI.Element['attributes'];
        };

        const mapAccessibilityElements = (
            accessibilityElements: InternalRecorderAPI.IOSAccessibilityElement[]
        ) => {
            return accessibilityElements.map((accessibilityEl) => {
                const { accessibilityFrame } = accessibilityEl;
                return {
                    ...mapAttributes(accessibilityEl),
                    accessibilityFrame: accessibilityFrame
                        ? mapBounds(accessibilityFrame)
                        : undefined,
                };
            });
        };

        return cleanObject({
            ...rest,
            bounds: bounds ? mapBounds(bounds) : undefined,
            attributes: attributes ? mapAttributes(attributes) : undefined,
            accessibilityElements: accessibilityElements
                ? mapAccessibilityElements(accessibilityElements)
                : undefined,
        }) as T extends InternalRecorderAPI.Element
            ? PublicRecorderAPI.Element
            : PublicRecorderAPI.ElementSelector;
    }

    mapAppetizerEvent(event: string, data: any) {
        switch (event) {
            case 'debug':
                return {
                    type: 'log',
                    value: data,
                };
            case 'interceptResponse':
                return {
                    type: 'network',
                    value: {
                        type: 'response',
                        ...data,
                    },
                };
            case 'interceptRequest':
                return {
                    type: 'network',
                    value: {
                        type: 'request',
                        ...data,
                    },
                };

            case 'interceptError':
                return {
                    type: 'network',
                    value: {
                        type: 'error',
                        ...data,
                    },
                };

            case 'userError':
                return {
                    type: 'error',
                    value: data,
                };

            case 'recordedAction': {
                return {
                    type: 'action',
                    value: this.mapAction(data),
                };
            }
            case 'playbackFoundAndSent': {
                const value = data as InternalRecorderAPI.PlayActionResult;

                return {
                    type: 'playbackFoundAndSent',
                    value: {
                        ...value,
                        playback: {
                            ...value.playback,
                            action: value.playback.action
                                ? this.mapAction(value.playback.action)
                                : undefined,
                        },
                        matchedElements: value.matchedElements?.map((e) => {
                            if (e) {
                                return this.mapElement(e);
                            }
                        }),
                    },
                } as {
                    type: string;
                    value: PublicRecorderAPI.PlayActionResult;
                };
            }
            case 'playbackError': {
                const value = data as InternalRecorderAPI.PlayActionResult;

                return {
                    type: 'playbackError',
                    value: {
                        ...value,
                        playback: {
                            ...value.playback,
                            action: value.playback.action
                                ? this.mapAction(value.playback.action)
                                : undefined,
                        },
                        matchedElements: value.matchedElements?.map((e) => {
                            if (e) {
                                return this.mapElement(e);
                            }
                        }),
                    },
                } as {
                    type: string;
                    value: PublicRecorderAPI.PlayActionErrorResponse;
                };
            }
            case 'uiDump': {
                return {
                    type: 'uiDump',
                    value: this.mapUI(data),
                };
            }
            case 'userInteractionReceived':
                return {
                    type: 'interaction',
                    value: data,
                };
            case 'countdownWarning':
                return {
                    type: 'inactivityWarning',
                    value: data,
                };
            case 'h264Data':
                return {
                    type: 'video',
                    value: {
                        ...data,
                        codec: 'h264',
                    },
                };

            case 'frameData':
                return {
                    type: 'video',
                    value: {
                        ...data,
                        codec: 'jpeg',
                    },
                };
            case 'audioData': {
                return {
                    type: 'audio',
                    value: {
                        ...data,
                        codec: 'aac',
                    },
                };
            }

            // suppressed events
            case 'deleteEvent':
                return null;
        }
    }
}

// prevents accidentally using window.screen that instead of this.screen
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare let screen: never;

class Validator {
    static isCoordinatesWithinBounds(
        coordinates: Coordinates,
        bounds: { width: number; height: number }
    ) {
        if (coordinates.x < 0 || coordinates.x > bounds.width) {
            return false;
        }

        if (coordinates.y < 0 || coordinates.y > bounds.height) {
            return false;
        }

        return true;
    }

    static isPositionWithinBounds(
        position: InternalRecorderAPI.Position | PublicRecorderAPI.Position
    ) {
        const x = parsePositionValue(position.x);
        const y = parsePositionValue(position.y);

        if (x < 0 || x > 1) {
            return false;
        }

        if (y < 0 || y > 1) {
            return false;
        }

        return true;
    }

    static isValidNumber(value: number) {
        if (typeof value !== 'number') {
            return false;
        }

        if (isNaN(value)) {
            return false;
        }

        return true;
    }
}

function booleanToNumber(
    value: boolean | null | undefined
): InternalRecorderAPI.BooleanNumber {
    return value ? 1 : 0;
}

function numberToBoolean(value: number | null | undefined) {
    return value === 1 ? true : false;
}

function parseObjCNumber(value: InternalRecorderAPI.ObjCNumber) {
    if (typeof value === 'number') {
        return value;
    }

    if (value === 'inf') {
        return Infinity;
    }

    if (value === '-inf') {
        return -Infinity;
    }

    return parseFloat(value);
}

function mapToObjCNumber(value: number): InternalRecorderAPI.ObjCNumber {
    if (value === Infinity) {
        return 'inf';
    }

    if (value === -Infinity) {
        return '-inf';
    }

    return value;
}
