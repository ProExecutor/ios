import { type EventEmitter } from './EventEmitter';

export interface SocketProtocol extends EventEmitter {
    /**
     * Sends a message to the AppSocket. This is basically the same as `emit`
     * but asynchronous so that it can wait for the socket to be ready first.
     */
    send(event: string, data?: any): Promise<void>;

    disconnect(): Promise<void>;
}

/**
 * We have some events that are only emitted as xdoc that eventually
 * should be emitted by the sockets themselves. For now, this will
 * map those events to the appropriate client events.
 */
export function mapXdocEvent({ type, value }: { type: string; value: any }) {
    switch (type) {
        case 'deviceInfo':
            return {
                type: 'deviceInfo',
                value,
            };
        case 'sessionRequested':
            return {
                type: 'sessionRequested',
            };
        case 'chromeDevToolsUrl':
            return {
                type: 'networkInspectorUrl',
                value,
            };

        case 'orientationChanged':
            return {
                type: 'orientationChanged',
                value,
            };
    }
}

interface CommonSocketEvents {
    connect: void;
    timeout: void;
    reconnect: { attempt: number };
    close: CloseEvent;
    error: CloseEvent;
    userError: { message: string; requiresArm?: boolean };
    disconnect: void;
}
export interface ClientSocketEvents extends CommonSocketEvents {
    newSession: {
        path: string;
        sessionToken: string;
    };
    queue: { position: number };
    concurrentQueue: {
        position: number;
        name: string;
    };
}

export interface AppetizerSocketEvents extends CommonSocketEvents {
    connect: void;
    timeout: void;
    reconnect: { attempt: number };
    close: CloseEvent;
    error: CloseEvent;
    userError: { message: string; requiresArm?: boolean };
    disconnect: void;
    endSession: {
        timeLimitElapsed?: boolean;
        timeLimit?: number;
        timeLimitFreeTier?: unknown;
        maxSessionLength?: number;
    };

    ready: void;
    h264Data: { buffer: Buffer; hash: string; width: number; height: number };
    frameData: { buffer: Buffer; hash: string; width: number; height: number };
    audioData: { buffer: Buffer; hash: string };
    launchStatus: { status: string };
    countdownWarning: { secondsRemaining: number };
    timeoutReset: void;
    timeoutWarning: { secondsRemaining: number };
    timeLimitCountdown: { secondsRemaining: number };
    userInteractionReceived: {
        type: string;
        [key: string]: any;
    };
    adbOverTcp: {
        forwards: Array<{ destination: string; port: number }>;
        hash: string;
        hostname: string;
        port: number;
        user: string;
    };
    appLaunch: void;
    screenshot: {
        data: Uint8Array;
        mimeType: string;
        success: boolean;
    };
    capabilities: { getScreenshot?: boolean };
    uiDump: unknown;
    debug: { message: string };

    playbackError: unknown;
    playbackFoundAndSent: unknown;
    deleteEvent: unknown;
    recordedAction: unknown;
    recordedEvent: unknown;
    interceptRequest: NetworkRequest;
    interceptResponse: NetworkRequest;
    interceptError: NetworkRequest;
    devtoolsConnection: { secure?: boolean; url: string };
}

interface NetworkRequest {
    requestId: string;
    request: {
        bodySize: number;
        cookies: string[];
        headers: Array<{ name: string; value: string }>;
        headersSize: number;
        httpVersion: string;
        method: string;
        queryString: unknown[];
        url: string;
    };
    response?: {
        bodySize: number;
        content: {
            compression: number;
            size: number;
            mimeType: string;
            text: string;
        };
        cookies: string[];
        headers: Array<{ name: string; value: string }>;
        headersSize: number;
        httpVersion: string;
        redirectURL: string;
        statusText: string;
        status: number;
    };
    serverIPAddress?: string;
    cache?: unknown;
    startedDateTime?: string;
    time?: string;
    timings?: {
        send: number;
        receive: number;
        wait: number;
        ssl: number;
        connect: number;
    };
    error?: {
        errorText: string;
    };
}
