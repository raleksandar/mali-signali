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

await verifyDeclarationFile(path.join(artifactDir, 'index.d.mts'));
await verifyDeclarationFile(path.join(artifactDir, 'index.d.cts'));

function verifyStoreApi(module, label) {
    const store = module.createStore();

    assert.equal(typeof store.unlink, 'function', `${label} createStore() must expose unlink()`);
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

    await Promise.resolve();
    await Promise.resolve();

    setAfterAwait(1);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(runs.length, 1, `${label} post-await reads must stay untracked`);

    setTracked(1);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(runs.length, 2, `${label} pre-await reads must remain tracked`);
}
