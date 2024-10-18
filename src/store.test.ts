import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { equalFunc } from './equal';
import {
    createStore,
    type BatchFunction,
    type EffectConstructor,
    type MemoConstructor,
    type SignalConstructor,
} from './store';

describe('createStore()', () => {
    it('Creates a new store.', () => {
        const store = createStore();
        expect(store).toBeDefined();
        expect(store.signal).toBeInstanceOf(Function);
        expect(store.effect).toBeInstanceOf(Function);
        expect(store.memo).toBeInstanceOf(Function);
        expect(store.batch).toBeInstanceOf(Function);
    });

    it('Effects from one store do not react to signal changes in another store.', () => {
        const store1 = createStore();
        const store2 = createStore();

        let value = 0;
        const [get, set] = store1.signal(value);

        store2.effect(() => {
            value = get();
        });

        expect(value).toBe(0);

        set(1);

        expect(value).toBe(0);
    });
});

describe('signal()', () => {
    let signal: SignalConstructor;
    let effect: EffectConstructor;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        effect = store.effect;
    });

    it('Creates a new signal.', () => {
        const [get, set] = signal(0);
        expect(get()).toBe(0);
        set(42);
        expect(get()).toBe(42);
    });

    it('Returns an object with read and update functions.', () => {
        const count = signal(0);

        expect(count).toHaveProperty('read');
        expect(count.read).toBeInstanceOf(Function);
        expect(count).toHaveProperty('update');
        expect(count.update).toBeInstanceOf(Function);

        expect(count.read()).toBe(0);
        count.update(42);
        expect(count.read()).toBe(42);
    });

    it('Allows setting the value using a function.', () => {
        const [get, set] = signal(0);
        set((prevValue) => prevValue + 1);
        expect(get()).toBe(1);
    });

    it('Does not update when the value is the same.', () => {
        const [get, set] = signal(0);

        const fx = vi.fn(() => {
            get();
        });

        effect(fx);

        expect(fx).toBeCalledTimes(1);

        set(0);
        set(0);
        set(0);

        expect(fx).toBeCalledTimes(1);

        set(1);

        expect(fx).toBeCalledTimes(2);
    });

    it('Allows customizing the equality check.', () => {
        const [get, set] = signal(0, { equals: equalFunc({ compare: 'loose' }) });

        const fx = vi.fn(() => {
            get();
        });

        effect(fx);

        expect(fx).toBeCalledTimes(1);

        // @ts-expect-error - TS2345: Argument of type 'string' is not assignable to parameter of type 'number | ((prevValue: number) => number)'
        set('0');

        expect(fx).toBeCalledTimes(1);

        set(1);

        expect(fx).toBeCalledTimes(2);
    });
});

describe('effect()', () => {
    let signal: SignalConstructor;
    let effect: EffectConstructor;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        effect = store.effect;
    });

    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    afterAll(() => {
        consoleErrorMock.mockReset();
    });

    it('Creates a new effect.', () => {
        const [get, set] = signal(0);

        let value = 0;
        effect(() => {
            value = get();
        });

        expect(value).toBe(0);

        set(42);

        expect(value).toBe(42);
    });

    it('Returns a callback which unlinks the effect when it is no longer needed.', () => {
        const [get, set] = signal(0);

        let value = 0;
        const unlink = effect(() => {
            value = get();
        });

        unlink();

        set(42);

        expect(value).toBe(0);
    });

    it('Calls the cleanup function returned by the effect before running the effect again.', () => {
        const [get, set] = signal(73);

        let value = 0;
        let prevValue = -1;
        effect(() => {
            value = get();
            return () => {
                prevValue = value;
            };
        });

        expect(value).toBe(73);
        expect(prevValue).toBe(-1);

        set(42);

        expect(value).toBe(42);
        expect(prevValue).toBe(73);
    });

    it('Logs & ignores errors thrown by effect cleanup function.', () => {
        const [get, set] = signal(0);

        const cleanup = vi.fn(() => {
            throw new Error('Cleanup error');
        });

        expect(() => {
            effect(() => {
                get();
                return cleanup;
            });
        }).not.toThrow();

        expect(() => {
            set(42);
        }).not.toThrow();

        expect(cleanup).toBeCalledTimes(1);
        expect(consoleErrorMock).toBeCalledTimes(1);
        expect(consoleErrorMock).toBeCalledWith(
            'Error during effect cleanup:',
            new Error('Cleanup error'),
        );
    });

    it('Detects cycles in the effect dependencies.', () => {
        const [get, set] = signal(0);

        expect(() => {
            effect(() => {
                set(get() + 1);
            });
        }).toThrowError('Cyclic dependency detected');
    });

    it('Detects cycles in indirect effect dependencies.', () => {
        const [a, setA] = signal(0);
        const [b, setB] = signal(0);

        effect(() => {
            setA(b());
        });

        expect(() => {
            effect(() => {
                setB(a() + 1);
            });
        }).toThrowError('Cyclic dependency detected');
    });
});

describe('memo()', () => {
    let signal: SignalConstructor;
    let memo: MemoConstructor;
    let effect: EffectConstructor;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        memo = store.memo;
        effect = store.effect;
    });

    it('Creates a new memo.', () => {
        const [get, set] = signal(0);

        const memoized = memo(() => get() * 2);

        expect(memoized()).toBe(0);

        set(42);

        expect(memoized()).toBe(84);
    });
    it('Allows customizing the equality check.', () => {
        const [get, set] = signal(0);

        const memoized = memo(() => [Math.max(1, get()) * 2], {
            equals: equalFunc(),
        });

        const fx = vi.fn(() => {
            memoized();
        });

        effect(fx);

        expect(memoized()).toEqual([2]);
        expect(fx).toBeCalledTimes(1);

        set(1);

        expect(memoized()).toEqual([2]);
        expect(fx).toBeCalledTimes(1);

        set(42);

        expect(memoized()).toEqual([84]);
        expect(fx).toBeCalledTimes(2);
    });
});

describe('batch()', () => {
    let signal: SignalConstructor;
    let effect: EffectConstructor;
    let batch: BatchFunction;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        effect = store.effect;
        batch = store.batch;
    });

    it('Executes a batch of updates.', () => {
        const [get, set] = signal(0);

        const fx = vi.fn(() => {
            get();
        });

        effect(fx);

        expect(fx).toBeCalledTimes(1);

        batch(() => {
            set(1);
            set(2);
            set(3);
        });

        expect(fx).toBeCalledTimes(2);
    });
});
