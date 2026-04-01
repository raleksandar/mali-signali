import { structuralEqual } from './equal';

/**
 * The `SignalConstructor` options.
 */
export interface SignalOptions {
    /**
     * The custom equality function used to compare the previous and the next value.
     *
     * If the function returns `true` the signal will not trigger an update.
     *
     * Defaults to `structuralEqual()`.
     */
    readonly equals?: (a: unknown, b: unknown) => boolean;
}

/**
 * The `EffectConstructor` options.
 */
export interface EffectOptions {
    /**
     * The optional abort signal to cancel the effect.
     */
    readonly signal?: AbortSignal;
}

/**
 * Async effect concurrency policy.
 */
export type AsyncEffectConcurrency = 'cancel' | 'concurrent' | 'queue';

/**
 * Opaque invalidation item passed through async effect queues.
 */
export interface AsyncInvalidation {
    readonly generation: number;
}

/**
 * Queue interface for scheduling async effect invalidations.
 */
export interface InvalidationQueue<T = AsyncInvalidation> {
    enqueue(item: T): void;
    dequeue(): T | undefined;
    clear(): void;
    readonly size: number;
}

/**
 * Error handling mode for async effects.
 */
export type AsyncEffectErrorMode = 'report' | 'cancel' | 'throw';

/**
 * Async effect error metadata.
 */
export interface AsyncEffectErrorInfo {
    readonly generation: number;
    readonly concurrency: AsyncEffectConcurrency;
    readonly signal: AbortSignal;
    readonly canceled: boolean;
}

/**
 * Async effect error handling options.
 */
export interface AsyncEffectErrorOptions {
    /**
     * How to handle rejected async effect runs.
     *
     * Defaults to `'report'`.
     */
    readonly mode?: AsyncEffectErrorMode;

    /**
     * Optional error handler invoked before the selected mode is applied.
     */
    readonly handler?: (error: unknown, info: AsyncEffectErrorInfo) => void;
}

/**
 * Async-only effect options.
 */
export interface AsyncEffectOptions extends EffectOptions {
    /**
     * What to do when an async effect is invalidated while still pending.
     *
     * Defaults to `'cancel'`.
     */
    readonly concurrency?: AsyncEffectConcurrency;

    /**
     * Custom queue used when `concurrency` is set to `'queue'`.
     */
    readonly queue?: InvalidationQueue;

    /**
     * How rejected async effect runs are handled.
     */
    readonly onError?: AsyncEffectErrorOptions;
}

/**
 * A function that reads and returns a signal value.
 */
export type SignalReader<T> = () => T;

/**
 * A function that updates a signal value.
 */
export type SignalUpdater<T> = (value: T | ((prevValue: T) => T)) => void;

/**
 * A signal is a reactive unit of state that can be read and updated.
 *
 * It is a tuple of two functions:
 * - `read` - returns the current value of the signal.
 * - `update` - updates the value of the signal.
 *
 * It also has `read()` and `update()` methods for convenience.
 */
export type Signal<T> = readonly [get: SignalReader<T>, set: SignalUpdater<T>] & {
    read: SignalReader<T>;
    update: SignalUpdater<T>;
};

/**
 * Creates a new signal.
 *
 * A signal is a reactive unit of state that can be read and updated.
 *
 * Returns a tuple of two functions:
 * - `read` - returns the current value of the signal.
 * - `update` - updates the value of the signal.
 *
 * @param initialValue The initial value of the signal.
 * @param options Optional parameters for customizing the behavior.
 * @returns A `[read, update]` tuple of accessor functions.
 */
export type SignalConstructor = <T>(initialValue: T, options?: SignalOptions) => Signal<T>;

/**
 * A function that reads the value of a signal without tracking it.
 */
export type UntrackedReader = <T>(read: SignalReader<T>) => T;

/**
 * The context object passed to the effect function.
 */
export interface EffectContext {
    /**
     * Cancels the effect when called.
     */
    cancel: (this: void) => void;

    /**
     * Abort signal for the current effect run.
     */
    readonly signal: AbortSignal;

    /**
     * Registers a cleanup callback for the current effect run.
     */
    onCleanup(cleanup: () => void): void;
}

/**
 * The synchronous effect function.
 *
 * It may optionally return a cleanup callback that is executed before the
 * effect is re-run or canceled.
 */
export type EffectFunction = (context: EffectContext) => void | (() => void);

/**
 * The asynchronous effect function.
 *
 * Signal reads after the first `await` are not tracked automatically.
 */
export type AsyncEffectContext = EffectContext;

/**
 * The asynchronous effect function.
 */
export type AsyncEffectFunction = (context: AsyncEffectContext) => Promise<void>;

/**
 * Creates and executes a new effect.
 *
 * An effect is a function which will be automatically
 * re-executed whenever any of its dependencies change.
 *
 * Returns a cleanup function that should be called when the effect is no longer needed.
 *
 * @param execute The function to execute.
 * @param options Optional parameters for customizing the behavior.
 * @returns A cleanup function.
 */
export interface EffectConstructor {
    (execute: EffectFunction, options?: EffectOptions): () => void;
    (execute: AsyncEffectFunction, options?: AsyncEffectOptions): () => void;
}

/**
 * Creates a new computed (and read-only) signal.
 *
 * A memo is a special signal that is only re-computed
 * when any of its dependencies change.
 *
 * Returns a getter function that returns the current value of the computation.
 *
 * @param compute The function to compute the value.
 * @param options Optional parameters for customizing the behavior.
 * @returns A getter function.
 */
export type MemoConstructor = <T>(
    compute: () => T,
    options?: SignalOptions & EffectOptions,
) => SignalReader<T>;

/**
 * Executes a batch of updates.
 *
 * The batch function allows you to execute multiple updates while
 * ensuring that the signals are only updated once at the end of the batch.
 *
 * @param execute The function to execute.
 */
export type BatchFunction = (execute: () => void) => void;

/**
 * A store is a collection of related signals and effects.
 *
 * Signals, memos, effects and batch processes from different stores MUST NOT be mixed.
 */
export interface Store {
    /**
     * Creates a new signal.
     *
     * A signal is a reactive unit of state that can be read and updated.
     *
     * Returns a tuple of two functions:
     * - `read` - returns the current value of the signal.
     * - `update` - updates the value of the signal.
     *
     * @param initialValue The initial value of the signal.
     * @param options Optional parameters for customizing the behavior.
     * @returns A `[read, update]` tuple of accessor functions.
     */
    readonly signal: SignalConstructor;

    /**
     * Reads the value of a signal without tracking it.
     *
     * @param read The signal reader function.
     */
    readonly untracked: UntrackedReader;

    /**
     * Creates and executes a new effect.
     *
     * An effect is a function which will be automatically
     * re-executed whenever any of its dependencies change.
     *
     * Returns a cleanup function that should be called when the effect is no longer needed.
     *
     * @param execute The function to execute.
     * @returns A cleanup function.
     */
    readonly effect: EffectConstructor;

    /**
     * Creates a new computed (and read-only) signal.
     *
     * A memo is a special signal that is only re-computed
     * when any of its dependencies change.
     *
     * Returns a getter function that returns the current value of the computation.
     *
     * @param compute The function to compute the value.
     * @param options Optional parameters for customizing the behavior.
     * @returns A getter function.
     */
    readonly memo: MemoConstructor;

    /**
     * Executes a batch of updates.
     *
     * The batch function allows you to execute multiple updates while
     * ensuring that the signals are only updated once at the end of the batch.
     *
     * @param execute The function to execute.
     */
    readonly batch: BatchFunction;

    /**
     * Unlinks all effects in this Store.
     *
     * Use this when you want to "dispose" of a store.
     *
     * After this method is called, all effects and memos will become inert.
     * Reads are still allowed, but updates will not trigger any effects.
     *
     * Creating new signals/memos/effects after this method is called is not recommended.
     *
     * Treat this as a "destruct" method.
     */
    unlink(): Promise<void>;
}

interface EffectInstance {
    readonly isMemo: boolean;
    readonly update: () => void;
    readonly cancel: () => void;
}

interface TrackingRun {
    readonly effect: EffectInstance;
    tracking: boolean;
    onDependencyCleanup(unlink: () => void): void;
}

interface EffectRun extends TrackingRun {
    readonly generation: number;
    readonly cleanups: Set<() => void>;
    readonly dependencyUnlinks: Set<() => void>;
    readonly controller: AbortController;
    readonly signal: AbortSignal;
    state: 'running-sync' | 'pending-async' | 'settled' | 'canceled';
    cleanupComplete: boolean;
    dependenciesComplete: boolean;
    active: boolean;
    removeLifetimeAbort?: (() => void) | undefined;
}

interface InternalEffectOptions {
    readonly isMemo?: boolean;
    readonly signal?: AbortSignal;
    readonly queue?: InvalidationQueue;
    readonly concurrency?: AsyncEffectConcurrency;
    readonly onError?: AsyncEffectErrorOptions;
}

/**
 * Default FIFO queue implementation for async effects.
 *
 * It is backed by a simple array and can be reused for custom queueing strategies.
 */
export class DefaultInvalidationQueue<T = AsyncInvalidation> implements InvalidationQueue<T> {
    #items: T[] = [];

    public enqueue(item: T): void {
        this.#items.push(item);
    }

    public dequeue(): T | undefined {
        return this.#items.shift();
    }

    public clear(): void {
        this.#items.length = 0;
    }

    public get size(): number {
        return this.#items.length;
    }
}

const signalTuple = class Signal<T> extends Array<SignalReader<T> | SignalUpdater<T>> {
    public readonly read: SignalReader<T>;
    public readonly update: SignalUpdater<T>;

    constructor(read: SignalReader<T>, update: SignalUpdater<T>) {
        super(2);
        this.read = this[0] = read;
        this.update = this[1] = update;
    }
};

const store = class Store implements Store {
    #batchLevel = 0;
    #isUpdating = false;
    #isTracking = true;
    readonly #pendingEffects: Set<EffectInstance> = new Set();
    readonly #runs: TrackingRun[] = [];
    readonly #activeEffects: Set<EffectInstance> = new Set();

    public signal = <T>(
        initialValue: T,
        { equals = structuralEqual }: SignalOptions = {},
    ): Signal<T> => {
        const dependencies = new Set<TrackingRun>();
        let value = initialValue;

        const read = (): T => {
            if (this.#isTracking) {
                const run = this.#runs.at(-1);
                if (run?.tracking && !dependencies.has(run)) {
                    dependencies.add(run);
                    run.onDependencyCleanup(() => dependencies.delete(run));
                }
            }
            return value;
        };

        const write = (newValue: T | ((prevValue: T) => T)): void => {
            newValue = newValue instanceof Function ? newValue(value) : newValue;

            if (equals(value, newValue)) {
                return;
            }

            value = newValue;

            const effects = new Set<EffectInstance>();

            for (const run of dependencies) {
                effects.add(run.effect);
            }

            for (const fx of effects) {
                this.#pendingEffects.add(fx);
            }

            this.#flush();
        };

        return new signalTuple(read, write) as unknown as Signal<T>;
    };

    public untracked = <T>(read: SignalReader<T>): T => {
        const wasTracking = this.#isTracking;

        this.#isTracking = false;

        try {
            return read();
        } finally {
            this.#isTracking = wasTracking;
        }
    };

    #flush(): void {
        if (this.#isUpdating) {
            return;
        }
        this.#isUpdating = true;

        const memos = Array.from(this.#pendingEffects).filter((fx) => fx.isMemo);

        for (const fx of memos) {
            fx.update();
            this.#pendingEffects.delete(fx);
        }

        this.#isUpdating = false;

        if (this.#batchLevel > 0) {
            return;
        }

        const effects = Array.from(this.#pendingEffects);
        this.#pendingEffects.clear();

        for (const fx of effects) {
            fx.update();
        }
    }

    #createEffect(
        execute: EffectFunction | AsyncEffectFunction,
        {
            isMemo = false,
            signal,
            queue,
            concurrency = 'cancel',
            onError,
        }: InternalEffectOptions = {},
    ): () => void {
        if (signal && signal.aborted) {
            return () => {};
        }
        if (queue && concurrency !== 'queue') {
            throw new Error('The queue option can only be used when concurrency is set to "queue"');
        }

        const activeRuns = new Set<EffectRun>();
        const pendingQueue = concurrency === 'queue' ? queue ?? new DefaultInvalidationQueue() : undefined;
        const effectController = new AbortController();
        const errorMode = onError?.mode ?? 'report';
        const errorHandler =
            onError?.handler ??
            ((error: unknown) => {
                console.error('Error in async effect:', error);
            });

        let generation = 0;
        let invalidationGeneration = 0;
        let pendingRerun = false;
        let currentCommittedRun: EffectRun | undefined;
        let canceled = false;

        const clearCommittedRun = (): void => {
            if (!currentCommittedRun) {
                return;
            }
            cleanupRun(currentCommittedRun);
            currentCommittedRun = undefined;
        };

        const cleanupCallback = (cleanup: () => void): void => {
            try {
                cleanup();
            } catch (error) {
                console.error('Error during effect cleanup:', error);
            }
        };

        const cleanupRun = (run: EffectRun): void => {
            if (!run.dependenciesComplete) {
                for (const unlink of run.dependencyUnlinks) {
                    unlink();
                }
                run.dependencyUnlinks.clear();
                run.dependenciesComplete = true;
            }

            if (!run.cleanupComplete) {
                for (const cleanup of run.cleanups) {
                    cleanupCallback(cleanup);
                }
                run.cleanups.clear();
                run.cleanupComplete = true;
            }

            if (run.removeLifetimeAbort) {
                run.removeLifetimeAbort();
                run.removeLifetimeAbort = undefined;
            }

            if (currentCommittedRun === run) {
                currentCommittedRun = undefined;
            }
        };

        const finishRun = (run: EffectRun): void => {
            activeRuns.delete(run);
            run.active = false;
        };

        const hasBlockingRun = (): boolean => {
            for (const run of activeRuns) {
                if (run.state === 'pending-async' || run.state === 'canceled') {
                    return true;
                }
            }
            return false;
        };

        const handleAsyncError = (error: unknown, run: EffectRun): void => {
            const info: AsyncEffectErrorInfo = {
                generation: run.generation,
                concurrency,
                signal: run.signal,
                canceled: run.signal.aborted,
            };

            errorHandler(error, info);

            if (errorMode === 'cancel') {
                cancel();
            } else if (errorMode === 'throw') {
                queueMicrotask(() => {
                    throw error;
                });
            }
        };

        const startNextQueuedRun = (): void => {
            if (canceled || concurrency !== 'queue' || !pendingQueue || hasBlockingRun()) {
                return;
            }

            const nextInvalidation = pendingQueue.dequeue();
            if (!nextInvalidation) {
                return;
            }

            void nextInvalidation;
            startRun();
        };

        const finalizeAsyncRun = (run: EffectRun, error?: unknown): void => {
            finishRun(run);

            if (canceled) {
                cleanupRun(run);
                startNextQueuedRun();
                return;
            }

            if (run.state === 'canceled') {
                pendingRerun = false;
                startRun();
                return;
            }

            run.state = 'settled';

            if (error !== undefined) {
                handleAsyncError(error, run);
            }

            if (canceled) {
                cleanupRun(run);
                startNextQueuedRun();
                return;
            }

            if (run.generation === generation) {
                currentCommittedRun = run;
            } else {
                cleanupRun(run);
            }

            startNextQueuedRun();
        };

        const registerCleanup = (run: EffectRun, cleanup: () => void): void => {
            if (run.cleanupComplete) {
                cleanupCallback(cleanup);
                return;
            }

            run.cleanups.add(cleanup);
        };

        const createRun = (): EffectRun => {
            const controller = new AbortController();
            const run: EffectRun = {
                effect: fx,
                generation: ++generation,
                cleanups: new Set(),
                dependencyUnlinks: new Set(),
                controller,
                signal: controller.signal,
                state: 'running-sync',
                cleanupComplete: false,
                dependenciesComplete: false,
                active: true,
                tracking: true,
                onDependencyCleanup(unlink) {
                    this.dependencyUnlinks.add(unlink);
                },
            };

            const abort = (): void => {
                controller.abort();
            };

            effectController.signal.addEventListener('abort', abort, { once: true });
            run.removeLifetimeAbort = () => {
                effectController.signal.removeEventListener('abort', abort);
            };

            return run;
        };

        const cancelPendingRun = (run: EffectRun): void => {
            run.controller.abort();
            run.state = 'canceled';
            cleanupRun(run);
        };

        const startRun = (): void => {
            clearCommittedRun();

            if (canceled) {
                return;
            }

            const run = createRun();
            activeRuns.add(run);
            this.#activeEffects.add(fx);
            this.#runs.push(run);

            let result: void | (() => void) | Promise<void>;

            try {
                result = execute({
                    cancel,
                    signal: run.signal,
                    onCleanup(cleanup) {
                        registerCleanup(run, cleanup);
                    },
                } as EffectContext & AsyncEffectContext);
            } catch (error) {
                run.tracking = false;
                this.#runs.pop();
                finishRun(run);
                cleanupRun(run);
                canceled = true;
                this.#pendingEffects.delete(fx);
                this.#activeEffects.delete(fx);
                effectController.abort();
                throw error;
            }

            run.tracking = false;
            this.#runs.pop();

            if (isPromiseLike(result)) {
                run.state = run.state === 'canceled' ? 'canceled' : 'pending-async';
                void Promise.resolve(result).then(
                    () => {
                        finalizeAsyncRun(run);
                    },
                    (error: unknown) => {
                        finalizeAsyncRun(run, error);
                    },
                );
                return;
            }

            if (result instanceof Function) {
                registerCleanup(run, result);
            }

            if (canceled || run.state === 'canceled') {
                finishRun(run);
                cleanupRun(run);
                startNextQueuedRun();
                return;
            }

            run.state = 'settled';
            currentCommittedRun = run;
        };

        const update = (): void => {
            if (canceled) {
                return;
            }

            if (this.#runs.some((run) => run.effect === fx && run.tracking)) {
                throw new Error('Cyclic dependency detected');
            }

            if (isMemo) {
                startRun();
                return;
            }

            if (concurrency === 'cancel') {
                if (hasBlockingRun()) {
                    pendingRerun = true;
                    for (const run of activeRuns) {
                        cancelPendingRun(run);
                    }
                    return;
                }

                startRun();
                return;
            }

            if (concurrency === 'concurrent') {
                startRun();
                return;
            }

            if (hasBlockingRun()) {
                pendingQueue?.enqueue({ generation: ++invalidationGeneration });
                return;
            }

            startRun();
        };

        const cancel = (): void => {
            if (canceled) {
                return;
            }

            canceled = true;
            pendingRerun = false;
            pendingQueue?.clear();
            this.#pendingEffects.delete(fx);
            this.#activeEffects.delete(fx);
            effectController.abort();
            clearCommittedRun();

            for (const run of activeRuns) {
                run.tracking = false;

                if (run.state === 'running-sync') {
                    run.state = 'canceled';
                    continue;
                }

                if (!run.signal.aborted) {
                    run.controller.abort();
                }

                run.state = 'canceled';
                cleanupRun(run);
            }
        };

        if (signal) {
            signal.addEventListener('abort', cancel, { once: true });
        }

        const fx: EffectInstance = {
            isMemo,
            update,
            cancel,
        };

        update();

        return cancel;
    }

    public effect: EffectConstructor = (
        execute: EffectFunction | AsyncEffectFunction,
        options?: EffectOptions | AsyncEffectOptions,
    ): (() => void) => {
        return this.#createEffect(execute, options);
    };

    public memo = <T>(
        compute: () => T,
        options?: SignalOptions & EffectOptions,
    ): SignalReader<T> => {
        const [read, write] = this.signal<T>(undefined as T, options);

        this.#createEffect(() => write(compute()), { ...options, isMemo: true });

        return read;
    };

    public batch = (execute: () => void): void => {
        this.#batchLevel++;

        try {
            execute();
        } finally {
            if (--this.#batchLevel === 0) {
                this.#flush();
            }
        }
    };

    public unlink = (): Promise<void> => {
        return Promise.resolve().then(() => {
            for (const fx of this.#activeEffects) {
                fx.cancel();
            }
            this.#activeEffects.clear();
        });
    };
};

function isPromiseLike(value: unknown): value is PromiseLike<void> {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        'then' in value &&
        typeof value.then === 'function'
    );
}

/**
 * Creates a new store.
 *
 * A store is a collection of related signals and effects.
 *
 * Signals, memos, effects and batch processes from different stores MUST NOT be mixed.
 *
 * @returns A new store.
 */
export function createStore(): Store {
    return new store();
}
