import type { EffectInstance, EffectRun, InternalEffectOptions, StoreState } from './internal';
import { DefaultInvalidationQueue } from './queue';
import type {
    AsyncEffectContext,
    AsyncEffectErrorInfo,
    AsyncEffectFunction,
    EffectContext,
    EffectFunction,
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
        state.activeEffects.add(fx);
        state.runs.push(run);

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
            state.runs.pop();
            finishRun(run);
            cleanupRun(run);
            canceled = true;
            state.pendingEffects.delete(fx);
            state.activeEffects.delete(fx);
            effectController.abort();
            throw error;
        }

        run.tracking = false;
        state.runs.pop();

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

        if (state.runs.some((run) => run.effect === fx && run.tracking)) {
            throw new Error('Cyclic dependency detected');
        }

        if (isMemo) {
            startRun();
            return;
        }

        if (concurrency === 'cancel') {
            if (hasBlockingRun()) {
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
        pendingQueue?.clear();
        state.pendingEffects.delete(fx);
        state.activeEffects.delete(fx);
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

function isPromiseLike(value: unknown): value is PromiseLike<void> {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        'then' in value &&
        typeof value.then === 'function'
    );
}
