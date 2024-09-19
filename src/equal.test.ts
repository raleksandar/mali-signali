// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { equal, shallowlyEqual } from './equal';

describe('shallowlyEqual()', () => {
    it('Returns false when comparing non-equal primitive values.', () => {
        expect(shallowlyEqual('foo', 'bar')).toBe(false);
        expect(shallowlyEqual(Symbol('test'), Symbol('test'))).toBe(false);
    });

    it('Returns true when comparing identical primitive values.', () => {
        expect(shallowlyEqual('foo', 'foo')).toBe(true);
        expect(shallowlyEqual(0, 0)).toBe(true);
        expect(shallowlyEqual(true, true)).toBe(true);
    });

    it('Returns false when values of different types are compared.', () => {
        expect(shallowlyEqual(new Date(), Date.now())).toBe(false);
        expect(shallowlyEqual(Date.now(), new Date())).toBe(false);
        expect(shallowlyEqual([], {})).toBe(false);
        expect(shallowlyEqual({}, [])).toBe(false);
        expect(shallowlyEqual(0, false)).toBe(false);
        expect(shallowlyEqual(false, 0)).toBe(false);
        expect(shallowlyEqual('foo', Symbol('foo'))).toBe(false);
        expect(shallowlyEqual(Symbol('foo'), 'foo')).toBe(false);
    });

    it('Returns false when comparing different Date objects representing different date/time values.', () => {
        expect(shallowlyEqual(new Date('2024-09-10'), new Date('2024-09-09'))).toBe(false);
    });

    it('Returns true when comparing different Date objects representing the same date/time value.', () => {
        expect(shallowlyEqual(new Date('2024-09-10'), new Date('2024-09-10'))).toBe(true);
    });

    it('Defaults to using the "strict" comparator.', () => {
        expect(shallowlyEqual('foo', 'foo', 'strict')).toBe(shallowlyEqual('foo', 'foo'));
        expect(shallowlyEqual(0, 0, 'strict')).toBe(shallowlyEqual(0, 0));
        expect(shallowlyEqual(true, true, 'strict')).toBe(shallowlyEqual(true, true));
        expect(shallowlyEqual('', false, 'strict')).toBe(shallowlyEqual('', false));
        expect(shallowlyEqual(0, false, 'strict')).toBe(shallowlyEqual(0, false));
        expect(shallowlyEqual(123, '123', 'strict')).toBe(shallowlyEqual(123, '123'));
    });

    it('Returns true when comparing loosely equal primitive values with "loose" comparator.', () => {
        expect(shallowlyEqual('', false, 'loose')).toBe(true);
        expect(shallowlyEqual(0, false, 'loose')).toBe(true);
        expect(shallowlyEqual(123, '123', 'loose')).toBe(true);
    });

    it('Allows using a custom comparator function.', () => {
        function compare() {
            return true;
        }
        expect(shallowlyEqual(1, 2, compare)).toBe(true);
        expect(shallowlyEqual(true, false, compare)).toBe(true);
        expect(shallowlyEqual(Math.PI, '245850922/78256779', compare)).toBe(true);
    });

    it('Returns true when comparing NaN values.', () => {
        expect(shallowlyEqual(NaN, NaN, 'strict')).toBe(true);
        expect(shallowlyEqual(NaN, NaN, 'loose')).toBe(true);
    });

    it('Returns true when comparing identical objects.', () => {
        const object = { foo: 73, bar: 'test', baz: { qux: true } };
        const array = Object.keys(object);
        expect(shallowlyEqual(object, object)).toBe(true);
        expect(shallowlyEqual(array, array)).toBe(true);
    });

    it('Returns true for two arrays with equal elements.', () => {
        expect(shallowlyEqual([], [])).toBe(true);
        expect(shallowlyEqual([1, 2, 3], [1, 2, 3])).toBe(true);
        expect(shallowlyEqual([true, 'foo'], [true, 'foo'])).toBe(true);
    });

    it('Returns false for two arrays with different elements.', () => {
        expect(shallowlyEqual([1, 2, 3], [3, 2, 1])).toBe(false);
        expect(shallowlyEqual([true, 'foo'], [true])).toBe(false);
    });

    it('Returns true for two Map objects with equal entries.', () => {
        expect(
            shallowlyEqual(
                new Map<string, number | string>([
                    ['foo', 123],
                    ['bar', 'baz'],
                ]),
                new Map<string, number | string>([
                    ['foo', 123],
                    ['bar', 'baz'],
                ]),
            ),
        ).toBe(true);
    });

    it('Returns false for two Map objects with different entries.', () => {
        expect(
            shallowlyEqual(
                new Map<string, number | string>([
                    ['foo', 123],
                    ['bar', 'baz'],
                ]),
                new Map<string, number | string>([
                    ['foo', 123],
                    ['bar', 'qux'],
                ]),
            ),
        ).toBe(false);
        expect(
            shallowlyEqual(
                new Map<string, number | string>([
                    ['foo', 123],
                    ['bar', 'baz'],
                ]),
                new Map(),
            ),
        ).toBe(false);
    });

    it('Returns true for two Set objects with equal entries.', () => {
        expect(
            shallowlyEqual(
                new Set(['foo', true, '3.14', null]),
                new Set(['foo', true, '3.14', null]),
            ),
        ).toBe(true);
    });

    it('Returns false for two Set objects with different entries.', () => {
        expect(
            shallowlyEqual(new Set(['foo', true, '3.14', null]), new Set(['foo', true, '3.14'])),
        ).toBe(false);
        expect(
            shallowlyEqual(
                new Set(['foo', true, '3.14', null]),
                new Set(['foo', true, '3.14', undefined]),
            ),
        ).toBe(false);
    });

    it('Returns true for two arrays with loosely equal elements when using "loose" comparator.', () => {
        expect(shallowlyEqual(['3.14', 0, null], [3.14, false, undefined], 'loose')).toBe(true);
    });

    it('Returns true for two objects with equal key/value pairs.', () => {
        expect(shallowlyEqual({}, {})).toBe(true);
        expect(shallowlyEqual({ foo: 1 }, { foo: 1 })).toBe(true);
        expect(shallowlyEqual({ bar: 'baz', qux: false }, { bar: 'baz', qux: false })).toBe(true);
    });

    it('Returns true for two objects with loosely equal key/value pairs when using "loose" comparator.', () => {
        expect(shallowlyEqual({ foo: 1 }, { foo: '1' }, 'loose')).toBe(true);
        expect(shallowlyEqual({ '0': null, qux: false }, { 0: undefined, qux: 0 }, 'loose')).toBe(
            true,
        );
    });

    it('Returns false when comparing objects containing non-identical objects.', () => {
        expect(shallowlyEqual({ foo: 1, bar: [] }, { foo: 1, bar: [] })).toBe(false);
        expect(shallowlyEqual({ bar: { baz: true } }, {})).toBe(false);
    });

    it('Returns true when comparing two TypedArray objects with equal elements.', () => {
        expect(shallowlyEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    });

    it('Returns false when comparing two TypedArray objects with different elements.', () => {
        expect(shallowlyEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 3, 2]))).toBe(false);
        expect(shallowlyEqual(new Int32Array([1, 2, 3]), new Int32Array([1]))).toBe(false);
    });

    it('Returns true when comparing two RegExp objects with equal properties.', () => {
        expect(shallowlyEqual(/foo/, /foo/)).toBe(true);
        expect(shallowlyEqual(/foo/gim, /foo/gim)).toBe(true);
    });

    it('Returns false when comparing two RegExp objects with different properties.', () => {
        expect(shallowlyEqual(/foo/, /bar/)).toBe(false);
        expect(shallowlyEqual(/foo/gim, /foo/gi)).toBe(false);
    });

    it('Returns true when comparing the same DOM element instance', () => {
        const div = document.createElement('div');
        expect(shallowlyEqual(div, div)).toBe(true);
    });

    it('Returns false when comparing two DOM elements', () => {
        const div1 = document.createElement('div');
        const div2 = document.createElement('div');
        expect(shallowlyEqual(div1, div2)).toBe(false);
    });

    it('Returns true when comparing the same function', () => {
        const fn = () => {};
        expect(shallowlyEqual(fn, fn)).toBe(true);
    });

    it('Returns false when comparing functions', () => {
        expect(
            shallowlyEqual(
                () => {},
                () => {},
            ),
        ).toBe(false);
    });
});

describe('equal()', () => {
    it('Return true when passed equal values', () => {
        const foo = {
            bar: 2,
            baz: 1,
            obj: {
                foo: {
                    obj: 3,
                },
            },
        };
        const bar = {
            bar: 2,
            baz: 1,
            obj: {
                foo: {
                    obj: 3,
                },
            },
        };
        expect(equal(foo, bar, { maxDepth: 3 })).toEqual(true);
    });

    it('Returns false when passed equal values, but smaller maxDepth', () => {
        const bar = {
            bar: 2,
            baz: 1,
            obj: {
                foo: {
                    obj: 3,
                },
            },
        };
        const baz = {
            bar: 2,
            baz: 1,
            obj: {
                foo: {
                    obj: 3,
                },
            },
        };
        expect(equal(bar, baz, { maxDepth: 2 })).toEqual(false);
    });

    it('Allows using a custom comparator function.', () => {
        function compare() {
            return true;
        }
        expect(equal(1, 2, { compare })).toBe(true);
        expect(equal(true, false, { compare })).toBe(true);
        expect(equal(Math.PI, '245850922/78256779', { compare })).toBe(true);
    });

    it('Returns true when comparing loosely equal primitive values in object with "loose" comparator.', () => {
        const bar = {
            bar: 2,
            baz: 1,
            obj: {
                foo: {
                    obj: 3,
                },
            },
        };
        const foo = {
            bar: '2',
            baz: '1',
            obj: {
                foo: {
                    obj: 3,
                },
            },
        };
        expect(equal(foo, bar, { compare: 'loose', maxDepth: 3 })).toEqual(true);
    });

    it('Returns false when comparing loosely equal primitive values in object with "strict" comparator.', () => {
        const bar = {
            bar: 2,
            baz: 1,
            obj: {
                foo: {
                    obj: 3,
                },
            },
        };
        const foo = {
            bar: '2',
            baz: '1',
            obj: {
                foo: {
                    obj: 3,
                },
            },
        };
        expect(equal(foo, bar, { compare: 'strict', maxDepth: 3 })).toEqual(false);
    });

    it('Handles circular references', () => {
        const a: Record<string, unknown> = {};
        const b: Record<string, unknown> = {};

        a.a = a;
        b.a = b;

        expect(equal(a, b)).toBe(false);
    });
});
