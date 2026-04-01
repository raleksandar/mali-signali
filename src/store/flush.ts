import type { StoreState } from './internal';

export function flushPendingEffects(state: StoreState): void {
    if (state.isUpdating) {
        return;
    }
    state.isUpdating = true;

    try {
        for (const fx of state.pendingEffects) {
            if (fx.isMemo) {
                fx.update();
                state.pendingEffects.delete(fx);
            }
        }
    } finally {
        state.isUpdating = false;
    }

    if (state.batchLevel > 0) {
        return;
    }

    const effects = Array.from(state.pendingEffects);
    state.pendingEffects.clear();

    for (const fx of effects) {
        fx.update();
    }
}
