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
