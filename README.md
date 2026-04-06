# Moved to https://github.com/haragei-dev/signals

---------

# `mali-signali`

`mali-signali` is a lightweight, framework-agnostic TypeScript library for fine-grained reactive state.

It provides:
- signals for mutable state
- memos for derived state
- effects for reactive side effects
- resources for async derived state
- stores for isolated reactive graphs

## Installation

```sh
pnpm add mali-signali
```

```ts
import { batch, effect, memo, resource, signal, untracked } from 'mali-signali';
```

## Quick Start

```ts
import { effect, memo, signal } from 'mali-signali';

const [count, setCount] = signal(0);
const doubleCount = memo(() => count() * 2);

effect(() => {
  console.log(`${count()} x 2 = ${doubleCount()}`);
});

setCount(1);
setCount(2);
```

## Async Example

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

## Core Concepts

### Signals

Signals are mutable reactive values. Reading a signal inside an effect or memo creates a dependency. Updating it re-runs the dependents that use it.

API reference: [`docs/api/signals.md`](./docs/api/signals.md)

### Memos

Memos are derived read-only signals. They recompute automatically when their dependencies change and are best used for idempotent derived values.

API reference: [`docs/api/memos.md`](./docs/api/memos.md)

### Effects

Effects react to signal, memo, and resource changes. They support cleanup callbacks, cancellation, async execution, post-`await` manual dependency tracking via `track()`, and configurable async concurrency behavior.

API reference: [`docs/api/effects.md`](./docs/api/effects.md)

### Resources

Resources model async derived state. They expose loading, ready, and error states, keep stale values while refreshing, and provide imperative controls such as `refresh()`, `abort()`, and `reset()`.

API reference: [`docs/api/resources.md`](./docs/api/resources.md)

### Stores

Stores isolate reactive graphs. The global APIs are convenience wrappers around a default global store, while `createStore()` lets you construct independent stores explicitly.

API reference: [`docs/api/store.md`](./docs/api/store.md)

### Utilities

The shared runtime utilities cover batching, untracked reads, and queue primitives used by async effects and resources.

API reference: [`docs/api/utilities.md`](./docs/api/utilities.md)

For the full API documentation landing page, see [`docs/api/README.md`](./docs/api/README.md).

## License

MIT

## See Also

- [Solid.js](https://github.com/solidjs/solid)
- [Preact Signals](https://github.com/preactjs/signals)
