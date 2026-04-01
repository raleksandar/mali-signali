import { afterAll, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { equalFunc } from './equal';
import {
    type AsyncEffectFunction,
    type AsyncEffectOptions,
    type AsyncEffectErrorInfo,
    type AsyncInvalidation,
    createStore,
    type BatchFunction,
    DefaultInvalidationQueue,
    type EffectConstructor,
    type EffectContext,
    type EffectFunction,
    type InvalidationQueue,
    type MemoConstructor,
    type SignalConstructor,
    type SignalReader,
    type SignalUpdater,
    type UntrackedReader,
} from './store';

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;

    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

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

describe('effect()', () => {
    let signal: SignalConstructor;
    let effect: EffectConstructor;
    let batch: BatchFunction;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        effect = store.effect;
        batch = store.batch;
    });

    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    afterAll(() => {
        consoleErrorMock.mockReset();
    });

    it('Allows effect functions to return cleanup callbacks in the public types.', () => {
        expectTypeOf<EffectFunction>().toEqualTypeOf<
            (context: EffectContext) => void | (() => void)
        >();
    });

    it('Allows async effect functions in the public types.', () => {
        expectTypeOf<AsyncEffectFunction>().toEqualTypeOf<
            (context: EffectContext) => Promise<void>
        >();
    });

    it('Allows async effect options in the public types.', () => {
        expectTypeOf<AsyncEffectOptions>().toMatchTypeOf<{
            concurrency?: 'cancel' | 'concurrent' | 'queue';
        }>();
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

    it('Accepts AbortSignal to cancel the effect.', () => {
        const [get, set] = signal(0);

        const fx = vi.fn(() => {
            value = get();
        });

        const controller = new AbortController();
        let value = -1;

        effect(fx, { signal: controller.signal });

        expect(value).toBe(0);
        expect(fx).toBeCalledTimes(1);

        set(42);

        expect(value).toBe(42);
        expect(fx).toBeCalledTimes(2);

        controller.abort();

        set(73);

        expect(value).toBe(42);
        expect(fx).toBeCalledTimes(2);
    });

    it('Only calls the cleanup function once when the effect is canceled repeatedly.', () => {
        const cleanup = vi.fn();
        const cancel = effect(() => cleanup);

        cancel();
        cancel();

        expect(cleanup).toBeCalledTimes(1);
    });

    it('Only calls the cleanup function once when canceling before aborting the signal.', () => {
        const controller = new AbortController();
        const cleanup = vi.fn();
        const cancel = effect(() => cleanup, { signal: controller.signal });

        cancel();
        controller.abort();

        expect(cleanup).toBeCalledTimes(1);
    });

    it('Skips scheduled reruns for effects that are canceled earlier in the same flush.', () => {
        const [get, set] = signal(0);
        const controller = new AbortController();
        const firstRuns: number[] = [];
        const secondRuns: number[] = [];

        effect(() => {
            const value = get();
            firstRuns.push(value);

            if (value === 1) {
                controller.abort();
            }
        });

        effect(
            () => {
                secondRuns.push(get());
            },
            { signal: controller.signal },
        );

        set(1);

        expect(firstRuns).toEqual([0, 1]);
        expect(secondRuns).toEqual([0]);
    });

    it('Does not rerun effects that were invalidated before being canceled.', () => {
        const [get, set] = signal(0);
        const runs: number[] = [];

        const cancel = effect(() => {
            runs.push(get());
        });

        batch(() => {
            set(1);
            cancel();
        });

        expect(runs).toEqual([0]);
    });

    it('Does not rerun effects when cleanup cancels the effect.', () => {
        const [get, set] = signal(0);
        const runs: number[] = [];

        effect(({ cancel }) => {
            runs.push(get());

            return () => {
                cancel();
            };
        });

        set(1);

        expect(runs).toEqual([0]);
    });

    it('Does not run the effect if the AbortSignal is already aborted.', () => {
        const [get, set] = signal(0);

        const fx = vi.fn(() => {
            value = get();
        });

        const controller = new AbortController();
        let value = -1;

        controller.abort();

        effect(fx, { signal: controller.signal });

        expect(value).toBe(-1);
        expect(fx).toBeCalledTimes(0);

        set(42);

        expect(value).toBe(-1);
        expect(fx).toBeCalledTimes(0);
    });

    it('Cancels the effect when context.cancel() is called within the effect', () => {
        const [get, set] = signal(100);

        const fx = vi.fn((context: EffectContext) => {
            value = get();
            if (value === 42) {
                context.cancel();
            }
        });

        let value = -1;

        effect(fx);

        expect(value).toBe(100);
        expect(fx).toBeCalledTimes(1);

        set(42);

        expect(value).toBe(42);
        expect(fx).toBeCalledTimes(2);

        set(73);

        expect(value).toBe(42);
        expect(fx).toBeCalledTimes(2);
    });

    it('Runs async effects and applies updates after awaiting.', async () => {
        const [get, set] = signal(1);
        const [result, setResult] = signal(0);

        effect(async () => {
            const value = get();
            await Promise.resolve();
            setResult(value * 2);
        });

        await flushPromises();
        expect(result()).toBe(2);

        set(3);
        await flushPromises();

        expect(result()).toBe(6);
    });

    it('Tracks only reads that happen before the first await in async effects.', async () => {
        const [tracked, setTracked] = signal(1);
        const [untrackedAfterAwait, setUntrackedAfterAwait] = signal(10);
        const runs: Array<[number, number]> = [];

        effect(async () => {
            const value = tracked();
            await Promise.resolve();
            runs.push([value, untrackedAfterAwait()]);
        });

        await flushPromises();
        expect(runs).toEqual([[1, 10]]);

        setUntrackedAfterAwait(20);
        await flushPromises();
        expect(runs).toEqual([[1, 10]]);

        setTracked(2);
        await flushPromises();
        expect(runs).toEqual([
            [1, 10],
            [2, 20],
        ]);
    });

    it('Aborts stale async runs and coalesces reruns by default.', async () => {
        const [get, set] = signal(0);
        const firstRun = deferred<void>();
        const secondRun = deferred<void>();
        const starts: number[] = [];
        const signals: AbortSignal[] = [];

        effect(async ({ signal }) => {
            const value = get();
            starts.push(value);
            signals.push(signal);

            if (value === 0) {
                await firstRun.promise;
            } else {
                await secondRun.promise;
            }
        });

        expect(starts).toEqual([0]);

        set(1);
        set(2);

        expect(signals[0]?.aborted).toBe(true);
        expect(starts).toEqual([0]);

        firstRun.resolve();
        await flushPromises();

        expect(starts).toEqual([0, 2]);

        secondRun.resolve();
        await flushPromises();
    });

    it('Runs cleanup callbacks once when an async run is superseded.', async () => {
        const [get, set] = signal(0);
        const cleanup = vi.fn();
        const pending = deferred<void>();

        effect(async ({ onCleanup }) => {
            const value = get();
            onCleanup(cleanup);

            if (value === 0) {
                await pending.promise;
            }
        });

        set(1);

        expect(cleanup).toBeCalledTimes(1);

        pending.resolve();
        await flushPromises();

        expect(cleanup).toBeCalledTimes(1);
    });

    it('Runs async cleanup callbacks immediately if they are registered after cancellation.', async () => {
        const [get, set] = signal(0);
        const pending = deferred<void>();
        const cleanup = vi.fn();

        effect(async ({ onCleanup }) => {
            const value = get();

            if (value === 0) {
                await pending.promise;
                onCleanup(cleanup);
            }
        });

        set(1);
        pending.resolve();
        await flushPromises();

        expect(cleanup).toBeCalledTimes(1);
    });

    it('Cancels the whole async effect when context.cancel() is called.', async () => {
        const [get, set] = signal(0);
        const runs: number[] = [];

        effect(async ({ cancel }) => {
            const value = get();
            runs.push(value);

            if (value === 0) {
                cancel();
            }

            await Promise.resolve();
        });

        await flushPromises();

        set(1);
        await flushPromises();

        expect(runs).toEqual([0]);
    });

    it('Allows concurrent async runs when configured.', async () => {
        const [get, set] = signal(0);
        const first = deferred<void>();
        const second = deferred<void>();
        const starts: number[] = [];
        const finishes: number[] = [];

        effect(
            async () => {
                const value = get();
                starts.push(value);

                if (value === 0) {
                    await first.promise;
                } else {
                    await second.promise;
                }

                finishes.push(value);
            },
            { concurrency: 'concurrent' },
        );

        set(1);

        expect(starts).toEqual([0, 1]);

        second.resolve();
        await flushPromises();
        first.resolve();
        await flushPromises();

        expect(finishes).toEqual([1, 0]);
    });

    it('Queues async invalidations when configured.', async () => {
        const [get, set] = signal(0);
        const first = deferred<void>();
        const second = deferred<void>();
        const third = deferred<void>();
        const starts: number[] = [];

        effect(
            async () => {
                const value = get();
                starts.push(value);

                if (starts.length === 1) {
                    await first.promise;
                } else if (starts.length === 2) {
                    await second.promise;
                } else {
                    await third.promise;
                }
            },
            { concurrency: 'queue' },
        );

        set(1);
        set(2);

        expect(starts).toEqual([0]);

        first.resolve();
        await flushPromises();
        expect(starts).toEqual([0, 2]);

        second.resolve();
        await flushPromises();
        expect(starts).toEqual([0, 2, 2]);

        third.resolve();
        await flushPromises();
    });

    it('Uses custom queues for queued async invalidations.', async () => {
        const [get, set] = signal(0);
        const first = deferred<void>();
        const second = deferred<void>();
        const starts: number[] = [];

        class LatestOnlyQueue implements InvalidationQueue<AsyncInvalidation> {
            #item: AsyncInvalidation | undefined;

            public enqueue(item: AsyncInvalidation): void {
                this.#item = item;
            }

            public dequeue(): AsyncInvalidation | undefined {
                const item = this.#item;
                this.#item = undefined;
                return item;
            }

            public clear(): void {
                this.#item = undefined;
            }

            public get size(): number {
                return this.#item ? 1 : 0;
            }
        }

        effect(
            async () => {
                const value = get();
                starts.push(value);

                if (starts.length === 1) {
                    await first.promise;
                } else {
                    await second.promise;
                }
            },
            { concurrency: 'queue', queue: new LatestOnlyQueue() },
        );

        set(1);
        set(2);
        set(3);

        first.resolve();
        await flushPromises();

        expect(starts).toEqual([0, 3]);

        second.resolve();
        await flushPromises();
    });

    it('Clears queued invalidations when a queued async effect is canceled.', async () => {
        const [get, set] = signal(0);
        const pending = deferred<void>();
        const queue = {
            enqueue: vi.fn((item: AsyncInvalidation) => items.push(item)),
            dequeue: vi.fn(() => items.shift()),
            clear: vi.fn(() => {
                items.length = 0;
            }),
            get size() {
                return items.length;
            },
        } satisfies InvalidationQueue<AsyncInvalidation>;
        const items: AsyncInvalidation[] = [];
        const runs: number[] = [];

        const cancel = effect(
            async () => {
                runs.push(get());
                await pending.promise;
            },
            { concurrency: 'queue', queue },
        );

        set(1);
        set(2);
        cancel();

        expect(queue.enqueue).toBeCalledTimes(2);
        expect(queue.clear).toBeCalledTimes(1);
        expect(queue.size).toBe(0);

        pending.resolve();
        await flushPromises();

        expect(runs).toEqual([0]);
    });

    it('Reports async errors and keeps the effect active by default.', async () => {
        const [get, set] = signal(0);
        const handler = vi.fn();
        const runs: number[] = [];

        effect(
            async () => {
                const value = get();
                runs.push(value);

                if (value === 0) {
                    throw new Error('boom');
                }
            },
            { onError: { handler } },
        );

        await flushPromises();

        expect(handler).toBeCalledTimes(1);
        expect((handler.mock.calls[0] ?? [])[1]).toMatchObject<Partial<AsyncEffectErrorInfo>>({
            generation: 1,
            concurrency: 'cancel',
            canceled: false,
        });

        set(1);
        await flushPromises();

        expect(runs).toEqual([0, 1]);
    });

    it('Reports async errors to console.error by default when no handler is provided.', async () => {
        const [get, set] = signal(0);
        const runs: number[] = [];

        consoleErrorMock.mockClear();

        effect(async () => {
            const value = get();
            runs.push(value);

            if (value === 0) {
                throw new Error('boom');
            }
        });

        await flushPromises();

        expect(consoleErrorMock).toBeCalledTimes(1);
        expect(consoleErrorMock.mock.calls[0]?.[0]).toBe('Error in async effect:');
        expect(consoleErrorMock.mock.calls[0]?.[1]).toBeInstanceOf(Error);
        expect((consoleErrorMock.mock.calls[0]?.[1] as Error | undefined)?.message).toBe('boom');

        set(1);
        await flushPromises();

        expect(runs).toEqual([0, 1]);
    });

    it('Cancels async effects after rejected runs when configured.', async () => {
        const [get, set] = signal(0);
        const handler = vi.fn();
        const runs: number[] = [];

        effect(
            async () => {
                const value = get();
                runs.push(value);
                throw new Error(`boom:${value}`);
            },
            { onError: { mode: 'cancel', handler } },
        );

        await flushPromises();

        set(1);
        await flushPromises();

        expect(handler).toBeCalledTimes(1);
        expect(runs).toEqual([0]);
    });

    it('Escalates async errors to the host when configured.', async () => {
        const [get] = signal(0);
        const handler = vi.fn();
        let queuedThrow: VoidFunction | undefined;
        const queueMicrotaskMock = vi
            .spyOn(globalThis, 'queueMicrotask')
            .mockImplementation((callback: VoidFunction) => {
                queuedThrow = callback;
            });

        try {
            effect(
                async () => {
                    get();
                    throw new Error('boom');
                },
                { onError: { mode: 'throw', handler } },
            );

            await flushPromises();

            expect(handler).toBeCalledTimes(1);
            expect(queueMicrotaskMock).toBeCalledTimes(1);
            expect(queuedThrow).toBeInstanceOf(Function);
            expect(() => queuedThrow?.()).toThrowError('boom');
        } finally {
            queueMicrotaskMock.mockRestore();
        }
    });

    it('Rejects custom queues unless queue concurrency is selected.', () => {
        const queue: InvalidationQueue<AsyncInvalidation> = {
            enqueue() {},
            dequeue() {
                return undefined;
            },
            clear() {},
            get size() {
                return 0;
            },
        };

        expect(() => {
            effect(async () => {}, { concurrency: 'cancel', queue });
        }).toThrowError('The queue option can only be used when concurrency is set to "queue"');
    });

    it('Rejects async cleanup return values in the public types.', () => {
        // @ts-expect-error Async effects must use context.onCleanup() instead of returning cleanup callbacks.
        effect(async () => () => {});
    });

    it('Rejects async-only options for sync effects in the public types.', () => {
        // @ts-expect-error Sync effects cannot use async-only concurrency options.
        effect(() => {}, { concurrency: 'cancel' });
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
        expect(fx).toBeCalledTimes(1);

        setA(0);

        expect(a()).toBe(0);
        expect(fx).toBeCalledTimes(1);

        setB(3);

        expect(a()).toBe(3);
        expect(fx).toBeCalledTimes(2);
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
        }).toThrowError('boom');

        set(1);
        set(2);

        expect(fx).toBeCalledTimes(3);
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
        expect(fx1).toBeCalledTimes(1);

        expect(bValue).toBe(2);
        expect(fx2).toBeCalledTimes(1);

        expect(cValue).toBe(3);
        expect(fx3).toBeCalledTimes(1);

        setA(42);
        setB(73);
        setC(100);

        expect(aValue).toBe(42);
        expect(fx1).toBeCalledTimes(2);

        expect(bValue).toBe(73);
        expect(fx2).toBeCalledTimes(2);

        expect(cValue).toBe(100);
        expect(fx3).toBeCalledTimes(2);

        await store.unlink();

        setA(1000);
        setB(2000);
        setC(3000);

        expect(aValue).toBe(42);
        expect(fx1).toBeCalledTimes(2);

        expect(bValue).toBe(73);
        expect(fx2).toBeCalledTimes(2);

        expect(cValue).toBe(100);
        expect(fx3).toBeCalledTimes(2);
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
        expect(fx1).toBeCalledTimes(1);

        expect(bValue).toBe(2);
        expect(fx2).toBeCalledTimes(1);

        setA(42);
        setB(73);

        expect(aValue).toBe(42);
        expect(fx1).toBeCalledTimes(2);

        expect(bValue).toBe(73);
        expect(fx2).toBeCalledTimes(2);

        await store1.unlink();

        setA(1000);
        setB(2000);

        expect(aValue).toBe(42);
        expect(fx1).toBeCalledTimes(2);

        expect(bValue).toBe(2000);
        expect(fx2).toBeCalledTimes(3);
    });
});
