import { captureOperationalError } from '../../core/errors';
import { Logger } from '../../core/logger';
import { Session, SessionArgs } from '../../core/session';
import { waitForTimeout } from '../../core/waitFor';
import { EmbedSocket } from './socket';
import { EmbedWindow } from './window';

export class EmbedSession extends Session {
    window: EmbedWindow;

    constructor({
        window,
        config,
        ...args
    }: Omit<SessionArgs, 'socket' | 'logger'> & {
        window: EmbedWindow;
    }) {
        const socket = new EmbedSocket({ window, type: 'appetizer' });
        super({
            ...args,
            config,
            socket,
            logger: new Logger(),
        });
        this.window = window;
    }

    async rotate(direction: 'left' | 'right') {
        try {
            const [orientation] = await Promise.all([
                this.waitForEvent('orientationChanged'),
                // we need to use postmessage api so that embed knows which direction we rotated.
                // otherwise, if we emit directly over the socket, frontend only knows that orientation changed
                // from/to portrait/landscape, not the actual rotation in degrees
                this.window.postMessage(
                    direction === 'left' ? 'rotateLeft' : 'rotateRight'
                ),
            ]);

            // orientationChange event is fired before the rotation effect is completed,
            // wait an additional 1000ms
            await waitForTimeout(1000);
            return orientation;
        } catch (e) {
            captureOperationalError(e, this.rotate);
            throw e;
        }
    }

    // override end() to use postMessage api instead of socket
    // so the frontend knows this is an intentional ending of the session
    async end() {
        this.isEndingManually = true;
        await this.window.postMessage('endSession');
    }
}
