import { PlayActionErrorResponse } from './api/recorder';

export function captureStackTrace(targetObject, constructorOpt) {
    if ('captureStackTrace' in Error) {
        Error.captureStackTrace(targetObject, constructorOpt);
    } else {
        // @ts-ignore
        const container = new Error();

        Object.defineProperty(targetObject, 'stack', {
            configurable: true,
            get() {
                const { stack } = container;
                Object.defineProperty(this, 'stack', { value: stack });
                return stack;
            },
        });
    }
}

/**
 * Captures the stack trace of an operational error so that when the error is logged to the user,
 * the stack points to the given method instead of the method that threw the error.
 *
 * i.e
 *
 * ```bash
 *  TimeoutError: Timed out after 60 seconds waiting for element
 *  await session.tap({ element: { text: 'hello' } });
 *  ^
 * ```
 */
export async function captureOperationalError(e: unknown, constructorOpt: any) {
    if (e instanceof OperationalError) {
        captureStackTrace(e, constructorOpt);
    }
}

export class OperationalError extends Error {
    /**
     * Whether the error is operational or not.
     * Operational errors are errors that are expected to happen
     * (such as the failed result of an action playback, or timeout error).
     */
    isOperational: boolean;

    constructor(message: string) {
        super(message);
        this.name = 'Error';
        this.isOperational = true;
        captureStackTrace(this, this.constructor);
    }
}

export class ActionError extends OperationalError {
    errorId: PlayActionErrorResponse['errorId'];
    playback: PlayActionErrorResponse['playback'];

    constructor(error: PlayActionErrorResponse, message?: string) {
        super(message ?? error.message);
        this.errorId = error.errorId;
        this.playback = error.playback;
    }
}

export class ActionElementNotFoundError extends ActionError {
    constructor(error: PlayActionErrorResponse & { errorId: 'notFound' }) {
        super(
            error,
            `No element found for selector\n${JSON.stringify(
                error.playback.action.element,
                null,
                2
            )}`
        );
    }
}

export class ActionAmbiguousElementError extends ActionError {
    constructor(
        error: PlayActionErrorResponse & { errorId: 'ambiguousMatch' }
    ) {
        super(
            error,
            `Action requires 1 unique element but the selector returned ${
                error.matchedElements.length
            }. Provide a \`matchIndex\` to pick an element below or add additional attributes to your selector.\n\n${formatAmbiguousElements(
                error.matchedElements
            )}`
        );
    }
}

export class ActionInvalidArgumentError extends ActionError {
    constructor(
        error: PlayActionErrorResponse & { errorId: 'invalidArgument' }
    ) {
        let msg = error.message;
        if (error.message.match('outside the screen bounds')) {
            const { action } = error.playback;
            if ('localPosition' in action && action.localPosition) {
                msg = `localPosition (${action.localPosition.x}, ${action.localPosition.y}) for the element evaluates to a coordinate outside of screen bounds.`;
            } else {
                msg = `Element is outside of screen bounds.`;
            }
        }

        super(error, msg);
    }
}

export class ActionInternalError extends ActionError {
    constructor(error: PlayActionErrorResponse & { errorId: 'internalError' }) {
        super(
            error,
            `An internal error has occurred for the action:\n${JSON.stringify(
                error.playback.action,
                null,
                2
            )}`
        );
    }
}

export class TimeoutError extends OperationalError {}

export class ActionTimeoutError extends OperationalError {
    playback: PlayActionErrorResponse['playback'];

    constructor(playback: PlayActionErrorResponse['playback'], msg: string) {
        super(msg);
        this.playback = playback;
    }
}

export class RecorderRequiredError extends OperationalError {
    constructor(feature: string) {
        super(
            `App Recorder must be enabled to use ${feature}. Please set "record" to true in the config.`
        );
    }
}

export function formatAmbiguousElements(elements: any[]): string {
    const maxElements = 5;
    const truncatedElements = elements.slice(0, maxElements);
    const truncated = elements.length > maxElements;

    const formatted = truncatedElements.map(
        (e, index) => `// ${index}\n${JSON.stringify(e, null, 2)}`
    );

    return `${formatted.join('\n\n')}${
        truncated ? `\n\n...and ${elements.length - maxElements} more` : ''
    }`;
}
