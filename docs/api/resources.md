# Resources

## Overview

Resources are asynchronous derived values. They wrap an async loader and expose a state reader plus imperative controls for refreshing, canceling, and resetting the resource.

This page covers `resource()`, `ResourceStatus`, `ResourceState`, `RunCause`, `ResourceControls`, `ResourceContext`, `ResourceOptions`, and `ResourceConstructor`.

## Canonical Example

```ts
import { effect, resource, signal } from 'mali-signali';

type Wallet = { id: string; balance: number };

const walletId = signal('wallet-1');

const [wallet] = resource<Wallet>(async ({ signal }) => {
  const id = walletId.read();
  const response = await fetch(`/api/wallets/${id}`, { signal });
  return response.json();
});

effect(() => {
  const state = wallet();

  if (state.status === 'loading') {
    console.log('Loading wallet...');
  }

  if (state.status === 'ready') {
    console.log(state.value.balance);
  }
});
```

## Public API Summary

```ts
type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

type ResourceState<T, E = unknown> =
  | { status: 'idle'; value: undefined; error: undefined; isStale: false }
  | { status: 'loading'; value: undefined; error: undefined; isStale: false }
  | { status: 'loading'; value: T; error: undefined; isStale: true }
  | { status: 'ready'; value: T; error: undefined; isStale: false }
  | { status: 'error'; value: T | undefined; error: E; isStale: boolean };

type RunCause = 'init' | 'dependency' | 'refresh';

interface ResourceControls {
  refresh(): void;
  abort(): void;
  reset(): void;
}

interface ResourceContext<T, E = unknown> extends EffectContext, ResourceControls {
  readonly previous: ResourceState<T, E>;
  readonly cause: RunCause;
}

interface ResourceOptions extends AsyncEffectOptions {
  readonly writes?: 'latest' | 'settled';
}

declare function resource<T, E = unknown>(
  load: (context: ResourceContext<T, E>) => Promise<T>,
  options?: ResourceOptions,
): readonly [read: SignalReader<ResourceState<T, E>>, controls: ResourceControls];

type ResourceConstructor = <T, E = unknown>(
  load: (context: ResourceContext<T, E>) => Promise<T>,
  options?: ResourceOptions,
) => readonly [read: SignalReader<ResourceState<T, E>>, controls: ResourceControls];
```

## Full Behavior and Semantics

Resources start in `idle`, then immediately schedule an initial load and usually transition to `loading` during creation. The main exception is when they are created with an already-aborted `AbortSignal`, in which case they remain `idle`.

```ts
const [wallet] = resource(async () => {
  return { id: 'w1', balance: 100 };
});
```

The loader behaves like an async effect:
- reads before the first `await` are tracked automatically
- reads after the first `await` must use `track()`
- `signal`, `onCleanup()`, `cancel()`, `refresh()`, `abort()`, and `reset()` are available
- `cancel()` is the same permanent stop as async effect `cancel()`
- `abort()` is resource-specific and aborts only the active run
- dependency-triggered cycles are detected during tracked reads, including explicit `track()` reads

```ts
const [wallet] = resource(async ({ signal }) => {
  const id = walletId.read();
  const response = await fetch(`/api/wallets/${id}`, { signal });
  return response.json();
});
```

## State Transitions

### `idle`

No active or committed value yet.

```ts
{ status: 'idle', value: undefined, error: undefined, isStale: false }
```

### `loading`

The resource is currently loading.

Without previous value:

```ts
{ status: 'loading', value: undefined, error: undefined, isStale: false }
```

Refreshing with a previous value:

```ts
{ status: 'loading', value: previousValue, error: undefined, isStale: true }
```

### `ready`

The latest accepted run resolved successfully.

```ts
{ status: 'ready', value, error: undefined, isStale: false }
```

### `error`

The latest accepted run rejected.

Without previous value:

```ts
{ status: 'error', value: undefined, error, isStale: false }
```

With retained previous value:

```ts
{ status: 'error', value: previousValue, error, isStale: true }
```

## Options and Related Types

### `ResourceContext`

`ResourceContext` extends both `EffectContext` and `ResourceControls`, and also adds:
- `previous`
- `cause`

When used inside a resource loader, `cancel()` stops the resource permanently:
- the current run is canceled
- tracked dependencies are removed
- future dependency changes no longer start new runs
- `refresh()`, `abort()`, `reset()`, and the external `controls.*` methods become no-ops afterward

This is intentionally different from `abort()`:
- both `cancel()` and `abort()` abort the current run's `signal`
- `cancel()` matches async effect `cancel()` and permanently stops the reactive computation
- `abort()` only aborts the active run and keeps the resource subscribed for future reruns

#### `previous`

The previous visible `ResourceState` for the run.

```ts
const walletId = signal('wallet-1');

resource(async ({ previous, signal }) => {
  const id = walletId.read();

  if (previous.status === 'ready') {
    console.log('refreshing after:', previous.value.id);
  }

  const response = await fetch(`/api/wallets/${id}`, { signal });
  return response.json();
});
```

#### `cause`

Why the current run started.

```ts
const walletId = signal('wallet-1');
const [_, controls] = resource(async ({ cause, signal }) => {
  console.log('run cause:', cause);

  const id = walletId.read();
  const response = await fetch(`/api/wallets/${id}`, { signal });
  return response.json();
});

walletId.update('wallet-2'); // dependency
controls.refresh(); // refresh
```

| Value | Meaning |
| --- | --- |
| `'init'` | The first run scheduled when the resource is created. |
| `'dependency'` | A rerun caused by a tracked signal, memo, or resource changing. |
| `'refresh'` | A rerun started explicitly through `controls.refresh()`. |

### `ResourceControls`

#### `refresh()`

Schedules a new run without clearing the current value.

```ts
const walletId = signal('wallet-1');
const [_, controls] = resource(async ({ signal }) => {
  const id = walletId.read();
  const response = await fetch(`/api/wallets/${id}`, { signal });
  return response.json();
});

document
  .querySelector('#refresh-wallet')!
  .addEventListener('click', () => {
    controls.refresh();
  });
```

#### `abort()`

Aborts the active run and clears queued invalidations, but keeps the resource alive and leaves the current visible state as-is.

Tracked dependencies remain subscribed. A later dependency change can start a new run again, and `controls.refresh()` still works after `abort()`.

```ts
const walletId = signal('wallet-1');
const [_, controls] = resource(async ({ signal }) => {
  const id = walletId.read();
  const response = await fetch(`/api/wallets/${id}`, { signal });
  return response.json();
});

document
  .querySelector('#cancel-wallet-request')!
  .addEventListener('click', () => {
    controls.abort();
  });
```

#### `reset()`

Cancels active work, clears current value and error, and returns the resource to `idle`.

```ts
const walletId = signal<string | undefined>('wallet-1');
const [_, controls] = resource(async ({ signal }) => {
  const id = walletId.read();

  if (!id) {
    throw new Error('wallet id is required');
  }

  const response = await fetch(`/api/wallets/${id}`, { signal });
  return response.json();
});

document
  .querySelector('#clear-wallet')!
  .addEventListener('click', () => {
    walletId.update(undefined);
    controls.reset();
  });
```

In general, avoid calling resource controls inside `batch()`. `refresh()` and `abort()` act immediately and usually become harder to reason about when mixed with batched dependency updates. The main exception is `reset()`, which can be reasonable inside a batch when you want the visible `idle` transition to land together with other synchronous state changes.

### `ResourceOptions`

`ResourceOptions` includes all async effect options plus `writes`.

```ts
interface ResourceOptions extends AsyncEffectOptions {
  readonly writes?: 'latest' | 'settled';
}
```

#### `writes: 'latest'` (default)

Only the latest started run may commit its result.

This is the safer default for overlapping async work such as `fetch()`:

```ts
resource(async ({ signal }) => {
  const id = walletId.read();
  const response = await fetch(`/api/wallets/${id}`, { signal });
  return response.json();
}, {
  concurrency: 'concurrent',
  writes: 'latest',
});
```

#### `writes: 'settled'`

Allow runs to commit in settlement order, even if an older run finishes after a newer one.

```ts
resource(async ({ signal }) => {
  const id = walletId.read();
  const response = await fetch(`/api/wallets/${id}`, { signal });
  return response.json();
}, {
  concurrency: 'concurrent',
  writes: 'settled',
});
```

Use this only when completion-order overwrites are acceptable.

### Async options

`resource()` also accepts:
- `signal`
- `concurrency`
- `queue`
- `onError`

These behave the same way as in [`effects.md`](./effects.md), except resource commits additionally follow the `writes` policy.

## Edge Cases and Gotchas

- An already-aborted `AbortSignal` creates an inert resource that remains at `idle`.
- Loader `cancel()` is permanent; `controls.abort()` is not.
- `controls.abort()` does not reset the state to `idle`.
- `reset()` clears the visible state, but the resource remains usable for future dependency-driven loads or manual refreshes.
- Reads after the first `await` are untracked unless wrapped in `track()`.
- Cycles created by tracked dependency invalidations are detected and surface as `Cyclic dependency detected` through the normal resource error path.
- If you use `concurrency: 'concurrent'`, stale writes are prevented only when `writes` is `'latest'`.
- `reset()` returns the resource to `idle`; the next run, if any, will usually be caused by a dependency change or a manual `refresh()`.

## Additional Examples

### Stale-while-revalidate UI

```ts
effect(() => {
  const state = wallet();

  if (state.status === 'loading' && state.isStale) {
    console.log('Refreshing existing wallet value...');
  }
});
```

### Error with retained previous value

```ts
effect(() => {
  const state = wallet();

  if (state.status === 'error' && state.value) {
    console.log('Showing stale value while surfacing the error');
  }
});
```

### Refresh button

```ts
const [wallet, { refresh }] = resource(async ({ signal }) => {
  const id = walletId.read();
  const response = await fetch(`/api/wallets/${id}`, { signal });
  return response.json();
});

document
  .querySelector('#refresh-wallet')!
  .addEventListener('click', () => {
    refresh();
  });
```

### Post-`await` tracking inside a resource

```ts
const [value] = resource(async ({ track }) => {
  await Promise.resolve();
  return track(selectedValue);
});
```

### Resource depending on another resource

```ts
type Wallet = { id: string; ownerId: string; balance: number };
type Owner = { id: string; name: string };

const walletId = signal('wallet-1');

const [wallet] = resource<Wallet>(async ({ signal }) => {
  const id = walletId.read();
  const response = await fetch(`/api/wallets/${id}`, { signal });
  return response.json();
});

const [owner] = resource<Owner | undefined>(async ({ signal }) => {
  const walletState = wallet();

  if (walletState.status !== 'ready') {
    return undefined;
  }

  const response = await fetch(`/api/users/${walletState.value.ownerId}`, { signal });
  return response.json();
});

effect(() => {
  const walletState = wallet();
  const ownerState = owner();

  if (
    walletState.status === 'ready' &&
    ownerState.status === 'ready' &&
    ownerState.value
  ) {
    console.log(`${ownerState.value.name} owns wallet ${walletState.value.id}`);
  }
});
```

## Related Topics

- [`effects.md`](./effects.md)
- [`signals.md`](./signals.md)
- [`utilities.md`](./utilities.md)
- [`store.md`](./store.md)
