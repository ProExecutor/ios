import { EventEmitter } from '../../core/EventEmitter';
import { mapXdocEvent, SocketProtocol } from '../../core/socket';
import { waitForEvent, WaitForEventOptions } from '../../core/waitFor';
import { EmbedWindow } from './window';

export class EmbedSocket extends EventEmitter implements SocketProtocol {
    window: EmbedWindow;

    /**
     * Which socket to listen for messages from
     */
    type: 'webserver' | 'appetizer';

    constructor({
        window,
        type,
    }: {
        window: EmbedWindow;
        type: 'webserver' | 'appetizer';
    }) {
        super();
        this.type = type;
        this.window = window;

        this.window.on('*', ({ type, value }) => {
            switch (type) {
                case 'socketEvent':
                    if (value.socket === this.type) {
                        this.emit(value.type, value.value);
                        this.emit('*', {
                            type: value.type,
                            value: value.value,
                        });
                    }
                    break;
                case 'disconnect':
                    this.emit('disconnect');
                    this.emit('*', { type: 'disconnect' });
                    break;

                // map appetizer xdocs to client events
                // (eventually, these should be emitted by appetizer themselves)
                case 'sessionInfo':
                case 'chromeDevToolsUrl':
                case 'orientationChanged':
                case 'deviceInfo':
                    if (this.type === 'appetizer') {
                        const mapped = mapXdocEvent({ type, value });
                        if (mapped) {
                            this.emit(mapped.type, mapped.value);
                            this.emit('*', mapped);
                        }
                    }
                    break;

                // map webserver xdocs to client events
                case 'sessionRequested':
                    if (this.type === 'webserver') {
                        const mapped = mapXdocEvent({ type, value });
                        if (mapped) {
                            this.emit(mapped.type, mapped.value);
                            this.emit('*', mapped);
                        }
                    }
                    break;
            }
        });
    }

    /**
     * Sends a message to the AppSocket
     */
    async send(event: string, data?: any) {
        await this.window.waitUntilReady();

        await this.window?.postMessage({
            type: 'emitSocketEvent',
            value: { type: event, value: data, socket: this.type },
        });
    }

    async disconnect() {
        return this.send('disconnect');
    }

    async waitForEvent<T>(
        event: string,
        options?: WaitForEventOptions<T>
    ): Promise<T> {
        return waitForEvent<T>(this, event, options);
    }
}
