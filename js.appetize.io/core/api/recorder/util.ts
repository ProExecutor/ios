/**
 * If value is a string ending with %, return the value as a number between 0 and 1.
 *
 * If value is a number betwen 0 and 1, return the value.
 */
export function parsePositionValue(value: string | number): number {
    if (typeof value === 'string') {
        if (value.endsWith('%')) {
            return parseInt(value, 10) / 100;
        } else {
            throw new Error(
                `Invalid position value: ${value}. Must be a number between 0 and 1, or a string ending with %`
            );
        }
    }

    return value;
}
