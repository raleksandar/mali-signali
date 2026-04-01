import type { AsyncInvalidation, InvalidationQueue } from './types';

/**
 * Default FIFO queue implementation for async effects.
 *
 * It is backed by a simple array and can be reused for custom queueing strategies.
 */
export class DefaultInvalidationQueue<T = AsyncInvalidation> implements InvalidationQueue<T> {
    #items: T[] = [];

    public enqueue(item: T): void {
        this.#items.push(item);
    }

    public dequeue(): T | undefined {
        return this.#items.shift();
    }

    public clear(): void {
        this.#items.length = 0;
    }

    public get size(): number {
        return this.#items.length;
    }
}
