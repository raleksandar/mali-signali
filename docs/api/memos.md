# Memos

## Overview

Memos are derived read-only signals. They compute a value from other reactive values and update automatically when their dependencies change.

This page covers `memo()` and `MemoConstructor`.

## Canonical Example

```ts
import { memo, signal } from 'mali-signali';

const [count, setCount] = signal(2);
const doubled = memo(() => count() * 2);

console.log(doubled()); // 4

setCount(3);

console.log(doubled()); // 6
```

## Public API Summary

```ts
type MemoConstructor = <T>(
  compute: () => T,
  options?: SignalOptions & EffectOptions,
) => SignalReader<T>;

declare function memo<T>(
  compute: () => T,
  options?: SignalOptions & EffectOptions,
): SignalReader<T>;
```

## Full Behavior and Semantics

A memo:
- is read-only
- tracks the signal, memo, and resource readers it uses while computing
- re-computes when those dependencies change
- exposes its current value through a normal `SignalReader<T>`

Memo compute functions must be idempotent. Treat them as pure derived computations, not as places for side effects.

```ts
const subtotal = signal(100);
const taxRate = signal(0.2);

const total = memo(() => subtotal.read() * (1 + taxRate.read()));
```

Memos behave like derived signals, so reading a memo inside another memo or effect creates a dependency on the memo.

## Options and Related Types

`memo()` accepts:
- `SignalOptions`, which control equality of the memo output
- `EffectOptions`, which allow cancellation through an `AbortSignal`

### Equality behavior

Memo output is compared using the same `equals` behavior as signals.

```ts
const settings = memo(() => ({
  theme: theme(),
  locale: locale(),
}), {
  equals: Object.is,
});
```

### AbortSignal support

```ts
const controller = new AbortController();

const doubled = memo(() => count() * 2, {
  signal: controller.signal,
});

controller.abort();
```

After the memo is canceled, reads still work, but the memo no longer reacts to future updates.

## Edge Cases and Gotchas

- Memo compute functions must not perform side effects.
- Memos are synchronous. For async derived state, use [`resource()`](./resources.md).
- Memo equality applies to the computed output, not to individual dependencies.
- A memo can be canceled through `AbortSignal` or as part of `Store.unlink()`.

## Additional Examples

### Memo from multiple signals

```ts
const [firstName] = signal('Ada');
const [lastName] = signal('Lovelace');

const fullName = memo(() => `${firstName()} ${lastName()}`);
```

### Memo consumed by an effect

```ts
effect(() => {
  console.log('full name:', fullName());
});
```

### Memo with custom equality

```ts
const coords = memo(() => ({ x: x(), y: y() }), {
  equals: Object.is,
});
```

## Related Topics

- [`signals.md`](./signals.md)
- [`effects.md`](./effects.md)
- [`resources.md`](./resources.md)
- [`store.md`](./store.md)
