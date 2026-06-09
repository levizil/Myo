import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { embed } from '../clients/embedder';
import { initVectorStore, upsert, querySimilar, deleteById, VectorRecord } from '../clients/vectorStore';
import { initializeWorkspace } from '../features/workspaceIndex';

function makeTmpDir() {
  return path.join(os.tmpdir(), `myo-sled-${process.hrtime.bigint()}`);
}

suite('S.L.E.D. — embedder', () => {
  test('embed() returns a number[] of length 384', async function () {
    this.timeout(120000); // first call downloads the WASM model
    const vector = await embed('export function doThing(): void');
    assert.ok(Array.isArray(vector), 'expected an array');
    assert.strictEqual(vector.length, 384, 'expected all-MiniLM-L6-v2 dimensionality');
    assert.ok(vector.every(n => typeof n === 'number'), 'every element must be a number');
  });
});

suite('S.L.E.D. — workspaceIndex', () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = makeTmpDir();
    await fs.mkdir(tmpDir, { recursive: true });
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('creates .myo/vector_store directory on first run', async function () {
    this.timeout(15000);
    await initializeWorkspace(tmpDir);
    const stat = await fs.stat(path.join(tmpDir, '.myo', 'vector_store'));
    assert.ok(stat.isDirectory());
  });

  test('appends .myo/ to .gitignore when absent', async function () {
    this.timeout(15000);
    await initializeWorkspace(tmpDir);
    const content = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    assert.ok(content.includes('.myo/'));
  });

  test('is idempotent — no duplicate .myo/ entries in .gitignore', async function () {
    this.timeout(20000);
    await initializeWorkspace(tmpDir);
    await initializeWorkspace(tmpDir);
    const content = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    const matches = content.split('\n').filter(l => l.trim() === '.myo/');
    assert.strictEqual(matches.length, 1);
  });

  test('does not overwrite existing .gitignore entries', async function () {
    this.timeout(15000);
    const existing = 'node_modules/\ndist/\n';
    await fs.writeFile(path.join(tmpDir, '.gitignore'), existing, 'utf8');
    await initializeWorkspace(tmpDir);
    const content = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    assert.ok(content.includes('node_modules/'));
    assert.ok(content.includes('dist/'));
    assert.ok(content.includes('.myo/'));
  });
});

suite('S.L.E.D. — vectorStore', () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = makeTmpDir();
    await fs.mkdir(tmpDir, { recursive: true });
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('upsert and querySimilar round-trip', async function () {
    this.timeout(15000);
    const table = await initVectorStore(tmpDir);
    const record: VectorRecord = {
      id: 'src/foo.ts::doThing',
      vector: new Array(384).fill(0.1),
      skeleton: 'export function doThing(): void',
      filePath: 'src/foo.ts'
    };
    await upsert(table, record);
    const results = await querySimilar(table, new Array(384).fill(0.1), 1);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, 'src/foo.ts::doThing');
    assert.strictEqual(results[0].skeleton, 'export function doThing(): void');
  });

  test('upsert overwrites an existing record with the same id', async function () {
    this.timeout(15000);
    const table = await initVectorStore(tmpDir);
    const base: VectorRecord = {
      id: 'src/bar.ts::helper',
      vector: new Array(384).fill(0.2),
      skeleton: 'old skeleton',
      filePath: 'src/bar.ts'
    };
    await upsert(table, base);
    await upsert(table, { ...base, skeleton: 'new skeleton' });
    assert.strictEqual(await table.countRows(), 1);
    const results = await querySimilar(table, new Array(384).fill(0.2), 1);
    assert.strictEqual(results[0].skeleton, 'new skeleton');
  });

  test('deleteById removes the record', async function () {
    this.timeout(15000);
    const table = await initVectorStore(tmpDir);
    const record: VectorRecord = {
      id: 'src/baz.ts::parse',
      vector: new Array(384).fill(0.3),
      skeleton: 'export function parse(s: string): unknown',
      filePath: 'src/baz.ts'
    };
    await upsert(table, record);
    await deleteById(table, 'src/baz.ts::parse');
    assert.strictEqual(await table.countRows(), 0);
  });

  test('initVectorStore is idempotent — opens existing table on second call', async function () {
    this.timeout(15000);
    const table1 = await initVectorStore(tmpDir);
    const record: VectorRecord = {
      id: 'a::b',
      vector: new Array(384).fill(0.4),
      skeleton: 'export const a = 1',
      filePath: 'a.ts'
    };
    await upsert(table1, record);
    const table2 = await initVectorStore(tmpDir);
    assert.strictEqual(await table2.countRows(), 1);
  });
});
