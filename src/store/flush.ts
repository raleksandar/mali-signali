import type { StoreState } from './internal';

export function flushPendingEffects(state: StoreState): void {
    if (state.isUpdating) {
        return;
    }
    state.isUpdating = true;

    const memos = Array.from(state.pendingEffects).filter((fx) => fx.isMemo);

    for (const fx of memos) {
        fx.update();
        state.pendingEffects.delete(fx);
    }

    state.isUpdating = false;

    if (state.batchLevel > 0) {
        return;
    }

    const effects = Array.from(state.pendingEffects);
    state.pendingEffects.clear();

    for (const fx of effects) {
        fx.update();
    }
}
