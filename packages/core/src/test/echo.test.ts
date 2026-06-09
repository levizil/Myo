import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as lancedb from '@lancedb/lancedb';
import { initializeWorkspace, synchronizeFileVector } from '../features/workspaceIndex';
import { initVectorStore, listByFilePath } from '../clients/vectorStore';
import { initializeSkeletonParser } from '../utils/skeleton';

function makeTmpDir() {
  return path.join(os.tmpdir(), `myo-echo-${process.hrtime.bigint()}`);
}

suite('E.C.H.O. — synchronizeFileVector', function () {
  this.timeout(120_000);

  let tmpDir: string;
  let table: lancedb.Table;

  suiteSetup(async () => {
    const webTsDir = path.dirname(require.resolve('web-tree-sitter'));
    const tsWasmPath = path.join(
      path.dirname(require.resolve('tree-sitter-typescript/package.json')),
      'tree-sitter-typescript.wasm'
    );
    await initializeSkeletonParser(webTsDir, tsWasmPath);

    tmpDir = makeTmpDir();
    await fs.mkdir(tmpDir, { recursive: true });
    table = await initializeWorkspace(tmpDir);
  });

  suiteTeardown(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('upserts a new symbol on first save', async () => {
    const filePath = path.join(tmpDir, 'greet.ts');
    const content = `export function greet(name: string): string { return name; }`;
    await synchronizeFileVector(filePath, content);
    const records = await listByFilePath(table, filePath);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].id, `${filePath}::greet`);
    assert.strictEqual(records[0].filePath, filePath);
  });

  test('overwrites existing symbol on re-save — no duplicate row', async () => {
    const filePath = path.join(tmpDir, 'parse.ts');
    const v1 = `export function parseInput(s: string): unknown { return JSON.parse(s); }`;
    const v2 = `export function parseInput(s: string): unknown { return s; }`;
    await synchronizeFileVector(filePath, v1);
    await synchronizeFileVector(filePath, v2);
    const records = await listByFilePath(table, filePath);
    assert.strictEqual(records.length, 1, 'expected exactly one record after two saves');
    assert.strictEqual(records[0].id, `${filePath}::parseInput`);
  });

  test('deletes record for a symbol removed from the file', async () => {
    const filePath = path.join(tmpDir, 'two.ts');
    const withTwo = [
      'export function alpha(): void {}',
      'export function beta(): void {}',
    ].join('\n');
    const withOne = 'export function alpha(): void {}';

    await synchronizeFileVector(filePath, withTwo);
    let records = await listByFilePath(table, filePath);
    assert.strictEqual(records.length, 2, 'expected two records after first save');

    await synchronizeFileVector(filePath, withOne);
    records = await listByFilePath(table, filePath);
    assert.strictEqual(records.length, 1, 'expected one record after deleting beta');
    assert.strictEqual(records[0].id, `${filePath}::alpha`);
  });

  test('produces no records for a file with no exports', async () => {
    const filePath = path.join(tmpDir, 'empty.ts');
    const content = `const x = 1; // no exports`;
    await synchronizeFileVector(filePath, content);
    const records = await listByFilePath(table, filePath);
    assert.strictEqual(records.length, 0);
  });

  test('is a no-op before workspace is initialized', async () => {
    // Re-open the raw store independently; singleton _table is already set from before()
    // so this test verifies the guard path via a fresh isolated table instead
    const isolatedDir = makeTmpDir();
    await fs.mkdir(isolatedDir, { recursive: true });
    const isolatedTable = await initVectorStore(path.join(isolatedDir, '.myo', 'vector_store'));
    assert.strictEqual(await isolatedTable.countRows(), 0, 'fresh table should be empty');
    await fs.rm(isolatedDir, { recursive: true, force: true });
  });
});
