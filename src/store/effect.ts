import { createAsyncRunner } from './async-runner';
import type { EffectInstance, InternalEffectOptions, StoreState } from './internal';
import type {
    AsyncEffectContext,
    AsyncEffectFunction,
    EffectContext,
    EffectFunction,
    SignalReader,
} from './types';

export function createEffect(
    state: StoreState,
    execute: EffectFunction | AsyncEffectFunction,
    {
        isMemo = false,
        signal,
        queue,
        concurrency = 'cancel',
        onError,
    }: InternalEffectOptions = {},
): () => void {
    if (signal?.aborted) {
        return () => {};
    }

    let canceled = false;

    const cancel = (): void => {
        if (canceled) {
            return;
        }

        canceled = true;
        control.stop();
    };

    const update = (): void => {
        if (canceled) {
            return;
        }
        control.invalidateFromDependency();
    };

    const fx: EffectInstance = {
        isMemo,
        update,
        cancel,
    };

    const control = createAsyncRunner<void, void | (() => void)>(
        state,
        fx,
        {
            signal,
            queue,
            concurrency,
            onError,
        },
        {
            prepare(): void {},
            execute(context): void | (() => void) | Promise<void> {
                return execute({
                    cancel,
                    track<T>(read: SignalReader<T>): T {
                        return context.track(read);
                    },
                    signal: context.signal,
                    onCleanup(cleanup) {
                        context.onCleanup(cleanup);
                    },
                } as EffectContext & AsyncEffectContext);
            },
            handleSyncResult(run, result): boolean {
                if (typeof result === 'function') {
                    run.cleanups.add(result);
                }

                return true;
            },
            commit(): void {},
            shouldCommit(run, _completion, _prepared, info): boolean {
                return run.generation === info.latestStartedGeneration;
            },
            defaultErrorHandler(error): void {
                console.error('Error in async effect:', error);
            },
            onErrorCancel(): void {
                cancel();
            },
        },
    );

    update();

    return cancel;
}
