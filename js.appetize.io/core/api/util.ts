// right now this just validates misplaced attributes. eventually this should
// actually validate the structure of the element against some sort of schema
export function validateElementAttributes(element: any) {
    if (typeof element !== 'object' || Array.isArray(element)) {
        throw new Error('Element must be an object');
    }

    const rootKeys = Object.keys(element);
    const knownAttributeFields = [
        'text',
        'accessibilityIdentifier',
        'accessibilityLabel',
        'resource-id',
        'content-desc',
        'class',
        'baseClass',
    ];

    const rootAttributes = intersect(rootKeys, knownAttributeFields);

    if (rootAttributes.length > 0) {
        const list = rootAttributes.map((v) => `'${v}'`).join(', ');
        throw new Error(
            `Element has invalid properties: ${list}. Did you mean to put these under 'attributes'?`
        );
    }

    return element;
}

function intersect(a: any[], b: any[]) {
    return a.filter((v) => b.includes(v));
}
