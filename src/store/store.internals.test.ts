import { describe, expect, it } from 'vitest';
import { createAsyncRunner } from './async-runner';
import { createEffect } from './effect';
import type { EffectInstance } from './internal';
import { createSignal } from './signal';
import { createTestState, deferred, flushPromises } from '../test/store-test-helpers';

describe('createAsyncRunner()', () => {
    it('Ignores cancelActive() after the runner has already been stopped.', () => {
        const state = createTestState();
        const effect: EffectInstance = {
            isMemo: false,
            update() {},
            cancel() {},
        };

        const control = createAsyncRunner(state, effect, {}, {
            prepare() {},
            execute() {},
            commit() {},
        });

        control.stop();
        control.cancelActive();

        expect(state.activeEffects.size).toBe(0);
        expect(state.pendingEffects.size).toBe(0);
    });

    it('Keeps sync subscriptions when prepared state is undefined.', () => {
        const state = createTestState();
        const effect: EffectInstance = {
            isMemo: false,
            update() {
                control.invalidate();
            },
            cancel() {
                control.stop();
            },
        };
        const [read, write] = createSignal(state, 0);
        const runs: number[] = [];

        const control = createAsyncRunner(state, effect, {}, {
            prepare() {
                return undefined;
            },
            execute() {
                runs.push(read());
            },
            commit() {},
            shouldCommit(run, _completion, _prepared, info) {
                return run.generation === info.latestStartedGeneration;
            },
        });

        control.invalidate();

        state.batchLevel = 1;
        write(1);

        expect(runs).toEqual([0]);
        expect(state.pendingEffects.size).toBe(1);
    });

    it('Stops the runner on rejected async work when cancel error handling has no custom cancel hook.', async () => {
        const state = createTestState();
        const effect: EffectInstance = {
            isMemo: false,
            update() {
                control.invalidate();
            },
            cancel() {
                control.stop();
            },
        };

        const control = createAsyncRunner(
            state,
            effect,
            { onError: { mode: 'cancel' } },
            {
                prepare() {
                    return undefined;
                },
                execute() {
                    return Promise.reject(new Error('boom'));
                },
                commit() {},
            },
        );

        control.invalidate();
        await flushPromises();

        expect(state.activeEffects.size).toBe(0);
        expect(state.pendingEffects.size).toBe(0);
    });

    it('Falls back to committing async results when no shouldCommit hook is provided.', async () => {
        const state = createTestState();
        const effect: EffectInstance = {
            isMemo: false,
            update() {
                control.invalidate();
            },
            cancel() {
                control.stop();
            },
        };
        const commits: number[] = [];

        const control = createAsyncRunner(
            state,
            effect,
            {},
            {
                prepare() {
                    return undefined;
                },
                execute() {
                    return Promise.resolve(1);
                },
                commit(_run, completion) {
                    if (completion.status === 'fulfilled') {
                        commits.push(completion.value);
                    }
                },
            },
        );

        control.invalidate();
        await flushPromises();

        expect(commits).toEqual([1]);
    });

    it('Preserves dependencies idempotently when active work is canceled repeatedly.', async () => {
        const state = createTestState();
        const [read] = createSignal(state, 0);
        const pending = deferred<void>();
        const effect: EffectInstance = {
            isMemo: false,
            update() {
                control.invalidate();
            },
            cancel() {
                control.stop();
            },
        };

        const control = createAsyncRunner(
            state,
            effect,
            {},
            {
                prepare() {
                    return undefined;
                },
                execute(context) {
                    read();
                    return pending.promise.then(() => {
                        context.onCleanup(() => {});
                    });
                },
                commit() {},
                abortRun(run, _prepared, kind, helpers) {
                    if (kind !== 'control') {
                        return false;
                    }

                    run.tracking = false;
                    run.controller.abort();
                    run.state = 'canceled';
                    helpers.preserveRunDependencies(run);
                    helpers.preserveRunDependencies(run);
                    helpers.cleanupRun(run);
                    return true;
                },
            },
        );

        control.invalidate();
        control.cancelActive();
        control.cancelActive();
        pending.resolve();
        await flushPromises();

        expect(state.activeEffects.size).toBe(1);
    });
});

describe('createEffect() internals', () => {
    it('Returns early when an internal update is attempted after cancelation.', () => {
        const state = createTestState();
        const [read] = createSignal(state, 0);
        const cancel = createEffect(state, () => {
            read();
        });
        const [fx] = Array.from(state.activeEffects);

        cancel();
        fx?.update();

        expect(state.pendingEffects.size).toBe(0);
    });

    it('Marks a running sync effect as canceled when the runner stops during execution.', () => {
        const state = createTestState();
        const [read] = createSignal(state, 0);

        createEffect(state, ({ cancel }) => {
            read();
            cancel();
        });

        expect(state.activeEffects.size).toBe(0);
        expect(state.pendingEffects.size).toBe(0);
    });
});
