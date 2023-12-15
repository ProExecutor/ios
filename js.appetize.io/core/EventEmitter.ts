import { EventEmitter as BaseEventEmitter } from 'events';

export class EventEmitter extends BaseEventEmitter {
    constructor() {
        super();

        // EventEmitter will throw 'error' events if there are no listeners. We do not
        // want that behaviuor, so we seutp a no-op listener.
        this.on('error', () => {});
    }
}
