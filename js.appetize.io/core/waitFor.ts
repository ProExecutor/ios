import { EventEmitter } from 'events';
import { TimeoutError } from './errors';

/**
 * Waits for the function to succeed without an error. If the function throws an error, it will retry until it succeeds or the timeout is reached.
 * Alternatively, you can call the `bail` function to throw an error and stop retrying.
 */
export async function waitFor<T>(
    fn: (bail: (error: Error) => void) => T | Promise<T>,
    timeout: number | null = 5000
): Promise<T> {
    const start = Date.now();

    let bail = false;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            const result = await fn((error) => {
                if (error) {
                    bail = true;
                    throw error;
                }
            });

            return result;
        } catch (e) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (bail || (timeout !== null && Date.now() - start > timeout)) {
                throw e;
            }
        }
    }
}

export async function waitForTimeout(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WaitForEventOptions<T> {
    timeout?: number | null;
    predicate?: (data: T) => boolean;
}

export type WaitForEventOptionsOrPredicate<T> =
    | WaitForEventOptions<T>
    | ((data: T) => boolean | undefined);

/**
 * Waits for the event to fire on the emitter and resolves with the value
 */
export async function waitForEvent<T>(
    emitter: EventEmitter,
    event: string,
    optionsOrPredicate?: WaitForEventOptionsOrPredicate<T>
): Promise<T> {
    const options =
        typeof optionsOrPredicate === 'function' ? {} : optionsOrPredicate;
    const predicate =
        typeof optionsOrPredicate === 'function'
            ? optionsOrPredicate
            : optionsOrPredicate?.predicate;

    const timeout =
        typeof options?.timeout !== 'undefined' ? options.timeout : 10000;

    return new Promise((resolve, reject) => {
        const listener = (data) => {
            if (!predicate || predicate(data)) {
                emitter.off(event, listener);
                resolve(data);
            }
        };
        emitter.on(event, listener);

        if (timeout !== null) {
            setTimeout(() => {
                emitter.off(event, listener);
                reject(
                    new TimeoutError(
                        `Timeout ${timeout}ms exceeded while waiting for event "${event}"`
                    )
                );
            }, timeout);
        }
    });
}
