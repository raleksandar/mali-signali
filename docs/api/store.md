# Store

## Overview

`createStore()` creates an isolated reactive graph with its own signals, memos, effects, resources, and batching state.

Use stores when you want:
- multiple independent reactive graphs in the same process
- deterministic teardown of a graph through `unlink()`
- library-local or request-local reactive state without touching the global store

## Canonical Example

```ts
import { createStore } from 'mali-signali';

const store = createStore();

const [count, setCount] = store.signal(0);
const doubled = store.memo(() => count() * 2);

const cancel = store.effect(() => {
  console.log(doubled());
});

setCount(1);

cancel();
await store.unlink();
```

## Public API Summary

```ts
interface Store {
  readonly signal: SignalConstructor;
  readonly untracked: UntrackedReader;
  readonly effect: EffectConstructor;
  readonly memo: MemoConstructor;
  readonly resource: ResourceConstructor;
  readonly batch: BatchFunction;
  unlink(): Promise<void>;
}

declare function createStore(): Store;
```

## Full Behavior and Semantics

The global functions:
- `signal()`
- `memo()`
- `effect()`
- `resource()`
- `batch()`
- `untracked()`

are convenience wrappers around a default global store.

`createStore()` gives you an explicit store object with the same capabilities:

```ts
const store = createStore();

const [count, setCount] = store.signal(0);

store.effect(() => {
  console.log(count());
});
```

All reactive values created through one store belong to that store. Signals, memos, effects, and resources from different stores must not be mixed.

## Store-Local APIs

Each store exposes the same behavior as the global helpers:

- `store.signal()`
- `store.untracked()`
- `store.effect()`
- `store.memo()`
- `store.resource()`
- `store.batch()`

They behave the same way as the global APIs, but only within that store.

## `unlink()`

`unlink()` is the store-level teardown mechanism.

```ts
const store = createStore();

store.effect(() => {
  console.log('reactive');
});

await store.unlink();
```

After `unlink()`:
- existing effects and memos become inert
- reads are still allowed
- future updates no longer trigger the unlinked reactive graph

This differs from canceling a single effect:
- canceling an effect stops only that effect
- `unlink()` tears down the whole store graph

Use it as a cleanup step when the store lifetime ends.

## Edge Cases and Gotchas

- Do not mix signals from one store with effects, memos, or resources from another store.
- Creating new reactive state after `unlink()` is not recommended.
- `unlink()` is asynchronous because it tears down async reactive work as well.

## Additional Examples

### Request-local store

```ts
function createRequestState() {
  const store = createStore();
  const session = store.signal(null as string | null);

  return { store, session };
}
```

### Store-local resource

```ts
const store = createStore();
const userId = store.signal('');

const [user] = store.resource(async ({ track, signal }) => {
  const id = track(userId);
  const response = await fetch(`/api/users/${id}`, { signal });
  return response.json();
});
```

## Related Topics

- [`signals.md`](./signals.md)
- [`memos.md`](./memos.md)
- [`effects.md`](./effects.md)
- [`resources.md`](./resources.md)
- [`utilities.md`](./utilities.md)
