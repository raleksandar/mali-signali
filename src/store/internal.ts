import type {
    AsyncEffectConcurrency,
    AsyncEffectErrorOptions,
    InvalidationQueue,
    SignalReader,
} from './types';

export interface EffectInstance {
    readonly isMemo: boolean;
    readonly update: () => void;
    readonly cancel: () => void;
}

export interface TrackingRun {
    readonly effect: EffectInstance;
    tracking: boolean;
    onDependencyCleanup(unlink: () => void): void;
}

export interface EffectRun extends TrackingRun {
    readonly generation: number;
    readonly cleanups: Set<() => void>;
    readonly dependencyUnlinks: Set<() => void>;
    readonly controller: AbortController;
    readonly signal: AbortSignal;
    state: 'running-sync' | 'pending-async' | 'settled' | 'canceled';
    cleanupComplete: boolean;
    dependenciesComplete: boolean;
    active: boolean;
}

export interface InternalEffectOptions {
    readonly isMemo?: boolean;
    readonly signal?: AbortSignal;
    readonly queue?: InvalidationQueue;
    readonly concurrency?: AsyncEffectConcurrency;
    readonly onError?: AsyncEffectErrorOptions;
}

export interface StoreState {
    batchLevel: number;
    isUpdating: boolean;
    isTracking: boolean;
    readonly pendingEffects: Set<EffectInstance>;
    readonly runs: TrackingRun[];
    readonly activeEffects: Set<EffectInstance>;
}

export interface AsyncRunnerContext {
    readonly signal: AbortSignal;
    onCleanup(cleanup: () => void): void;
    track<T>(read: SignalReader<T>): T;
}

export type AsyncRunCompletion<Result> =
    | { status: 'fulfilled'; value: Result }
    | { status: 'rejected'; error: unknown };

export interface AsyncRunnerCommitInfo {
    readonly latestStartedGeneration: number;
}

export interface AsyncRunnerControl<Trigger = void> {
    invalidate(trigger?: Trigger): void;
    invalidateFromDependency(trigger?: Trigger): void;
    cancelActive(): void;
    stop(): void;
}

export interface AsyncRunnerAbortHelpers {
    cleanupRun(run: EffectRun): void;
    preserveRunDependencies(run: EffectRun): void;
}

export type AsyncRunnerAbortKind = 'rerun' | 'control' | 'stop';

export interface AsyncRunnerHooks<Prepared, Result, Trigger = void> {
    prepare(trigger: Trigger | undefined): Prepared;
    execute(context: AsyncRunnerContext, prepared: Prepared): Result | PromiseLike<Result>;
    handleSyncResult?(run: EffectRun, result: Result, prepared: Prepared): boolean;
    commit(run: EffectRun, completion: AsyncRunCompletion<Result>, prepared: Prepared): void;
    shouldCommit?(
        run: EffectRun,
        completion: AsyncRunCompletion<Result>,
        prepared: Prepared,
        info: AsyncRunnerCommitInfo,
    ): boolean;
    mergeTrigger?(current: Trigger | undefined, next: Trigger | undefined): Trigger | undefined;
    defaultErrorHandler?(error: unknown): void;
    onErrorCancel?(control: AsyncRunnerControl<Trigger>): void;
    abortRun?(
        run: EffectRun,
        prepared: Prepared,
        kind: AsyncRunnerAbortKind,
        helpers: AsyncRunnerAbortHelpers,
    ): boolean;
    onStop?(): void;
}
