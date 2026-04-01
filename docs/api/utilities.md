# Utilities

## Overview

This page covers the small shared runtime utilities that are not a feature family by themselves:
- `batch()`
- `untracked()`
- `InvalidationQueue`
- `DefaultInvalidationQueue`
- `AsyncInvalidation`

It also covers the helper type aliases `BatchFunction` and `UntrackedReader`.

## Canonical Example

```ts
import { batch, effect, signal, untracked } from 'mali-signali';

const [a, setA] = signal(1);
const [b, setB] = signal(2);

effect(() => {
  console.log('tracked:', b(), 'untracked:', untracked(a));
});

batch(() => {
  setA(3);
  setB(4);
});
```

## Public API Summary

```ts
type UntrackedReader = <T>(read: SignalReader<T>) => T;

type BatchFunction = (execute: () => void) => void;

interface AsyncInvalidation {
  readonly generation: number;
}

interface InvalidationQueue<T = AsyncInvalidation> {
  enqueue(item: T): void;
  dequeue(): T | undefined;
  clear(): void;
  readonly size: number;
}

declare class DefaultInvalidationQueue<T = AsyncInvalidation>
  implements InvalidationQueue<T> {
  enqueue(item: T): void;
  dequeue(): T | undefined;
  clear(): void;
  get size(): number;
}

declare function batch(execute: () => void): void;
declare function untracked<T>(read: SignalReader<T>): T;
```

## Full Behavior and Semantics

### `untracked(read)`

Reads a signal, memo, or resource without subscribing the current memo or effect to it.

```ts
effect(() => {
  console.log('tracked b:', b());
  console.log('untracked a:', untracked(a));
});
```

This is useful when you need the current value for computation or logging, but do not want future updates of that value to retrigger the current reactive computation.

### `batch(execute)`

Batches multiple updates so dependents flush after the batch completes.

```ts
batch(() => {
  setA(1);
  setB(2);
});
```

Within the batch:
- signals may update multiple times
- effects and memos do not flush after every individual write
- dependents observe the final batched state once the batch ends

## Options and Related Types

### `AsyncInvalidation`

Queue items used internally and by custom invalidation queues for async effects and resources.

```ts
interface AsyncInvalidation {
  readonly generation: number;
}
```

Treat this as an opaque scheduling token. It is mainly relevant when you provide a custom `InvalidationQueue`.

### `InvalidationQueue`

Custom queue contract for `concurrency: 'queue'` in async effects and resources.

```ts
interface InvalidationQueue<T = AsyncInvalidation> {
  enqueue(item: T): void;
  dequeue(): T | undefined;
  clear(): void;
  readonly size: number;
}
```

### `DefaultInvalidationQueue`

Built-in FIFO queue implementation backed by a simple array.

```ts
import { DefaultInvalidationQueue } from 'mali-signali';

const queue = new DefaultInvalidationQueue();
```

It implements:
- `enqueue(item)`
- `dequeue()`
- `clear()`
- `size`

Example with an async effect:

```ts
import { DefaultInvalidationQueue, effect } from 'mali-signali';

const queue = new DefaultInvalidationQueue();

effect(async () => {
  await doWork(value());
}, {
  concurrency: 'queue',
  queue,
});
```

## Edge Cases and Gotchas

- `untracked()` affects only the wrapped read, not the rest of the surrounding effect or memo.
- `batch()` batches flushes, not application logic. Reads inside the batch still see the latest written values.
- Queue primitives matter only when `concurrency` is `'queue'`.
- `DefaultInvalidationQueue` is FIFO and intentionally minimal; custom queue policies can be implemented by supplying your own `InvalidationQueue`.

## Additional Examples

### Derived update with `untracked()`

```ts
effect(() => {
  setTotal(untracked(previousTotal) + currentDelta());
});
```

### Nested batch

```ts
batch(() => {
  setA(1);

  batch(() => {
    setB(2);
    setC(3);
  });
});
```

### Custom queue

```ts
class LatestOnlyQueue<T> implements InvalidationQueue<T> {
  #items: T[] = [];

  enqueue(item: T): void {
    this.#items = [item];
  }

  dequeue(): T | undefined {
    return this.#items.shift();
  }

  clear(): void {
    this.#items.length = 0;
  }

  get size(): number {
    return this.#items.length;
  }
}
```

## Related Topics

- [`effects.md`](./effects.md)
- [`resources.md`](./resources.md)
- [`signals.md`](./signals.md)
- [`store.md`](./store.md)
