export class Logger {
    log = this.createLogFn('log');
    warn = this.createLogFn('warn');
    error = this.createLogFn('error');
    debug = this.createLogFn('log');

    private createLogFn(type: 'log' | 'warn' | 'error') {
        const loggedMessages = new Set<string>();
        const context = '[Appetize]';

        // preserves the original console context
        const fn: LogFn = Function.prototype.bind.call(
            console[type],
            console,
            context
        );

        // logs message only once, but we do lose the console context with this implementation
        fn.once = (msg: string) => {
            if (loggedMessages.has(msg)) {
                return;
            } else {
                loggedMessages.add(msg);
            }

            return fn.call(console, msg);
        };

        return fn;
    }
}

export interface LogFn {
    (message: string, ...data: any[]): void;
    once: (message: string, ...data: any[]) => void;
}
