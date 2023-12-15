export function uint8ArrayToBase64(uint8Arr: Uint8Array, mimeType: string) {
    const str = Buffer.from(uint8Arr).toString('base64');
    return `data:${mimeType};base64,` + str;
}
