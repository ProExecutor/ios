import { EmbedClient, EmbedClientEvents } from './client';
import { EmbedSession } from './session';
import type {
    SessionEvents,
    KeyValue,
    UserSessionConfig,
} from '../../core/session';
import { VERSION } from '../../core/constants';

export type * from '../../core/api/recorder';

// for generated docs
export type {
    EmbedClient,
    EmbedSession,
    EmbedClientEvents,
    SessionEvents,
    KeyValue,
};

/**
 * Gets the client instance for the iframe at the given selector.
 */
export async function getClient(selector: string, config?: UserSessionConfig) {
    if (!selector) {
        throw new Error('selector is required');
    }

    const client = new EmbedClient({ selector, config });

    await client.waitUntilReady();

    return client;
}

export function getWindowClient(config?: UserSessionConfig) {
    const client = new EmbedClient({ config });

    return client;
}

export const version = VERSION;
