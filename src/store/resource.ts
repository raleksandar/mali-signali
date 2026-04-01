import { createAsyncRunner } from './async-runner';
import type { EffectInstance, StoreState } from './internal';
import { createSignal } from './signal';
import type {
    ResourceContext,
    ResourceControls,
    ResourceOptions,
    ResourceState,
    RunCause,
    SignalReader,
} from './types';

type ResourceCompletion<T> =
    | { status: 'fulfilled'; value: T }
    | { status: 'rejected'; error: unknown };

interface ResourcePrepared<T, E = unknown> {
    readonly previous: ResourceState<T, E>;
    readonly cause: RunCause;
}

function createIdleState<T, E = unknown>(): ResourceState<T, E> {
    return {
        status: 'idle',
        value: undefined,
        error: undefined,
        isStale: false,
    };
}

function getLoadingState<T, E = unknown>(previous: ResourceState<T, E>): ResourceState<T, E> {
    if (previous.value !== undefined) {
        return {
            status: 'loading',
            value: previous.value,
            error: undefined,
            isStale: true,
        };
    }

    return {
        status: 'loading',
        value: undefined,
        error: undefined,
        isStale: false,
    };
}

export function createResource<T, E = unknown>(
    state: StoreState,
    load: (context: ResourceContext<T, E>) => Promise<T>,
    {
        signal,
        queue,
        concurrency = 'cancel',
        onError,
        writes = 'latest',
    }: ResourceOptions = {},
): readonly [SignalReader<ResourceState<T, E>>, ResourceControls] {
    if (signal?.aborted) {
        const [read] = createSignal<ResourceState<T, E>>(state, createIdleState<T, E>());
        const noopControls: ResourceControls = {
            refresh(): void {},
            abort(): void {},
            reset(): void {},
        };

        return [read, noopControls] as const;
    }

    const [read, write] = createSignal<ResourceState<T, E>>(state, createIdleState<T, E>());
    let currentState = read();
    let stopped = false;

    const setState = (nextState: ResourceState<T, E>): void => {
        currentState = nextState;
        write(nextState);
    };

    const fx: EffectInstance = {
        isMemo: false,
        update(): void {
            control.invalidateFromDependency();
        },
        cancel(): void {
            control.stop();
        },
    };

    const control = createAsyncRunner<ResourcePrepared<T, E>, T, RunCause>(
        state,
        fx,
        {
            signal,
            queue,
            concurrency,
            onError,
        },
        {
            prepare(trigger): ResourcePrepared<T, E> {
                const prepared = {
                    previous: currentState,
                    cause: trigger ?? 'dependency',
                };

                setState(getLoadingState(prepared.previous));
                return prepared;
            },
            execute(context, prepared): Promise<T> {
                try {
                    return Promise.resolve(
                        load({
                            cancel() {
                                fx.cancel();
                            },
                            refresh() {
                                controls.refresh();
                            },
                            abort() {
                                controls.abort();
                            },
                            reset() {
                                controls.reset();
                            },
                            track<U>(reader: SignalReader<U>): U {
                                return context.track(reader);
                            },
                            signal: context.signal,
                            onCleanup(cleanup) {
                                context.onCleanup(cleanup);
                            },
                            previous: prepared.previous,
                            cause: prepared.cause,
                        }),
                    );
                } catch (error) {
                    return Promise.reject(error);
                }
            },
            commit(_run, completion, prepared): void {
                const result = completion as ResourceCompletion<T>;

                if (result.status === 'fulfilled') {
                    setState({
                        status: 'ready',
                        value: result.value,
                        error: undefined,
                        isStale: false,
                    });
                    return;
                }

                setState({
                    status: 'error',
                    value: prepared.previous.value,
                    error: result.error as E,
                    isStale: prepared.previous.value !== undefined,
                });
            },
            shouldCommit(run, _completion, _prepared, info): boolean {
                return writes === 'settled' || run.generation === info.latestStartedGeneration;
            },
            mergeTrigger(current, next): RunCause | undefined {
                return next ?? current;
            },
            onErrorCancel(shared): void {
                shared.cancelActive();
            },
            onStop(): void {
                stopped = true;
            },
            abortRun(run, _prepared, kind, helpers): boolean {
                if (kind !== 'control') {
                    return false;
                }

                run.tracking = false;
                run.controller.abort();
                run.state = 'canceled';
                helpers.preserveRunDependencies(run);
                helpers.cleanupRun(run);
                return true;
            },
        },
    );

    const controls: ResourceControls = {
        refresh(): void {
            if (stopped) {
                return;
            }
            control.invalidate('refresh');
        },
        abort(): void {
            if (stopped) {
                return;
            }
            control.cancelActive();
        },
        reset(): void {
            if (stopped) {
                return;
            }
            control.cancelActive();
            setState(createIdleState<T, E>());
        },
    };

    control.invalidate('init');

    return [read, controls] as const;
}
