# Effects

## Overview

Effects run reactive side effects whenever the signals, memos, or resources they depend on change. `mali-signali` supports both synchronous and asynchronous effects.

This page covers `effect()`, `EffectContext`, `EffectFunction`, `AsyncEffectContext`, `AsyncEffectFunction`, `EffectConstructor`, `EffectOptions`, `AsyncEffectOptions`, `AsyncEffectErrorOptions`, `AsyncEffectErrorInfo`, `AsyncEffectErrorMode`, and `AsyncEffectConcurrency`.

## Canonical Example

```ts
import { effect, memo, signal } from 'mali-signali';

const [count, setCount] = signal(0);
const doubled = memo(() => count() * 2);

const cancel = effect(() => {
  console.log('doubled =', doubled());
});

setCount(1);
setCount(2);

cancel();
```

## Public API Summary

```ts
interface EffectOptions {
  readonly signal?: AbortSignal;
}

type AsyncEffectConcurrency = 'cancel' | 'concurrent' | 'queue';
type AsyncEffectErrorMode = 'report' | 'cancel' | 'throw';

interface AsyncEffectErrorInfo {
  readonly generation: number;
  readonly concurrency: AsyncEffectConcurrency;
  readonly signal: AbortSignal;
  readonly canceled: boolean;
}

interface AsyncEffectErrorOptions {
  readonly mode?: AsyncEffectErrorMode;
  readonly handler?: (error: unknown, info: AsyncEffectErrorInfo) => void;
}

interface AsyncEffectOptions extends EffectOptions {
  readonly concurrency?: AsyncEffectConcurrency;
  readonly queue?: InvalidationQueue;
  readonly onError?: AsyncEffectErrorOptions;
}

interface EffectContext {
  cancel(): void;
  track<T>(read: SignalReader<T>): T;
  readonly signal: AbortSignal;
  onCleanup(cleanup: () => void): void;
}

type EffectFunction = (context: EffectContext) => void | (() => void);
type AsyncEffectContext = EffectContext;
type AsyncEffectFunction = (context: EffectContext) => Promise<void>;

interface EffectConstructor {
  (execute: EffectFunction, options?: EffectOptions): () => void;
  (execute: AsyncEffectFunction, options?: AsyncEffectOptions): () => void;
}

declare function effect(execute: EffectFunction, options?: EffectOptions): () => void;
declare function effect(execute: AsyncEffectFunction, options?: AsyncEffectOptions): () => void;
```

## Full Behavior and Semantics

### Synchronous effects

Synchronous effects:
- run immediately when created
- track the signal, memo, and resource readers they use
- re-run when those dependencies change
- may return a cleanup callback

```ts
const [enabled] = signal(true);

effect(() => {
  if (!enabled()) {
    return;
  }

  const id = setInterval(() => {
    console.log('tick');
  }, 1000);

  return () => clearInterval(id);
});
```

Cleanup callbacks run before the next execution and when the effect is canceled.

### Asynchronous effects

Async effects use the same `effect()` API:

```ts
effect(async ({ signal }) => {
  const response = await fetch('/api/data', { signal });
  console.log(await response.json());
});
```

Important tracking rule:
- reads before the first `await` are tracked automatically
- reads after the first `await` are not tracked automatically

To add dependencies after the first `await`, call `track()` explicitly:

```ts
effect(async ({ track }) => {
  await Promise.resolve();

  const a = track(signalA);
  const b = track(signalB);

  console.log(a + b);
});
```

Async effects do not return cleanup callbacks. Instead, register cleanup through `context.onCleanup()`:

```ts
effect(async ({ onCleanup, signal }) => {
  const controller = new AbortController();

  onCleanup(() => {
    controller.abort();
  });

  await fetch('/api/data', {
    signal: signal,
  });
});
```

## Options and Related Types

### `EffectOptions`

```ts
interface EffectOptions {
  readonly signal?: AbortSignal;
}
```

Passing an `AbortSignal` ties the effect lifetime to that signal:

```ts
const controller = new AbortController();

effect(() => {
  console.log(count());
}, {
  signal: controller.signal,
});

controller.abort();
```

### `EffectContext`

`EffectContext` is passed to both sync and async effects.

#### `cancel()`

Stops the effect permanently.

When `cancel()` is called:
- the current run is canceled
- any registered cleanup for the current run is executed
- the effect is removed from all currently tracked signal, memo, and resource dependencies
- future updates of those dependencies no longer re-run the effect

In practice, this means the effect becomes inert after cancellation.

```ts
effect(({ cancel }) => {
  if (count() > 10) {
    cancel();
  }
});
```

#### `track(read)`

Explicitly tracks a signal, memo, or resource read for the current async run.

```ts
effect(async ({ track }) => {
  await Promise.resolve();
  const selectedId = track(id);
  console.log(selectedId);
});
```

#### `signal`

An `AbortSignal` for the current effect run.

```ts
effect(async ({ signal }) => {
  await fetch('/api/wallet', { signal });
});
```

#### `onCleanup(cleanup)`

Registers cleanup for the current run. This is especially important for async effects.

```ts
effect(async ({ onCleanup }) => {
  const timer = setTimeout(() => {}, 1000);
  onCleanup(() => clearTimeout(timer));
});
```

### `AsyncEffectOptions`

```ts
interface AsyncEffectOptions extends EffectOptions {
  readonly concurrency?: 'cancel' | 'concurrent' | 'queue';
  readonly queue?: InvalidationQueue;
  readonly onError?: AsyncEffectErrorOptions;
}
```

#### `concurrency`

Controls what happens when an async effect is invalidated while a previous run is still pending.

##### `'cancel'` (default)

Abort the stale run and re-run once after it settles.

```ts
effect(async ({ signal }) => {
  await fetch(`/api/users/${userId()}`, { signal });
}, {
  concurrency: 'cancel',
});
```

##### `'concurrent'`

Allow overlapping runs.

```ts
effect(async () => {
  await doWork(input());
}, {
  concurrency: 'concurrent',
});
```

Use this when overlapping work is acceptable and stale results are handled by user code.

##### `'queue'`

Queue invalidations and run them serially.

```ts
effect(async () => {
  await syncStep(step());
}, {
  concurrency: 'queue',
});
```

When `concurrency` is `'queue'`, you may pass a custom queue.

### `InvalidationQueue` and `DefaultInvalidationQueue`

See [`utilities.md`](./utilities.md) for the full queue API. In effect code, the common pattern is:

```ts
import { DefaultInvalidationQueue, effect } from 'mali-signali';

const queue = new DefaultInvalidationQueue();

effect(async () => {
  await syncStep(step());
}, {
  concurrency: 'queue',
  queue,
});
```

### `onError`

```ts
interface AsyncEffectErrorOptions {
  readonly mode?: 'report' | 'cancel' | 'throw';
  readonly handler?: (error: unknown, info: AsyncEffectErrorInfo) => void;
}
```

#### `mode: 'report'`

Report the error and keep the effect alive. This is the default.

```ts
effect(async () => {
  throw new Error('boom');
}, {
  onError: {
    mode: 'report',
  },
});
```

#### `mode: 'cancel'`

Report the error, then cancel the effect.

```ts
effect(async () => {
  throw new Error('boom');
}, {
  onError: {
    mode: 'cancel',
  },
});
```

#### `mode: 'throw'`

Rethrow the error to the host on a microtask boundary.

```ts
effect(async () => {
  throw new Error('boom');
}, {
  onError: {
    mode: 'throw',
  },
});
```

#### `handler`

Inspect the error before the selected mode is applied.

```ts
effect(async () => {
  throw new Error('boom');
}, {
  onError: {
    handler(error, info) {
      console.error('generation', info.generation, error);
    },
  },
});
```

`AsyncEffectErrorInfo` includes:
- `generation`
- `concurrency`
- `signal`
- `canceled`

## Edge Cases and Gotchas

- Creating an effect with an already-aborted `AbortSignal` returns a no-op cancel function.
- Async reads after the first `await` are intentionally untracked unless wrapped in `track()`.
- Reads inside later callbacks such as `setInterval`, `setTimeout`, promise handlers, or DOM event handlers do not become dependencies of the surrounding effect.
- `queue` is valid only when `concurrency` is `'queue'`.
- Cleanup callbacks are idempotent for a single run.
- Effects detect synchronous self-dependency cycles and throw `Cyclic dependency detected`, including cycles created during explicit `track()` reads.

Incorrect:

```ts
effect(() => {
  const id = setInterval(() => {
    console.log(count()); // does not subscribe this effect to count
  }, 1000);

  return () => clearInterval(id);
});
```

If you need the effect to depend on `count`, read it while the effect itself is running:

```ts
effect(() => {
  const current = count(); // tracked
  console.log('count changed:', current);
});
```

## Additional Examples

### Cancel from inside the effect

```ts
effect(({ cancel }) => {
  if (!enabled()) {
    cancel();
  }
});
```

### Shared AbortSignal for multiple effects

```ts
const controller = new AbortController();

effect(() => {
  console.log(a());
}, { signal: controller.signal });

effect(() => {
  console.log(b());
}, { signal: controller.signal });
```

### Post-`await` dependency tracking

```ts
effect(async ({ track }) => {
  await Promise.resolve();
  console.log(track(selectedUserId));
});
```

## Related Topics

- [`signals.md`](./signals.md)
- [`memos.md`](./memos.md)
- [`resources.md`](./resources.md)
- [`utilities.md`](./utilities.md)
- [`store.md`](./store.md)
