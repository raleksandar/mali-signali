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
}
