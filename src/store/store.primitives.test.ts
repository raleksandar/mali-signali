import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { equalFunc } from '../equal';
import { deferred, flushPromises } from '../test/store-test-helpers';
import {
    createStore,
    type BatchFunction,
    DefaultInvalidationQueue,
    type EffectConstructor,
    type MemoConstructor,
    type SignalConstructor,
    type SignalReader,
    type SignalUpdater,
    type UntrackedReader,
} from '../store';

describe('createStore()', () => {
    it('Creates a new store.', () => {
        const store = createStore();
        expect(store).toBeDefined();
        expect(store.signal).toBeInstanceOf(Function);
        expect(store.effect).toBeInstanceOf(Function);
        expect(store.memo).toBeInstanceOf(Function);
        expect(store.batch).toBeInstanceOf(Function);
        expect(store.untracked).toBeInstanceOf(Function);
        expect(store.unlink).toBeInstanceOf(Function);
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
        expectTypeOf(count.read).toEqualTypeOf<SignalReader<number>>();

        expect(count).toHaveProperty('update');
        expect(count.update).toBeInstanceOf(Function);
        expectTypeOf(count.update).toEqualTypeOf<SignalUpdater<number>>();

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

        expect(fx).toHaveBeenCalledTimes(1);

        set(0);
        set(0);
        set(0);

        expect(fx).toHaveBeenCalledTimes(1);

        set(1);

        expect(fx).toHaveBeenCalledTimes(2);
    });

    it('Allows customizing the equality check.', () => {
        const [get, set] = signal(0, { equals: equalFunc({ compare: 'loose' }) });

        const fx = vi.fn(() => {
            get();
        });

        effect(fx);

        expect(fx).toHaveBeenCalledTimes(1);

        // @ts-expect-error - TS2345: Argument of type 'string' is not assignable to parameter of type 'number | ((prevValue: number) => number)'
        set('0');

        expect(fx).toHaveBeenCalledTimes(1);

        set(1);

        expect(fx).toHaveBeenCalledTimes(2);
    });
});

describe('DefaultInvalidationQueue', () => {
    it('Provides an array-backed FIFO queue.', () => {
        const queue = new DefaultInvalidationQueue<number>();

        expect(queue.size).toBe(0);

        queue.enqueue(1);
        queue.enqueue(2);

        expect(queue.size).toBe(2);
        expect(queue.dequeue()).toBe(1);
        expect(queue.dequeue()).toBe(2);
        expect(queue.dequeue()).toBeUndefined();
        expect(queue.size).toBe(0);
    });

    it('Clears queued items.', () => {
        const queue = new DefaultInvalidationQueue<number>();

        queue.enqueue(1);
        queue.enqueue(2);
        queue.clear();

        expect(queue.size).toBe(0);
        expect(queue.dequeue()).toBeUndefined();
    });
});

describe('untracked()', () => {
    let signal: SignalConstructor;
    let effect: EffectConstructor;
    let untracked: UntrackedReader;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        effect = store.effect;
        untracked = store.untracked;
    });

    it('Reads the value of a signal without tracking it.', () => {
        const [a, setA] = signal(1);
        const [b, setB] = signal(2);

        const fx = vi.fn(() => {
            setA(untracked(a) + b());
        });

        effect(fx);

        expect(a()).toBe(3);
        expect(fx).toHaveBeenCalledTimes(1);

        setA(0);

        expect(a()).toBe(0);
        expect(fx).toHaveBeenCalledTimes(1);

        setB(3);

        expect(a()).toBe(3);
        expect(fx).toHaveBeenCalledTimes(2);
    });

    it('Restores tracking when the untracked reader throws.', () => {
        const [get, set] = signal(0);

        const fx = vi.fn(() => {
            get();
        });

        effect(fx);

        expect(() => {
            untracked(() => {
                throw new Error('boom');
            });
        }).toThrow('boom');

        set(1);
        set(2);

        expect(fx).toHaveBeenCalledTimes(3);
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

    it('Propagates errors thrown by the compute function during creation.', () => {
        expect(() => memo(() => {
            throw new Error('boom');
        })).toThrow('boom');
    });

    it('Propagates errors thrown by compute through the signal setter that triggers recomputation.', () => {
        const [get, set] = signal(0);
        let shouldThrow = false;

        memo(() => {
            const value = get();
            if (shouldThrow) {
                throw new Error('boom');
            }
            return value * 2;
        });

        shouldThrow = true;

        expect(() => set(1)).toThrow('boom');
    });

    it('Becomes inert after compute throws during recomputation.', () => {
        const [get, set] = signal(0);
        let shouldThrow = false;
        const compute = vi.fn(() => {
            const value = get();
            if (shouldThrow) {
                throw new Error('boom');
            }
            return value * 2;
        });

        const memoized = memo(compute);

        expect(memoized()).toBe(0);
        expect(compute).toHaveBeenCalledTimes(1);

        shouldThrow = true;

        expect(() => set(1)).toThrow('boom');
        expect(compute).toHaveBeenCalledTimes(2);

        shouldThrow = false;

        set(2);
        expect(compute).toHaveBeenCalledTimes(2);
        expect(memoized()).toBe(0);
    });

    it('Does not break the reactive graph when compute throws during recomputation.', () => {
        const [get, set] = signal(0);
        const [other, setOther] = signal(0);
        let shouldThrow = false;

        memo(() => {
            const value = get();
            if (shouldThrow) {
                throw new Error('boom');
            }
            return value;
        });

        const fx = vi.fn(() => other());

        effect(fx);

        expect(fx).toHaveBeenCalledTimes(1);

        shouldThrow = true;

        expect(() => set(1)).toThrow('boom');

        setOther(1);

        expect(fx).toHaveBeenCalledTimes(2);
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
        expect(fx).toHaveBeenCalledTimes(1);

        set(1);

        expect(memoized()).toEqual([2]);
        expect(fx).toHaveBeenCalledTimes(1);

        set(42);

        expect(memoized()).toEqual([84]);
        expect(fx).toHaveBeenCalledTimes(2);
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

        expect(fx).toHaveBeenCalledTimes(1);

        batch(() => {
            set(1);
            set(2);
            set(3);
        });

        expect(fx).toHaveBeenCalledTimes(2);
    });

    it('Defers flushing until the outermost nested batch completes.', () => {
        const [get, set] = signal(0);

        const fx = vi.fn(() => {
            get();
        });

        effect(fx);

        expect(fx).toHaveBeenCalledTimes(1);

        batch(() => {
            set(1);

            batch(() => {
                set(2);
            });

            expect(fx).toHaveBeenCalledTimes(1);
        });

        expect(fx).toHaveBeenCalledTimes(2);
    });
});

describe('unlink()', () => {
    it('Unlinks all effects.', async () => {
        const store = createStore();

        const [a, setA] = store.signal(1);
        const [b, setB] = store.signal(2);
        const [c, setC] = store.signal(3);

        let aValue = 0;
        let bValue = 0;
        let cValue = 0;

        const fx1 = vi.fn(() => {
            aValue = a();
        });

        const fx2 = vi.fn(() => {
            bValue = b();
        });

        const fx3 = vi.fn(() => {
            cValue = c();
        });

        store.effect(fx1);
        store.effect(fx2);
        store.effect(fx3);

        expect(aValue).toBe(1);
        expect(fx1).toHaveBeenCalledTimes(1);

        expect(bValue).toBe(2);
        expect(fx2).toHaveBeenCalledTimes(1);

        expect(cValue).toBe(3);
        expect(fx3).toHaveBeenCalledTimes(1);

        setA(42);
        setB(73);
        setC(100);

        expect(aValue).toBe(42);
        expect(fx1).toHaveBeenCalledTimes(2);

        expect(bValue).toBe(73);
        expect(fx2).toHaveBeenCalledTimes(2);

        expect(cValue).toBe(100);
        expect(fx3).toHaveBeenCalledTimes(2);

        await store.unlink();

        setA(1000);
        setB(2000);
        setC(3000);

        expect(aValue).toBe(42);
        expect(fx1).toHaveBeenCalledTimes(2);

        expect(bValue).toBe(73);
        expect(fx2).toHaveBeenCalledTimes(2);

        expect(cValue).toBe(100);
        expect(fx3).toHaveBeenCalledTimes(2);
    });

    it('Does not unlink effects from other stores.', async () => {
        const store1 = createStore();
        const store2 = createStore();

        const [a, setA] = store1.signal(1);
        const [b, setB] = store2.signal(2);

        let aValue = 0;
        let bValue = 0;

        const fx1 = vi.fn(() => {
            aValue = a();
        });

        const fx2 = vi.fn(() => {
            bValue = b();
        });

        store1.effect(fx1);
        store2.effect(fx2);

        expect(aValue).toBe(1);
        expect(fx1).toHaveBeenCalledTimes(1);

        expect(bValue).toBe(2);
        expect(fx2).toHaveBeenCalledTimes(1);

        setA(42);
        setB(73);

        expect(aValue).toBe(42);
        expect(fx1).toHaveBeenCalledTimes(2);

        expect(bValue).toBe(73);
        expect(fx2).toHaveBeenCalledTimes(2);

        await store1.unlink();

        setA(1000);
        setB(2000);

        expect(aValue).toBe(42);
        expect(fx1).toHaveBeenCalledTimes(2);

        expect(bValue).toBe(2000);
        expect(fx2).toHaveBeenCalledTimes(3);
    });

    it('Aborts in-flight async effects and prevents reruns after unlink.', async () => {
        const store = createStore();
        const [get, set] = store.signal(0);
        const pending = deferred<void>();
        const signals: AbortSignal[] = [];
        const runs: number[] = [];

        store.effect(async ({ signal }) => {
            const value = get();
            runs.push(value);
            signals.push(signal);
            await pending.promise;
        });

        expect(runs).toEqual([0]);
        expect(signals[0]?.aborted).toBe(false);

        await store.unlink();

        expect(signals[0]?.aborted).toBe(true);

        pending.resolve();
        await flushPromises();

        set(1);
        await flushPromises();

        expect(runs).toEqual([0]);
    });

    it('Aborts multiple in-flight async effects on unlink.', async () => {
        const store = createStore();
        const first = deferred<void>();
        const second = deferred<void>();
        const signals: AbortSignal[] = [];

        store.effect(async ({ signal }) => {
            signals.push(signal);
            await first.promise;
        });

        store.effect(async ({ signal }) => {
            signals.push(signal);
            await second.promise;
        });

        expect(signals).toHaveLength(2);
        expect(signals.every((s) => !s.aborted)).toBe(true);

        await store.unlink();

        expect(signals.every((s) => s.aborted)).toBe(true);

        first.resolve();
        second.resolve();
        await flushPromises();
    });
});
