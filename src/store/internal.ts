import type {
    AsyncEffectConcurrency,
    AsyncEffectErrorOptions,
    InvalidationQueue,
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
    removeLifetimeAbort?: (() => void) | undefined;
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
