import {
    SessionConfig,
    SessionInfo,
    UserSessionConfig,
} from '../../core/session';
import { HeadfulClient, HeadfulClientEvents } from '../../core/client/headful';
import { EmbedSession } from './session';
import { EmbedSocket } from './socket';
import { EmbedWindow } from './window';

export class EmbedClient extends HeadfulClient<
    EmbedSocket,
    EmbedClientEvents,
    EmbedSession
> {
    ready = false;
    declare window: EmbedWindow;

    constructor({
        selector,
        config,
    }: { selector?: string; config?: UserSessionConfig } = {}) {
        const window = new EmbedWindow({ selector, config });

        super({
            socket: new EmbedSocket({ window, type: 'webserver' }),
            config,
            window,
        });
    }

    protected createSession(config: SessionConfig, sessionInfo: SessionInfo) {
        this.session = new EmbedSession({
            window: this.window,
            config,
            path: sessionInfo.path,
            token: sessionInfo.token,
            device: this.device,
            app: this.app,
        });

        this.session.on('disconnect', () => {
            this.session = undefined;
        });

        return this.session;
    }
}
export interface EmbedClientEvents extends HeadfulClientEvents<EmbedSession> {}
