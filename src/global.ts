import { createStore, type Signal, type SignalOptions } from './store';

/**
 * The global store.
 * @internal
 */
const globalStore = createStore();

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
export function signal<T>(initialValue: T, options?: SignalOptions): Signal<T> {
    return globalStore.signal(initialValue, options);
}

/**
 * Creates and executes a new effect in the global store.
 *
 * An effect is a function which will be automatically
 * re-executed whenever any of its dependencies change.
 *
 * Returns a cleanup function that should be called when the effect is no longer needed.
 *
 * @param execute The function to execute.
 * @returns A cleanup function.
 */
export function effect(execute: () => void): () => void {
    return globalStore.effect(execute);
}

/**
 * Creates a new computed (and read-only) signal in the global store.
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
export function memo<T>(compute: () => T, options?: SignalOptions): () => T {
    return globalStore.memo(compute, options);
}

/**
 * Executes a batch of updates within the global store.
 *
 * The batch function allows you to execute multiple updates while
 * ensuring that the signals are only updated once at the end of the batch.
 *
 * @param execute The function to execute.
 */
export function batch(execute: () => void): void {
    globalStore.batch(execute);
}
