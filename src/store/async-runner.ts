import type {
    AsyncRunnerAbortHelpers,
    AsyncRunnerCommitInfo,
    AsyncRunnerContext,
    AsyncRunnerControl,
    AsyncRunnerHooks,
    AsyncRunCompletion,
    EffectInstance,
    EffectRun,
    StoreState,
} from './internal';
import { DefaultInvalidationQueue } from './queue';
import type { AsyncEffectErrorInfo, AsyncInvalidation, SignalReader } from './types';

interface AsyncRunnerOptions {
    readonly signal?: AbortSignal | undefined;
    readonly queue?:
        | { enqueue(item: AsyncInvalidation): void; dequeue(): AsyncInvalidation | undefined; clear(): void }
        | undefined;
    readonly concurrency?: 'cancel' | 'concurrent' | 'queue';
    readonly onError?: {
        readonly mode?: 'report' | 'cancel' | 'throw';
        readonly handler?: ((error: unknown, info: AsyncEffectErrorInfo) => void) | undefined;
    } | undefined;
}

export function createAsyncRunner<Prepared, Result, Trigger = void>(
    state: StoreState,
    effect: EffectInstance,
    {
        signal,
        queue,
        concurrency = 'cancel',
        onError,
    }: AsyncRunnerOptions,
    hooks: AsyncRunnerHooks<Prepared, Result, Trigger>,
): AsyncRunnerControl<Trigger> {
    if (queue && concurrency !== 'queue') {
        throw new Error('The queue option can only be used when concurrency is set to "queue"');
    }

    const activeRuns = new Set<EffectRun>();
    const preparedRuns = new Map<EffectRun, Prepared>();
    const retainedDependencyUnlinks = new Set<() => void>();
    const pendingQueue =
        concurrency === 'queue' ? queue ?? new DefaultInvalidationQueue<AsyncInvalidation>() : undefined;
    const errorMode = onError?.mode ?? 'report';
    const errorHandler = onError?.handler ?? hooks.defaultErrorHandler ?? (() => {});

    let generation = 0;
    let invalidationGeneration = 0;
    let latestStartedGeneration = 0;
    let currentCommittedRun: EffectRun | undefined;
    let pendingRerun = false;
    let stopped = false;
    let nextTrigger: Trigger | undefined;

    const cleanupCallback = (cleanup: () => void): void => {
        try {
            cleanup();
        } catch (error) {
            console.error('Error during effect cleanup:', error);
        }
    };

    const clearRetainedDependencies = (): void => {
        for (const unlink of retainedDependencyUnlinks) {
            unlink();
        }
        retainedDependencyUnlinks.clear();
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

        preparedRuns.delete(run);

        if (currentCommittedRun === run) {
            currentCommittedRun = undefined;
        }
    };

    const preserveRunDependencies = (run: EffectRun): void => {
        for (const unlink of run.dependencyUnlinks) {
            retainedDependencyUnlinks.add(unlink);
        }
        run.dependencyUnlinks.clear();
        run.dependenciesComplete = true;
    };

    const abortHelpers: AsyncRunnerAbortHelpers = {
        cleanupRun,
        preserveRunDependencies,
    };

    const clearCommittedRun = (): void => {
        if (!currentCommittedRun) {
            return;
        }
        cleanupRun(currentCommittedRun);
        currentCommittedRun = undefined;
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
            if (hooks.onErrorCancel) {
                hooks.onErrorCancel(control);
            } else {
                control.stop();
            }
        } else if (errorMode === 'throw') {
            queueMicrotask(() => {
                throw error;
            });
        }
    };

    const createRun = (): EffectRun => {
        const controller = new AbortController();
        return {
            effect,
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
    };

    const registerCleanup = (run: EffectRun, cleanup: () => void): void => {
        if (run.cleanupComplete) {
            cleanupCallback(cleanup);
            return;
        }

        run.cleanups.add(cleanup);
    };

    const track = <T>(run: EffectRun, read: SignalReader<T>): T => {
        if (
            !run.active ||
            run.state === 'canceled' ||
            run.dependenciesComplete ||
            run.cleanupComplete
        ) {
            return read();
        }

        const wasTracking = state.isTracking;
        const previousTracking = run.tracking;

        state.runs.push(run);
        state.isTracking = true;
        run.tracking = true;

        try {
            return read();
        } finally {
            run.tracking = previousTracking;
            state.isTracking = wasTracking;
            state.runs.pop();
        }
    };

    const startNextQueuedRun = (): void => {
        if (stopped || concurrency !== 'queue' || !pendingQueue || hasBlockingRun()) {
            return;
        }

        const nextInvalidation = pendingQueue.dequeue();
        if (!nextInvalidation) {
            return;
        }

        void nextInvalidation;
        startRun();
    };

    const commitInfo = (): AsyncRunnerCommitInfo => ({ latestStartedGeneration });

    const finalizeCompletion = (run: EffectRun, completion: AsyncRunCompletion<Result>): void => {
        finishRun(run);

        if (run.state === 'canceled') {
            if (pendingRerun) {
                pendingRerun = false;
                startRun();
            } else {
                cleanupRun(run);
                startNextQueuedRun();
            }
            return;
        }

        const prepared = preparedRuns.get(run) as Prepared;
        run.state = 'settled';

        if (completion.status === 'rejected') {
            handleAsyncError(completion.error, run);
        }

        if (stopped) {
            cleanupRun(run);
            startNextQueuedRun();
            return;
        }

        const shouldCommit = hooks.shouldCommit?.(run, completion, prepared, commitInfo()) ?? true;

        if (shouldCommit) {
            hooks.commit(run, completion, prepared);
            currentCommittedRun = run;
        } else {
            cleanupRun(run);
        }

        startNextQueuedRun();
    };

    const abortRun = (run: EffectRun, kind: 'rerun' | 'control' | 'stop'): void => {
        if (preparedRuns.has(run)) {
            const prepared = preparedRuns.get(run) as Prepared;

            if (hooks.abortRun?.(run, prepared, kind, abortHelpers)) {
                return;
            }
        }

        run.tracking = false;

        if (!run.signal.aborted) {
            run.controller.abort();
        }

        run.state = 'canceled';
        cleanupRun(run);
    };

    const consumeTrigger = (): Trigger | undefined => {
        const trigger = nextTrigger;
        nextTrigger = undefined;
        return trigger;
    };

    const mergeTrigger = (trigger: Trigger | undefined): void => {
        nextTrigger = hooks.mergeTrigger?.(nextTrigger, trigger) ?? trigger ?? nextTrigger;
    };

    const startRun = (): void => {
        clearCommittedRun();
        clearRetainedDependencies();

        if (stopped) {
            return;
        }

        const prepared = hooks.prepare(consumeTrigger());
        const run = createRun();

        latestStartedGeneration = run.generation;
        activeRuns.add(run);
        preparedRuns.set(run, prepared);
        state.runs.push(run);
        const wasTracking = state.isTracking;
        state.isTracking = true;

        let result: Result | PromiseLike<Result>;

        try {
            result = hooks.execute(
                {
                    signal: run.signal,
                    onCleanup(cleanup) {
                        registerCleanup(run, cleanup);
                    },
                    track<T>(read: SignalReader<T>): T {
                        return track(run, read);
                    },
                } satisfies AsyncRunnerContext,
                prepared,
            );
        } catch (error) {
            run.tracking = false;
            state.isTracking = wasTracking;
            state.runs.pop();
            finishRun(run);
            cleanupRun(run);
            control.stop();
            throw error;
        }

        run.tracking = false;
        state.isTracking = wasTracking;
        state.runs.pop();

        if (run.state === 'canceled') {
            finishRun(run);
            cleanupRun(run);
            startNextQueuedRun();
            return;
        }

        const currentPrepared = preparedRuns.get(run) as Prepared;
        if (!isPromiseLike(result)) {
            hooks.handleSyncResult?.(run, result, currentPrepared);

            run.state = 'settled';
            currentCommittedRun = run;
            return;
        }

        run.state = 'pending-async';

        void Promise.resolve(result).then(
            (value) => {
                finalizeCompletion(run, { status: 'fulfilled', value });
            },
            (error: unknown) => {
                finalizeCompletion(run, { status: 'rejected', error });
            },
        );
    };

    const invalidate = (trigger: Trigger | undefined, fromDependency: boolean): void => {
        if (stopped) {
            return;
        }

        if (
            fromDependency &&
            state.runs.some((run) => run.effect === effect && run.tracking)
        ) {
            throw new Error('Cyclic dependency detected');
        }

        mergeTrigger(trigger);

        if (concurrency === 'cancel') {
            if (hasBlockingRun()) {
                pendingRerun = true;
                for (const run of activeRuns) {
                    abortRun(run, 'rerun');
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

    const control: AsyncRunnerControl<Trigger> = {
        invalidate(trigger?: Trigger): void {
            invalidate(trigger, false);
        },
        invalidateFromDependency(trigger?: Trigger): void {
            invalidate(trigger, true);
        },
        cancelActive(): void {
            if (stopped) {
                return;
            }

            pendingRerun = false;
            pendingQueue?.clear();

            for (const run of activeRuns) {
                abortRun(run, 'control');
            }
        },
        stop(): void {
            if (stopped) {
                return;
            }

            stopped = true;
            pendingRerun = false;
            pendingQueue?.clear();
            state.pendingEffects.delete(effect);
            state.activeEffects.delete(effect);
            clearCommittedRun();
            clearRetainedDependencies();
            hooks.onStop?.();

            for (const run of activeRuns) {
                abortRun(run, 'stop');
            }
        },
    };

    if (signal) {
        signal.addEventListener('abort', () => {
            control.stop();
        }, { once: true });
    }

    state.activeEffects.add(effect);

    return control;
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        'then' in value &&
        typeof value.then === 'function'
    );
}
