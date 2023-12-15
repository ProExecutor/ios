import {
    Session,
    SessionConfig,
    SessionEvents,
    UserSessionConfig,
} from '../session';
import { SocketProtocol } from '../socket';
import { Logger } from '../logger';
import { EventEmitter } from '../EventEmitter';

export class Client<
    TSocket extends SocketProtocol,
    TEvents extends ClientEvents,
    TSession extends Session<SessionEvents>
> extends EventEmitter {
    socket: TSocket;
    logger: Logger;

    // needed for swipes, but it's currently only possible to get from the embed page
    // TODO: for headless, we need this to be receivable from appetizer socket
    device!: DeviceInfo;
    protected _config: SessionConfig | undefined;

    queue?: ClientEvents['queue'];

    constructor({
        socket,
        logger = new Logger(),
    }: {
        socket: TSocket;
        logger?: Logger;
    }) {
        super();
        this.logger = logger;
        this.socket = socket;
        this.socket.on('*', ({ type, value }) => {
            const mapped = mapEvents(type, value);

            if (mapped === null) {
                return;
            }

            if (mapped) {
                this.emit(mapped.type, mapped.value);
                this.emit('*', mapped);
            } else {
                this.emit(type, value);
                this.emit('*', { type, value });
            }
        });

        this.socket.on('newSession', () => {
            if (this.queue) {
                this.emit('queueEnd');
                this.queue = undefined;
            }
        });
        this.on('queue' as any, (queue: ClientEvents['queue']) => {
            this.queue = queue;
        });
    }

    on<K extends Extract<keyof TEvents, string>>(
        event: K,
        listener: (value: TEvents[K]) => void
    ): this {
        return super.on(event, listener);
    }

    // implementation of this method depends on the class
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async startSession(config?: Partial<UserSessionConfig>): Promise<TSession> {
        throw new Error('Not implemented');
    }

    // implementation of this method depends on the class
    async setConfig(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        config: Partial<UserSessionConfig>
    ): Promise<SessionConfig> {
        throw new Error('Not implemented');
    }

    getConfig() {
        return this._config;
    }

    protected async waitForSessionStart(session: TSession) {
        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async (resolve, reject) => {
            const handleDisconnect = () => {
                reject(new Error('Session disconnected before it was ready'));
            };

            const handleSessionError = (ev: any) => {
                reject(
                    new Error(
                        `Session failed to start - ${
                            typeof ev.message === 'object'
                                ? JSON.stringify(ev.message)
                                : ev.message
                        }`
                    )
                );
            };

            const handleClientError = (ev: any) => {
                // clients errors aren't always a failure to start session,
                // so only reject for ones that are
                if (ev.message.match(/Too many requests/)) {
                    reject(
                        new Error(
                            `Session failed to start due to too many requests`
                        )
                    );
                }
            };

            try {
                this.on('error' as any, handleClientError);
                session.on('disconnect', handleDisconnect);
                session.on('error', handleSessionError);

                await session.waitUntilReady();
            } finally {
                this.off('error', handleClientError);
                session.off('disconnect', handleDisconnect);
                session.off('error', handleSessionError);
            }

            resolve(session);
        });
    }
}

/**
 * Maps old socket event names to new event names
 */
function mapEvents(event: string, data: any) {
    switch (event) {
        case 'concurrentQueue':
            return {
                type: 'queue',
                value: {
                    type: 'concurrent',
                    name: data.name,
                    position: data.position,
                },
            };
        case 'queue':
            return {
                type: 'queue',
                value: {
                    type: 'session',
                    position: data.position,
                },
            };

        case 'userError':
            return {
                type: 'error',
                value: data,
            };

        case 'newSession':
            return null;
    }
}

export interface ClientEvents {
    queue:
        | { type: 'session'; position: number }
        | { type: 'concurrent'; name: string; position: number };
    queueEnd: void;
    error: { message: string };
    session: Session;
}

export interface DeviceInfo {
    type: string;
    name: string;
    osVersion: string;
    orientation: 'portrait' | 'landscape';
    screen: {
        width: number;
        height: number;
        devicePixelRatio?: number;
    };
}
