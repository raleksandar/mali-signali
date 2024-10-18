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
export type Signal<T> = [get: SignalReader<T>, set: SignalUpdater<T>] & {
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
export type EffectConstructor = (execute: () => void) => () => void;

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
export type MemoConstructor = <T>(compute: () => T, options?: SignalOptions) => SignalReader<T>;

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
}

interface EffectInstance {
    readonly isMemo: boolean;
    readonly update: () => void;
    readonly onCleanup: (unlink: () => void) => void;
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
    readonly #pendingEffects: Set<EffectInstance> = new Set();
    readonly #runningEffects: EffectInstance[] = [];

    public signal = <T>(
        initialValue: T,
        { equals = structuralEqual }: SignalOptions = {},
    ): Signal<T> => {
        const dependencies = new Set<EffectInstance>();
        let value = initialValue;

        const read = (): T => {
            const fx = this.#runningEffects.at(-1);
            if (fx && !dependencies.has(fx)) {
                dependencies.add(fx);
                fx.onCleanup(() => dependencies.delete(fx));
            }
            return value;
        };

        const write = (newValue: T | ((prevValue: T) => T)): void => {
            newValue = newValue instanceof Function ? newValue(value) : newValue;

            if (equals(value, newValue)) {
                return;
            }

            value = newValue;

            for (const fx of dependencies) {
                this.#pendingEffects.add(fx);
            }

            this.#flush();
        };

        return new signalTuple(read, write) as Signal<T>;
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

    #createEffect(execute: () => void, isMemo: boolean): () => void {
        // eslint-disable-next-line prefer-const
        let fx: EffectInstance;

        const dependencies = new Set<() => void>();
        let onCleanup: (() => void) | void;

        const cleanup = () => {
            for (const unlink of dependencies) {
                unlink();
            }

            dependencies.clear();

            if (onCleanup) {
                try {
                    onCleanup();
                } catch (error) {
                    console.error('Error during effect cleanup:', error);
                }
            }
        };

        const update = () => {
            cleanup();

            if (this.#runningEffects.includes(fx)) {
                throw new Error('Cyclic dependency detected');
            }

            this.#runningEffects.push(fx);

            try {
                onCleanup = execute();
            } catch (error) {
                cleanup();
                throw error;
            } finally {
                this.#runningEffects.pop();
            }
        };

        fx = {
            isMemo,
            update,
            onCleanup(unlink) {
                dependencies.add(unlink);
            },
        };

        update();

        return cleanup;
    }

    public effect = (execute: () => void): (() => void) => {
        return this.#createEffect(execute, false);
    };

    public memo = <T>(compute: () => T, options?: SignalOptions): SignalReader<T> => {
        const [read, write] = this.signal<T>(undefined as T, options);

        this.#createEffect(() => {
            write(compute());
        }, true);

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
};

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
