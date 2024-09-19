import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as api from './index';
import type {
    BatchFunction,
    EffectConstructor,
    MemoConstructor,
    Signal,
    SignalConstructor,
    Store,
} from './store';

describe('public API', () => {
    it('should expose the createStore() function', () => {
        expect(api.createStore).toBeDefined();
        expect(api.createStore).toBeInstanceOf(Function);
        expectTypeOf(api.createStore).toEqualTypeOf<() => Store>();

        const store = api.createStore();

        expect(store.effect).toBeInstanceOf(Function);
        expect(store.memo).toBeInstanceOf(Function);
        expect(store.signal).toBeInstanceOf(Function);
        expect(store.batch).toBeInstanceOf(Function);
    });

    it('should expose the signal() function', async () => {
        expect(api.signal).toBeDefined();
        expect(api.signal).toBeInstanceOf(Function);
        expectTypeOf(api.signal).toEqualTypeOf<SignalConstructor>();

        const value = api.signal(42);

        expectTypeOf(value).toEqualTypeOf<Signal<number>>();

        expect(value.read()).toBe(42);
        value.update(43);
        expect(value.read()).toBe(43);
    });

    it('should expose the effect() function', async () => {
        expect(api.effect).toBeDefined();
        expect(api.effect).toBeInstanceOf(Function);
        expectTypeOf(api.effect).toEqualTypeOf<EffectConstructor>();

        let value = 42;
        const cleanup = api.effect(() => {
            value = 43;
        });
        expect(value).toBe(43);
        cleanup();
    });

    it('should expose the memo() function', async () => {
        expect(api.memo).toBeDefined();
        expect(api.memo).toBeInstanceOf(Function);
        expectTypeOf(api.memo).toEqualTypeOf<MemoConstructor>();

        const [get] = api.signal(42);
        const value = api.memo(() => get() * 2);
        expect(value()).toBe(84);
    });

    it('should expose the batch() function', async () => {
        expect(api.batch).toBeDefined();
        expect(api.batch).toBeInstanceOf(Function);
        expectTypeOf(api.batch).toEqualTypeOf<BatchFunction>();

        const [get, set] = api.signal(42);

        let value = 0;
        const fx = vi.fn(() => {
            value = get();
        });

        api.effect(fx);

        expect(value).toBe(42);
        expect(fx).toBeCalledTimes(1);

        api.batch(() => {
            set(43);
            set(44);
        });

        expect(value).toBe(44);
        expect(fx).toBeCalledTimes(2);
    });
});
