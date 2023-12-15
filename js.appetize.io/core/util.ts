export async function retry<T>(
    fn: () => T | Promise<T>,
    {
        retries = 3,
        timeout = 1000,
        predicate = () => true,
    }: {
        retries?: number;
        timeout?: number;
        predicate?: (e: unknown, attempt: number) => boolean | undefined;
    }
): Promise<T> {
    for (let i = 1; i <= retries; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === retries || !predicate(e, i)) {
                throw e;
            }

            await new Promise((resolve) => setTimeout(resolve, timeout));
        }
    }

    // unreachable, satisifies typescript return type
    throw null;
}

export function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

export function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export function queryString(params: Record<string, any>) {
    return Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
}

export function createDeferredPromise<T = void>(): [
    proimse: Promise<T>,
    resolve: (value: T) => void,
    reject: (error: any) => void
] {
    let resolve: (value: T) => void;
    let reject: (error: any) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return [promise, resolve!, reject!];
}

type CleanedObject<T> = {
    [P in keyof T]: T[P] extends object ? CleanedObject<T[P]> : T[P];
};

/**
 * Remove undefined and null recursively
 */
export function cleanObject<T>(obj: T): CleanedObject<T> {
    if (Array.isArray(obj)) {
        return (obj as unknown as any[])
            .map(cleanObject)
            .filter(
                (item) => item !== null && item !== undefined
            ) as CleanedObject<T>;
    }

    if (typeof obj === 'object' && obj !== null) {
        return Object.entries(obj).reduce((acc, [key, value]) => {
            const cleanedValue = cleanObject(value);
            if (cleanedValue !== null && cleanedValue !== undefined) {
                acc[key] = cleanedValue;
            }
            return acc;
        }, {} as CleanedObject<T>);
    }

    return obj as CleanedObject<T>;
}

type UnionKeys<T> = T extends T ? keyof T : never;
type StrictUnionHelper<T, TAll> = T extends any
    ? T & Partial<Record<Exclude<UnionKeys<TAll>, keyof T>, never>>
    : never;

export type StrictUnion<T> = StrictUnionHelper<T, T>;

// https://github.com/microsoft/TypeScript/issues/29729#issuecomment-471566609
export type LiteralUnion<T extends U, U = string> =
    | T
    | (U & { zz_IGNORE_ME?: never });

/**
 * Omit without breaking union types
 */
export type OmitUnion<T, K extends keyof any> = T extends any
    ? Omit<T, K>
    : never;
