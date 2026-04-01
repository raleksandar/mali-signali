import { createEffect } from './effect';
import { flushPendingEffects } from './flush';
import type { StoreState } from './internal';
import { createResource } from './resource';
import { createSignal, readUntracked } from './signal';
import type {
    AsyncEffectFunction,
    AsyncEffectOptions,
    EffectConstructor,
    EffectFunction,
    EffectOptions,
    MemoConstructor,
    ResourceConstructor,
    ResourceContext,
    ResourceOptions,
    SignalOptions,
    SignalReader,
    Store,
    UntrackedReader,
} from './types';

class StoreImpl implements Store {
    readonly #state: StoreState = {
        batchLevel: 0,
        isUpdating: false,
        isTracking: true,
        pendingEffects: new Set(),
        runs: [],
        activeEffects: new Set(),
    };

    public signal = <T>(initialValue: T, options?: SignalOptions) => {
        return createSignal(this.#state, initialValue, options);
    };

    public untracked: UntrackedReader = <T>(read: () => T): T => {
        return readUntracked(this.#state, read);
    };

    public effect: EffectConstructor = (
        execute: EffectFunction | AsyncEffectFunction,
        options?: EffectOptions | AsyncEffectOptions,
    ): (() => void) => {
        return createEffect(this.#state, execute, options);
    };

    public memo: MemoConstructor = <T>(
        compute: () => T,
        options?: SignalOptions & EffectOptions,
    ): SignalReader<T> => {
        const [read, write] = createSignal<T>(this.#state, undefined as T, options);

        createEffect(this.#state, () => write(compute()), { ...options, isMemo: true });

        return read;
    };

    public resource: ResourceConstructor = <T, E = unknown>(
        load: (context: ResourceContext<T, E>) => Promise<T>,
        options?: ResourceOptions,
    ) => {
        return createResource<T, E>(this.#state, load, options);
    };

    public batch = (execute: () => void): void => {
        this.#state.batchLevel++;

        try {
            execute();
        } finally {
            if (--this.#state.batchLevel === 0) {
                flushPendingEffects(this.#state);
            }
        }
    };

    public unlink = (): Promise<void> => {
        return Promise.resolve().then(() => {
            for (const fx of this.#state.activeEffects) {
                fx.cancel();
            }
            this.#state.activeEffects.clear();
        });
    };
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
    return new StoreImpl();
}
