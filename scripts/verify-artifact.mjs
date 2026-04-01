import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const targetDir = process.argv[2];

if (!targetDir) {
    throw new Error('Usage: node ./scripts/verify-artifact.mjs <artifact-dir>');
}

const artifactDir = path.resolve(process.cwd(), targetDir);
const require = createRequire(import.meta.url);

const esmModule = await import(pathToFileURL(path.join(artifactDir, 'index.mjs')).href);
const cjsModule = require(path.join(artifactDir, 'index.cjs'));

verifyStoreApi(esmModule, 'ESM');
verifyStoreApi(cjsModule, 'CJS');
verifyUntrackedRecovery(esmModule, 'ESM');
verifyUntrackedRecovery(cjsModule, 'CJS');
await verifyAsyncEffectRuntime(esmModule, 'ESM');
await verifyAsyncEffectRuntime(cjsModule, 'CJS');
await verifyResourceRuntime(esmModule, 'ESM');
await verifyResourceRuntime(cjsModule, 'CJS');

await verifyDeclarationFile(path.join(artifactDir, 'index.d.mts'));
await verifyDeclarationFile(path.join(artifactDir, 'index.d.cts'));

function verifyStoreApi(module, label) {
    const store = module.createStore();

    assert.equal(typeof store.unlink, 'function', `${label} createStore() must expose unlink()`);
    assert.equal(typeof store.resource, 'function', `${label} createStore() must expose resource()`);
}

function verifyUntrackedRecovery(module, label) {
    const store = module.createStore();
    const [read, write] = store.signal(0);
    let runs = 0;

    store.effect(() => {
        runs++;
        read();
    });

    assert.equal(runs, 1, `${label} effect must run immediately`);

    assert.throws(() => {
        store.untracked(() => {
            throw new Error('boom');
        });
    }, /boom/);

    write(1);
    assert.equal(runs, 2, `${label} effect must stay subscribed after first update`);

    write(2);
    assert.equal(runs, 3, `${label} tracking must be restored after untracked() throws`);
}

async function verifyDeclarationFile(filePath) {
    const content = await readFile(filePath, 'utf8');

    assert.match(
        content,
        /unlink\(\): Promise<void>;/,
        `${path.basename(filePath)} must declare Store.unlink()`,
    );
    assert.match(
        content,
        /type AsyncEffectFunction = \(context: AsyncEffectContext\) => Promise<void>;/,
        `${path.basename(filePath)} must declare AsyncEffectFunction`,
    );
    assert.match(
        content,
        /readonly concurrency\?: AsyncEffectConcurrency;/,
        `${path.basename(filePath)} must declare async effect concurrency options`,
    );
    assert.match(
        content,
        /onCleanup\(cleanup: \(\) => void\): void;/,
        `${path.basename(filePath)} must declare effect cleanup registration`,
    );
    assert.match(
        content,
        /track<T>\(read: SignalReader<T>\): T;/,
        `${path.basename(filePath)} must declare effect context track()`,
    );
    assert.match(
        content,
        /type ResourceConstructor = <T, E = unknown>\(/,
        `${path.basename(filePath)} must declare ResourceConstructor`,
    );
    assert.match(
        content,
        /readonly resource: ResourceConstructor;/,
        `${path.basename(filePath)} must declare Store.resource()`,
    );
    assert.match(
        content,
        /declare class DefaultInvalidationQueue<T = AsyncInvalidation> implements InvalidationQueue<T>/,
        `${path.basename(filePath)} must declare DefaultInvalidationQueue`,
    );
}

async function verifyAsyncEffectRuntime(module, label) {
    const store = module.createStore();
    const [tracked, setTracked] = store.signal(0);
    const [afterAwait, setAfterAwait] = store.signal(0);
    const runs = [];

    store.effect(async ({ signal }) => {
        runs.push([tracked(), signal.aborted]);
        await Promise.resolve();
        afterAwait();
    });

    await flushPromises();

    setAfterAwait(1);
    await flushPromises();

    assert.equal(runs.length, 1, `${label} post-await reads must stay untracked`);

    setTracked(1);
    await flushPromises();

    assert.equal(runs.length, 2, `${label} pre-await reads must remain tracked`);

    const trackedAfterAwaitRuns = [];
    const [lateTracked, setLateTracked] = store.signal(0);

    store.effect(async ({ track }) => {
        await Promise.resolve();
        trackedAfterAwaitRuns.push(track(lateTracked));
    });

    await flushPromises();

    setLateTracked(1);
    await flushPromises();

    assert.equal(
        trackedAfterAwaitRuns.length,
        2,
        `${label} context.track() must subscribe post-await reads`,
    );
}

async function verifyResourceRuntime(module, label) {
    const store = module.createStore();
    const [source, setSource] = store.signal(0);
    const first = deferred();
    const second = deferred();
    const [read, controls] = store.resource(
        async ({ track }) => {
            const value = track(source);
            return value === 0 ? first.promise : second.promise;
        },
        { concurrency: 'concurrent' },
    );

    assert.equal(read().status, 'loading', `${label} resource must start in loading state`);

    first.resolve(1);
    await waitFor(
        () => {
            assert.equal(read().value, 1, `${label} resource must resolve its initial value`);
        },
        `${label} resource must resolve its initial value`,
    );

    setSource(1);
    assert.equal(read().isStale, true, `${label} resource refresh must preserve stale values`);

    second.resolve(2);
    await waitFor(
        () => {
            assert.equal(read().value, 2, `${label} resource must resolve refreshed values`);
        },
        `${label} resource must resolve refreshed values`,
    );

    controls.refresh();
    assert.equal(read().isStale, true, `${label} resource refresh must preserve stale values`);
}

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

async function flushPromises(times = 4) {
    for (let index = 0; index < times; index += 1) {
        await Promise.resolve();
    }
}

async function waitFor(check, message) {
    let lastError;

    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            check();
            return;
        } catch (error) {
            lastError = error;
            await flushPromises();
        }
    }

    throw lastError ?? new Error(message);
}
