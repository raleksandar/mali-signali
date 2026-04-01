import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { deferred, flushPromises } from '../test/store-test-helpers';
import {
    type AsyncInvalidation,
    createStore,
    DefaultInvalidationQueue,
    type EffectConstructor,
    type InvalidationQueue,
    type MemoConstructor,
    type ResourceConstructor,
    type ResourceContext,
    type ResourceOptions,
    type ResourceState,
    type RunCause,
    type SignalConstructor,
} from '../store';

describe('resource()', () => {
    let signal: SignalConstructor;
    let memo: MemoConstructor;
    let effect: EffectConstructor;
    let resource: ResourceConstructor;

    beforeEach(() => {
        const store = createStore();
        signal = store.signal;
        memo = store.memo;
        effect = store.effect;
        resource = store.resource;
    });

    it('Exposes resource types in the public API.', () => {
        expectTypeOf<ResourceOptions>().toExtend<{
            writes?: 'latest' | 'settled';
            concurrency?: 'cancel' | 'concurrent' | 'queue';
        }>();
        expectTypeOf<RunCause>().toEqualTypeOf<'init' | 'dependency' | 'refresh'>();
        expectTypeOf<ResourceContext<number>>().toExtend<{
            refresh: () => void;
            abort: () => void;
            reset: () => void;
            previous: ResourceState<number>;
            cause: RunCause;
        }>();
    });

    it('Creates a resource that transitions from loading to ready.', async () => {
        const [read] = resource(async () => 42);

        expect(read()).toEqual({
            status: 'loading',
            value: undefined,
            error: undefined,
            isStale: false,
        });

        await flushPromises();

        expect(read()).toEqual({
            status: 'ready',
            value: 42,
            error: undefined,
            isStale: false,
        });
    });

    it('Tracks dependencies before await and reruns with dependency cause.', async () => {
        const [source, setSource] = signal(1);
        const causes: RunCause[] = [];
        const previousStatuses: Array<ResourceState<number>['status']> = [];
        const [read] = resource(async ({ previous, cause }) => {
            causes.push(cause);
            previousStatuses.push(previous.status);
            return source() * 2;
        });

        await flushPromises();

        expect(read().value).toBe(2);
        expect(causes).toEqual(['init']);
        expect(previousStatuses).toEqual(['idle']);

        setSource(2);
        await flushPromises();

        expect(read().value).toBe(4);
        expect(causes).toEqual(['init', 'dependency']);
        expect(previousStatuses).toEqual(['idle', 'ready']);
    });

    it('Tracks dependencies after await only when context.track() is used.', async () => {
        const [tracked, setTracked] = signal(1);
        const [untracked, setUntracked] = signal(10);
        const values: Array<[number, number]> = [];
        const [read] = resource(async ({ track }) => {
            await Promise.resolve();
            return [track(tracked), untracked()] as [number, number];
        });

        await flushPromises();
        expect(read().value).toEqual([1, 10]);

        setUntracked(20);
        await flushPromises();
        expect(read().value).toEqual([1, 10]);

        setTracked(2);
        await flushPromises();
        expect(read().value).toEqual([2, 20]);

        values.push(read().value as [number, number]);
        expect(values).toEqual([[2, 20]]);
    });

    it('Tracks memo readers when they are wrapped in context.track().', async () => {
        const [source, setSource] = signal(2);
        const doubled = memo(() => source() * 2);
        const [read] = resource(async ({ track }) => {
            await Promise.resolve();
            return track(doubled);
        });

        await flushPromises();
        expect(read().value).toBe(4);

        setSource(3);
        await flushPromises();
        expect(read().value).toBe(6);
    });

    it('Detects cycles in direct resource dependencies.', () => {
        const [get, set] = signal(0);
        const [read] = resource<number, Error>(
            ((() => {
                set(get() + 1);
                return Promise.resolve(1);
            }) as unknown) as (context: ResourceContext<number, Error>) => Promise<number>,
        );

        return flushPromises().then(() => {
            expect(read()).toMatchObject({
                status: 'error',
                value: undefined,
                isStale: false,
            });
            expect((read().error as Error).message).toBe('Cyclic dependency detected');
        });
    });

    it('Detects cycles in indirect resource dependencies.', () => {
        const [a, setA] = signal(0);
        const [b, setB] = signal(0);

        effect(() => {
            setA(b());
        });

        const [read] = resource<number, Error>(
            ((() => {
                setB(a() + 1);
                return Promise.resolve(1);
            }) as unknown) as (context: ResourceContext<number, Error>) => Promise<number>,
        );

        return flushPromises().then(() => {
            expect(read()).toMatchObject({
                status: 'error',
                value: undefined,
                isStale: false,
            });
            expect((read().error as Error).message).toBe('Cyclic dependency detected');
        });
    });

    it('Detects cycles created during context.track() reads.', () => {
        const [tracked, setTracked] = signal(0);
        const [read] = resource<number, Error>(async ({ track }) => {
            await Promise.resolve();
            return track(() => {
                setTracked(tracked() + 1);
                return 1;
            });
        });

        return flushPromises().then(() => {
            expect(read()).toMatchObject({
                status: 'error',
                value: undefined,
                isStale: false,
            });
            expect((read().error as Error).message).toBe('Cyclic dependency detected');
        });
    });

    it('Keeps the previous value while refreshing.', async () => {
        const pending = deferred<number>();
        const [read, controls] = resource(async () => pending.promise);

        expect(read().status).toBe('loading');

        pending.resolve(1);
        await flushPromises();

        controls.refresh();

        expect(read()).toEqual({
            status: 'loading',
            value: 1,
            error: undefined,
            isStale: true,
        });
    });

    it('Runs late cleanup registrations immediately after resource cancellation.', async () => {
        const pending = deferred<number>();
        const cleanup = vi.fn();
        const [read, controls] = resource(async ({ onCleanup }) => {
            await pending.promise;
            onCleanup(cleanup);
            return 1;
        });

        controls.abort();
        pending.resolve(1);
        await flushPromises();

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(read()).toEqual({
            status: 'loading',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Runs registered cleanup callbacks when a pending resource is canceled.', () => {
        const pending = deferred<number>();
        const cleanup = vi.fn();
        const [read, controls] = resource(async ({ onCleanup }) => {
            onCleanup(cleanup);
            return pending.promise;
        });

        controls.abort();

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(read()).toEqual({
            status: 'loading',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Runs committed resource cleanup callbacks before the next run and logs thrown cleanup errors.', async () => {
        const [source, setSource] = signal(1);
        const cleanup = vi.fn(() => {
            throw new Error('boom');
        });
        const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const [read] = resource(async ({ onCleanup }) => {
                const value = source();
                onCleanup(cleanup);
                return value;
            });

            await flushPromises();
            setSource(2);
            await flushPromises();

            expect(read().value).toBe(2);
            expect(cleanup).toHaveBeenCalledTimes(1);
            expect(consoleErrorMock).toHaveBeenCalledTimes(1);
            expect(consoleErrorMock.mock.calls[0]?.[0]).toBe('Error during effect cleanup:');
            expect((consoleErrorMock.mock.calls[0]?.[1] as Error).message).toBe('boom');
        } finally {
            consoleErrorMock.mockRestore();
        }
    });

    it('Uses refresh cause for manual refreshes.', async () => {
        const causes: RunCause[] = [];
        const [read, controls] = resource(async ({ cause }) => {
            causes.push(cause);
            return causes.length;
        });

        await flushPromises();
        expect(read().value).toBe(1);

        controls.refresh();
        await flushPromises();

        expect(read().value).toBe(2);
        expect(causes).toEqual(['init', 'refresh']);
    });

    it('Exposes refresh(), abort(), and reset() through the resource context.', async () => {
        const first = deferred<number>();
        let refresh!: () => void;
        let abort!: () => void;
        let reset!: () => void;
        let runs = 0;

        const [read] = resource(async (context) => {
            runs++;
            refresh = context.refresh;
            abort = context.abort;
            reset = context.reset;

            if (runs === 1) {
                return first.promise;
            }

            return runs;
        });

        expect(read().status).toBe('loading');

        abort();
        first.resolve(1);
        await flushPromises();

        expect(read()).toEqual({
            status: 'loading',
            value: undefined,
            error: undefined,
            isStale: false,
        });
        expect(runs).toBe(1);

        refresh();
        await flushPromises();

        expect(read()).toEqual({
            status: 'ready',
            value: 2,
            error: undefined,
            isStale: false,
        });
        expect(runs).toBe(2);

        reset();

        expect(read()).toEqual({
            status: 'idle',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Stops the resource permanently when a resource loader calls cancel() synchronously.', async () => {
        const [source, setSource] = signal(1);
        let runs = 0;
        const [read, controls] = resource(async ({ cancel }) => {
            runs++;
            const value = source();

            if (runs === 1) {
                cancel();
                return value;
            }

            return value;
        });

        await flushPromises();
        expect(read()).toEqual({
            status: 'loading',
            value: undefined,
            error: undefined,
            isStale: false,
        });
        expect(runs).toBe(1);

        setSource(2);
        await flushPromises();
        controls.refresh();
        await flushPromises();

        expect(runs).toBe(1);
        expect(read()).toEqual({
            status: 'loading',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Rejects custom queues unless queue concurrency is selected for resources.', () => {
        const queue = new DefaultInvalidationQueue<AsyncInvalidation>();

        expect(() => {
            resource(async () => 1, { concurrency: 'cancel', queue });
        }).toThrow('The queue option can only be used when concurrency is set to "queue"');
    });

    it('Preserves previous values on accepted errors.', async () => {
        const [source, setSource] = signal(0);
        const [read] = resource<number, Error>(async () => {
            if (source() === 0) {
                return 1;
            }
            throw new Error('boom');
        });

        await flushPromises();
        expect(read().status).toBe('ready');

        setSource(1);
        await flushPromises();

        expect(read()).toMatchObject({
            status: 'error',
            value: 1,
            isStale: true,
        });
        expect((read().error as Error).message).toBe('boom');
    });

    it('Uses cancel error handling without throwing and keeps the latest error state.', async () => {
        const handler = vi.fn();
        const [read] = resource<number, Error>(
            async () => {
                throw new Error('boom');
            },
            { onError: { mode: 'cancel', handler } },
        );

        await flushPromises();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(read()).toMatchObject({
            status: 'error',
            value: undefined,
            isStale: false,
        });
        expect((read().error as Error).message).toBe('boom');
    });

    it('Treats synchronously throwing loaders as rejected resource runs.', async () => {
        const [read] = resource<number, Error>(
            ((() => {
                throw new Error('boom');
            }) as unknown) as (context: ResourceContext<number, Error>) => Promise<number>,
        );

        await flushPromises();

        expect(read()).toMatchObject({
            status: 'error',
            value: undefined,
            isStale: false,
        });
        expect((read().error as Error).message).toBe('boom');
    });

    it('Uses throw error handling to surface resource rejections on a microtask.', async () => {
        const handler = vi.fn();
        let queuedThrow: VoidFunction | undefined;
        const queueMicrotaskMock = vi
            .spyOn(globalThis, 'queueMicrotask')
            .mockImplementation((callback: VoidFunction) => {
                queuedThrow = callback;
            });

        try {
            const [read] = resource<number, Error>(
                async () => {
                    throw new Error('boom');
                },
                { onError: { mode: 'throw', handler } },
            );

            await flushPromises();

            expect(handler).toHaveBeenCalledTimes(1);
            expect(queueMicrotaskMock).toHaveBeenCalledTimes(1);
            expect(queuedThrow).toBeInstanceOf(Function);
            expect(() => queuedThrow?.()).toThrow('boom');
            expect((read().error as Error).message).toBe('boom');
        } finally {
            queueMicrotaskMock.mockRestore();
        }
    });

    it('Supports latest-only guarded writes by default.', async () => {
        const [source, setSource] = signal(0);
        const first = deferred<number>();
        const second = deferred<number>();
        const [read] = resource(
            async () => {
                if (source() === 0) {
                    return first.promise;
                }
                return second.promise;
            },
            { concurrency: 'concurrent' },
        );

        setSource(1);

        second.resolve(2);
        await flushPromises();
        expect(read().value).toBe(2);

        first.resolve(1);
        await flushPromises();
        expect(read().value).toBe(2);
    });

    it('Coalesces invalidations while a canceled resource run is still settling.', async () => {
        const [source, setSource] = signal(0);
        const first = deferred<number>();
        const second = deferred<number>();
        const starts: number[] = [];
        const [read] = resource(async () => {
            const value = source();
            starts.push(value);
            return starts.length === 1 ? first.promise : second.promise;
        });

        setSource(1);
        setSource(2);

        first.resolve(0);
        await flushPromises();

        second.resolve(2);
        await flushPromises();

        expect(starts).toEqual([0, 2]);
        expect(read().value).toBe(2);
    });

    it('Allows settled writes to overwrite in completion order.', async () => {
        const [source, setSource] = signal(0);
        const first = deferred<number>();
        const second = deferred<number>();
        const [read] = resource(
            async () => {
                if (source() === 0) {
                    return first.promise;
                }
                return second.promise;
            },
            { concurrency: 'concurrent', writes: 'settled' },
        );

        setSource(1);

        second.resolve(2);
        await flushPromises();
        expect(read().value).toBe(2);

        first.resolve(1);
        await flushPromises();
        expect(read().value).toBe(1);
    });

    it('Cancels active work without resetting state and allows refreshing again.', async () => {
        const [trigger] = signal(0);
        const first = deferred<number>();
        const second = deferred<number>();
        let runs = 0;
        const [read, controls] = resource(async ({ signal }) => {
            trigger();
            runs++;
            const pending = runs === 1 ? first : second;
            await pending.promise;
            return signal.aborted ? -1 : runs;
        });

        controls.abort();
        first.resolve(1);
        await flushPromises();

        expect(read()).toEqual({
            status: 'loading',
            value: undefined,
            error: undefined,
            isStale: false,
        });

        controls.refresh();
        expect(read().status).toBe('loading');

        second.resolve(2);
        await flushPromises();

        expect(read().value).toBe(2);
    });

    it('Does not abort a resource run twice when controls.abort() is called after it was already aborted.', async () => {
        const [trigger, setTrigger] = signal(0);
        const first = deferred<number>();
        const second = deferred<number>();
        const firstSignals: AbortSignal[] = [];
        const [read, controls] = resource(async ({ signal }) => {
            const value = trigger();

            if (value === 0) {
                firstSignals.push(signal);
                return first.promise;
            }

            return second.promise;
        });

        setTrigger(1);
        expect(firstSignals[0]?.aborted).toBe(true);

        controls.abort();
        first.resolve(0);
        await flushPromises();

        expect(read().status).toBe('loading');

        second.resolve(2);
        await flushPromises();

        expect(read().status).toBe('loading');
    });

    it('Does not resubscribe post-await tracked dependencies from canceled stale runs.', async () => {
        const [trigger, setTrigger] = signal(0);
        const [trackedAfterAwait, setTrackedAfterAwait] = signal(0);
        const first = deferred<void>();
        const second = deferred<void>();
        const runs: number[] = [];
        const trackedValues: number[] = [];
        const [read] = resource(
            async ({ track }) => {
                const value = trigger();
                runs.push(value);

                if (value === 0) {
                    await first.promise;
                    trackedValues.push(track(trackedAfterAwait));
                    return 0;
                }

                await second.promise;
                return 1;
            },
            { concurrency: 'cancel' },
        );

        setTrigger(1);
        first.resolve();
        await flushPromises();

        expect(read().status).toBe('loading');

        second.resolve();
        await flushPromises();

        expect(read().value).toBe(1);
        expect(runs).toEqual([0, 1]);
        expect(trackedValues).toEqual([0]);

        setTrackedAfterAwait(1);
        await flushPromises();

        expect(runs).toEqual([0, 1]);
    });

    it('Resets to idle and reruns on the next dependency invalidation.', async () => {
        const [source, setSource] = signal(1);
        const [read, controls] = resource(async () => source() * 2);

        await flushPromises();
        expect(read().value).toBe(2);

        controls.reset();
        expect(read()).toEqual({
            status: 'idle',
            value: undefined,
            error: undefined,
            isStale: false,
        });

        setSource(2);
        expect(read().status).toBe('loading');

        await flushPromises();
        expect(read().value).toBe(4);
    });

    it('Clears queued invalidations when canceled or reset.', async () => {
        const [source, setSource] = signal(0);
        const pending = deferred<number>();
        const items: AsyncInvalidation[] = [];
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

        const controls = resource(
            async () => {
                source();
                return pending.promise;
            },
            { concurrency: 'queue', queue },
        )[1];

        setSource(1);
        setSource(2);
        controls.abort();
        controls.reset();

        expect(queue.enqueue).toHaveBeenCalledTimes(2);
        expect(queue.clear).toHaveBeenCalledTimes(2);
        expect(queue.size).toBe(0);

        pending.resolve(1);
        await flushPromises();
    });

    it('Supports queue concurrency for resource loads.', async () => {
        const [source, setSource] = signal(0);
        const first = deferred<number>();
        const second = deferred<number>();
        const third = deferred<number>();
        const starts: number[] = [];
        const [read] = resource(
            async () => {
                const value = source();
                starts.push(value);
                if (starts.length === 1) {
                    return first.promise;
                }
                if (starts.length === 2) {
                    return second.promise;
                }
                return third.promise;
            },
            { concurrency: 'queue' },
        );

        setSource(1);
        setSource(2);

        first.resolve(0);
        await flushPromises();
        second.resolve(2);
        await flushPromises();
        third.resolve(2);
        await flushPromises();

        expect(starts).toEqual([0, 2, 2]);
        expect(read().value).toBe(2);
    });

    it('Handles pre-aborted lifetime signals without starting.', () => {
        const controller = new AbortController();
        controller.abort();

        const [read, controls] = resource(async () => 1, { signal: controller.signal });

        expect(read()).toEqual({
            status: 'idle',
            value: undefined,
            error: undefined,
            isStale: false,
        });

        controls.refresh();
        controls.abort();
        controls.reset();
        expect(read().status).toBe('idle');
    });

    it('Stops the resource when the lifetime signal aborts and ignores later control calls.', async () => {
        const controller = new AbortController();
        const pending = deferred<number>();
        const [read, controls] = resource(async () => pending.promise, { signal: controller.signal });

        controller.abort();
        controls.refresh();
        controls.abort();
        controls.reset();

        pending.resolve(1);
        await flushPromises();

        expect(read()).toEqual({
            status: 'loading',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });

    it('Stops already-aborted runs without aborting them twice during store unlink.', async () => {
        const store = createStore();
        const pending = deferred<number>();
        const [read, controls] = store.resource(async () => pending.promise);

        controls.abort();
        await store.unlink();

        pending.resolve(1);
        await flushPromises();

        expect(read()).toEqual({
            status: 'loading',
            value: undefined,
            error: undefined,
            isStale: false,
        });
    });
});
