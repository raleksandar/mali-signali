# `mali-signali`

This package provides a lightweight, framework-agnostic TypeScript library for reactive state management.

## Signals

Signals are the basic units of state. They hold a value and are represented as a tuple of `read()` and `update()` functions. 

```ts
import { signal } from 'mali-signali';

const [count, setCount] = signal(0);

console.log(count()); // 0

setCount(1);

console.log(count()); // 1
```

As a convenience, the `signal()` function actually returns an instance of Array subclass with 
`read()` and `update()` methods, so it can be passed around as a single object.

```ts
const count = signal(0);

console.log(count.read()); // 0

count.update(1);

console.log(count.read()); // 1
```

## Memos

Memos are derived (a.k.a. computed) signals. They are created by passing a function that computes the value of the memo based on the values of other signals.

They are read-only and are updated automatically when the signals they depend on change.

The memo's compute function MUST be idempotent (i.e., it must not have side effects and must always return the same result for the same values of signals it depends on).

```ts
import { signal, memo } from 'mali-signali';

const [count, setCount] = signal(0);
const doubleCount = memo(() => count() * 2);

console.log(count()); // 0
console.log(doubleCount()); // 0

setCount(6);

console.log(count()); // 6
console.log(doubleCount()); // 12
```

## Effects

Effects are functions that are re-run whenever the signals (or memos) they depend on change. They are what makes the state management reactive.

```ts
import { signal, memo, effect } from 'mali-signali';

const [count, setCount] = signal(0);
const doubleCount = memo(() => count() * 2);

effect(() => {
  // simply reading a signal within the effect creates a dependency
  // and causes the effect to be executed whenever that signal changes
  console.log('doubleCount:', doubleCount());
});

// console logs 'doubleCount: 0'

setCount(6); // console logs 'doubleCount: 12'
setCount(10); // console logs 'doubleCount: 20'
```

Effect functions can return a cleanup function that is called before the effect is called again. This can be used to clean up resources or cancel subscriptions.

```ts
import { signal, effect } from 'mali-signali';

const [count, setCount] = signal(0);

effect(() => {
  console.log('count:', count());

  const id = setInterval(() => {
    setCount(count() + 1);
  }, 1000);

  return () => {
    // without clearing the interval, after each update a new timer
    // would be created, causing the count to increase exponentially
    clearInterval(id);
  };
});
```

The `effect()` function itself returns a callback which, when called, cancels the effect (i.e. removes that effect from dependencies of referenced signals).

```ts
import { signal, effect } from 'mali-signali';

const [count, setCount] = signal(0);

const cancel = effect(() => {
  console.log('count:', count());
});

// console logs 'count: 0'

setCount(1); // console logs 'count: 1'
setCount(2); // console logs 'count: 2'

cancel();

setCount(3); // nothing happens
```

## Untracked reads

For cases where you need to read the value of a signal without tracking it as a dependency, you can call the reader function via `untracked()`.

```ts
import { signal, effect, untracked } from 'mali-signali';

const [a, setA] = signal(1);
const [b, setB] = signal(2);

effect(() => {
  setA(untracked(a) + b());  // effect reads but does not depend on 'a'
});

setB(3);
console.log(a()); // 6
```

## Batching

The `batch()` function can be used to batch updates to signals. This can be useful when multiple signals are updated in quick succession, as it prevents unnecessary re-runs of effects.

```ts
import { signal, effect, batch } from 'mali-signali';

const [a, setA] = signal(1);
const [b, setB] = signal(2);
const sum = memo(() => a() + b());

effect(() => {
  console.log(a(), '+', b(), '=', sum());
});

// console logs '1 + 2 = 3'

setA(3); // console logs '3 + 2 = 5'
setA(4); // console logs '4 + 2 = 6'
setB(5); // console logs '4 + 5 = 9'

batch(() => {
  setA(6);  // no logs
  setB(7);  // no logs
  setB(8);  // no logs
});

// console logs '6 + 8 = 14'
```

## Store

The `createStore()` function can be used to create an independent store that holds a collection of signals, memos, and effects. It provides a way to use same instance of library in multiple places without interfering with each other.

The signals, memos, and effects from one store are isolated from those of another store and MUST NOT be used interchangeably between stores.

The `createStore()` returns an object with `signal()`, `memo()`, `effect()`, and `batch()` functions that work the same way as the global functions, but operate on the store they were created with.

The global functions `signal()`, `memo()`, `effect()`, and `batch()` are simply shortcuts for the default library-global store.


## License

MIT


## See also

 - [Solid.js](https://github.com/solidjs/solid)
 - [Preact Signals](https://github.com/preactjs/signals)
