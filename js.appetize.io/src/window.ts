import { VERSION } from '../../core/constants';
import { TimeoutError } from '../../core/errors';
import { waitFor } from '../../core/waitFor';
import { AppetizeWindowProtocol } from '../../core/window';
import { UserSessionConfig } from '../../core/session';
import { queryString } from '../../core/util';
import { EventEmitter } from '../../core/EventEmitter';

export class EmbedWindow
    extends EventEmitter
    implements AppetizeWindowProtocol
{
    selector?: string;
    ready?: boolean;
    contentWindow?: Window;
    initialConfig?: UserSessionConfig;

    constructor({
        selector,
        config,
    }: {
        selector?: string;
        /**
         * if iframe exists with no src, build the url using this config
         */
        config?: UserSessionConfig;
    } = {}) {
        super();
        this.selector = selector;
        this.initialConfig = config;

        this.handleWindowMessage = this.handleWindowMessage.bind(this);

        window.addEventListener('message', this.handleWindowMessage);

        this.init();
    }

    async init() {
        await new Promise((res, rej) => {
            let iframeObserver: { disconnect(): void } | undefined;

            const cleanup = () => {
                iframeObserver?.disconnect();
                clearTimeout(timeout);
                clearInterval(interval);
            };

            const timeout = setTimeout(() => {
                if (this.selector) {
                    cleanup();
                    rej(
                        new TimeoutError(
                            `Timed out after 60000ms waiting for Appetize iframe with selector "${this.selector}"`
                        )
                    );
                }
            }, 60000);

            // ping iframe with init message until we receive a message back
            const interval = setInterval(() => {
                const channel = new MessageChannel();
                this.contentWindow = this.getContentWindow();

                const iframe = this.getIframe();

                // ping window with init message
                if (this.contentWindow) {
                    // handle message back from iframe
                    channel.port1.onmessage = () => {
                        this.ready = true;
                        cleanup();

                        // if iframe is removed or src changes, reinit
                        if (iframe) {
                            const reinit = () => {
                                cleanup();
                                this.emit('reinit');
                                this.ready = false;
                                this.init();
                            };

                            iframeObserver = observeIframe(iframe, {
                                // mark as not ready when src changes
                                onSrcChange: () => {
                                    this.ready = false;
                                },
                                // when src has loaded, start reinit
                                onLoad: reinit,
                                // if iframe is removed, start reinit
                                onRemoved: reinit,
                            });
                        }

                        res(undefined);
                    };

                    this.contentWindow?.postMessage(
                        {
                            type: 'init',
                            appetizeClient: true,
                            version: VERSION,
                        },
                        '*',
                        [channel.port2]
                    );
                }
                // if iframe exists with no src, build the url and set it
                else if (iframe) {
                    if (!iframe.src) {
                        const host =
                            iframe.getAttribute('data-appetize-url') ??
                            'https://appetize.io';

                        if (this.initialConfig?.publicKey) {
                            const { publicKey, ...config } = this.initialConfig;
                            iframe.src = `${host}/embed/${
                                this.initialConfig.publicKey
                            }?${queryString(config)}`;
                        } else {
                            cleanup();
                            throw new Error(
                                'Missing publicKey in config in getClient()'
                            );
                        }
                    }
                }
            }, 100);
        });
    }

    /**
     * Waits for iframe to be loaded and ready for xdoc messages
     */
    async waitUntilReady() {
        return waitFor(async () => {
            if (this.selector && !this.getContentWindow()) {
                throw new Error(
                    `iframe not found for selector "${this.selector}"`
                );
            }

            await waitFor(() => {
                if (!this.ready) {
                    throw new Error(
                        `iframe was found but content did not load`
                    );
                }
            }, 20000);
        }, 5000);
    }

    /**
     * Sends a raw postMessage to the iframe
     *
     * @param {any} data
     * @param {boolean} waitForResponse - if true, waits for a response on the message channel
     */
    async postMessage<T = undefined>(
        data: any,
        waitForResponse = false
    ): Promise<T> {
        await this.waitUntilReady();
        const channel = new MessageChannel();
        this.contentWindow?.postMessage(data, '*', [channel.port2]);

        if (waitForResponse) {
            return new Promise<T>((resolve, reject) => {
                const tm = setTimeout(() => {
                    reject(
                        new TimeoutError(
                            'Timed out after 60000ms while waiting for postMessage response'
                        )
                    );
                }, 60000);

                channel.port1.onmessage = (ev) => {
                    clearTimeout(tm);
                    channel.port1.close();
                    channel.port2.close();
                    resolve(ev.data as T);
                };
            });
        } else {
            channel.port1.close();
            channel.port2.close();
            return undefined as T;
        }
    }

    private getContentWindow() {
        if (this.selector) {
            const iframe = this.getIframe();

            if (iframe?.src) {
                return iframe.contentWindow ?? undefined;
            }
        } else {
            return window;
        }
    }

    private getIframe() {
        if (this.selector) {
            const el = document.querySelector(this.selector);
            return el as HTMLIFrameElement | undefined;
        }
    }

    private handleWindowMessage(event: MessageEvent) {
        const eventType =
            typeof event.data === 'string' ? event.data : event.data?.type;

        if (this.contentWindow) {
            if (event.source === this.contentWindow) {
                this.emit(eventType, event.data?.value);
                this.emit('*', {
                    type: eventType,
                    value: event.data?.value,
                });
            }
        }
    }
}

/**
 * Observes the iframe and calls the appropriate callback.
 */
function observeIframe(
    element: HTMLIFrameElement,
    callbacks: {
        onLoad: () => void;
        onSrcChange: () => void;
        onRemoved: () => void;
    }
) {
    const src = element.src;

    const onLoad = () => {
        // only call onLoad if the src has changed
        if (element.src !== src) {
            callbacks.onLoad();
        }
    };

    const disconnect = () => {
        element.removeEventListener('load', onLoad);
        observer.disconnect();
    };

    element.addEventListener('load', onLoad);

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes') {
                if (
                    mutation.target === element &&
                    mutation.attributeName === 'src'
                ) {
                    callbacks.onSrcChange();
                }
            } else if (mutation.type === 'childList') {
                mutation.removedNodes.forEach((node) => {
                    if (node === element) {
                        callbacks.onRemoved();
                    }
                });
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
    });

    return {
        disconnect,
    };
}
