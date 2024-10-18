/**
 * Options for customizing the behavior of equal() function.
 */
export interface EqualityOptions {
    /**
     * Maximum depth equal() will traverse to.
     *
     * If two objects are equal up to the `maxDepth` level they will be
     * threated as equal even if they differ in the lower levels.
     *
     * Optional, defaults to `Infinity` (i.e., fully traverse object graphs).
     */
    readonly maxDepth?: number;

    /**
     * Comparator used to test all primitives, and non-primitive values at
     * the `maxDepth` level.
     *
     * Either `'loose'` which is based on the `==` JavaScript operator,
     * `'strict'` which uses the `Object.is()`, or a custom comparator function.
     *
     * Defaults to `'strict'`.
     */
    readonly compare?: 'loose' | 'strict' | ((a: unknown, b: unknown) => boolean);
}

/**
 * Returns true if two values are shallowly equal.
 *
 * If the values have different types this function returns false.
 * If any of the values is a primitive this function simply returns a === b.
 *
 * @param a - Value to compare to.
 * @param b - Value to compare.
 * @param compare - Optional comparator function. Defaults to `'strict'`.
 * @returns `true` if the values are shallowly equal.
 */
export function shallowlyEqual(
    a: unknown,
    b: unknown,
    compare: EqualityOptions['compare'] = 'strict',
): boolean {
    return equal(a, b, { compare, maxDepth: 1 });
}

/**
 * Tests a and b for structural (a.k.a deep) equality.
 *
 * @param a - Value to compare to.
 * @param b - Value to compare.
 * @param options - Optional parameters for customizing the behavior.
 * @returns `true` if the values are structurally equal.
 */
export function equal(a: unknown, b: unknown, options?: EqualityOptions): boolean {
    return deepEqual(a, b, deepEqualParams(options));
}

/**
 * Returns a function that compares two values for structural equality.
 *
 * @param options - Optional parameters for customizing the behavior.
 * @returns A function that compares two values for structural equality.
 */
export function equalFunc(options?: EqualityOptions): (a: unknown, b: unknown) => boolean {
    const params = deepEqualParams(options);
    return (a: unknown, b: unknown) => deepEqual(a, b, { ...params, cache: new Map() });
}

/**
 * A structural equality function which uses Object.is() semantics.
 */
export const structuralEqual = equalFunc({ compare: 'strict' });

/**
 * A structural equality function based on the == semantics.
 */
export const looseStructuralEqual = equalFunc({ compare: 'loose' });

/**
 * Returns DeepEqualParams from the specified EqualityOptions.
 *
 * @param options - The EqualityOptions to convert.
 * @returns DeepEqualParams with defaults applied.
 */
function deepEqualParams({
    compare = 'strict',
    maxDepth = Infinity,
}: EqualityOptions = {}): DeepEqualParams {
    return {
        cache: new Map(),
        compare:
            compare === 'strict'
                ? Object.is
                : compare === 'loose'
                  ? (lhs, rhs) => lhs == rhs || (Number.isNaN(lhs) && Number.isNaN(rhs))
                  : compare,
        maxDepth,
    };
}

/**
 * Options for customizing the behavior of the internal `deepEqual()` function.
 */
interface DeepEqualParams {
    /**
     * Comparison cache used for handling circular references.
     */
    readonly cache: Map<object, Set<object>>;

    /**
     * Comparator function.
     */
    readonly compare: (a: unknown, b: unknown) => boolean;

    /**
     * Maximum depth the `deepEqual()` will traverse to.
     * If two objects are equal up to the `maxDepth` level they will be
     * threated as equal even if they differ in the lower levels.
     */
    readonly maxDepth: number;
}

/**
 * The constructor of all TypedArray instances.
 */
const TypedArray = Object.getPrototypeOf(Uint8Array) as () => unknown;

/**
 * Checks if the specified value is a TypedArray instance.
 *
 * @param value - The value to check.
 */
function isTypedArray(value: unknown): value is unknown[] {
    return value instanceof TypedArray;
}

const hasElement = typeof globalThis.Element === 'function';

/**
 * Implementation of the deep equal() semantics.
 *
 * This function recursively tests two objects for equality making sure not
 * to blow up the call stack when handling circular references.
 *
 * @param a - Value to compare to.
 * @param b - Value to compare.
 * @param params - Compare and traverse parameters.
 * @param depth - Current depth of traversal.
 * @returns `true` if the values are structurally equal.
 */
function deepEqual(a: unknown, b: unknown, params: DeepEqualParams, depth = 0): boolean {
    if (++depth > params.maxDepth || !isObject(a) || !isObject(b)) {
        return params.compare(a, b);
    }

    if (a === b) {
        return true;
    }

    if (a.constructor !== b.constructor || (hasElement && a instanceof Element)) {
        return false;
    }

    let rhsValues = params.cache.get(a);
    if (!rhsValues) {
        rhsValues = new Set();
        params.cache.set(a, rhsValues);
    } else if (rhsValues.has(b)) {
        return false;
    }

    rhsValues.add(b);

    if (Array.isArray(a)) {
        const { length } = a;

        if (length !== b.length) {
            return false;
        }

        for (let i = 0; i < length; i++) {
            if (!deepEqual(a[i], b[i], params, depth)) {
                return false;
            }
        }

        return true;
    }

    if (a instanceof Map) {
        if (!(b instanceof Map) || a.size !== b.size) {
            return false;
        }

        for (const [key, value] of a) {
            if (!b.has(key) || !deepEqual(value, b.get(key), params, depth)) {
                return false;
            }
        }

        return true;
    }

    if (a instanceof Set) {
        if (!(b instanceof Set) || a.size !== b.size) {
            return false;
        }

        for (const value of a) {
            if (!b.has(value)) {
                return false;
            }
        }

        return true;
    }

    if (isTypedArray(a)) {
        if (!isTypedArray(b) || a.length !== b.length) {
            return false;
        }

        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }

        return true;
    }

    if (a instanceof RegExp) {
        return (
            b instanceof RegExp &&
            a.source === b.source &&
            a.flags === b.flags &&
            a.lastIndex === b.lastIndex
        );
    }

    if (
        a.valueOf !== Object.prototype.valueOf &&
        typeof a.valueOf === 'function' &&
        typeof b.valueOf === 'function'
    ) {
        return deepEqual(a.valueOf(), b.valueOf(), params, depth);
    }

    const keys = Object.keys(a);
    if (Object.keys(b).length !== keys.length) {
        return false;
    }

    for (const key of keys) {
        if (!deepEqual(a[key], b[key], params, depth)) {
            return false;
        }
    }

    return true;
}

/**
 * Returns true if the specified value is a valid, non-null, object.
 *
 * This includes arrays too.
 *
 * @param value - The value to validate.
 * @returns `true` if the value is a valid object.
 */
function isObject(value: unknown): value is Record<string | number, unknown> {
    return value !== null && typeof value === 'object';
}
