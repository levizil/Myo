import * as assert from 'assert';
import * as path from 'path';
import { buildContextBlock } from '../features/contextRetrieval';

const ROOT = path.join('C:', 'workspace');
const FIXTURES = [
  { id: 'src/auth.ts::validateToken', skeleton: 'export function validateToken(token: string): boolean {}', filePath: path.join(ROOT, 'src', 'auth.ts'), vector: [] },
  { id: 'src/user.ts::createUser',    skeleton: 'export function createUser(data: UserData): Promise<User> {}', filePath: path.join(ROOT, 'src', 'user.ts'), vector: [] },
  { id: 'src/db.ts::connect',         skeleton: 'export async function connect(url: string): Promise<Connection> {}', filePath: path.join(ROOT, 'src', 'db.ts'), vector: [] },
];

suite('F.I.N.D. — buildContextBlock', () => {
  test('wraps output in <Workspace_Context> tags', () => {
    const block = buildContextBlock(FIXTURES);
    assert.ok(block.startsWith('<Workspace_Context>'), 'should start with opening tag');
    assert.ok(block.endsWith('</Workspace_Context>'), 'should end with closing tag');
  });

  test('emits // File: comment headers for each unique file', () => {
    const block = buildContextBlock(FIXTURES);
    assert.ok(block.includes('// File:'), 'should contain file comment headers');
    assert.strictEqual((block.match(/\/\/ File:/g) ?? []).length, 3, 'one header per file');
  });

  test('uses relative paths when workspaceRoot is provided', () => {
    const block = buildContextBlock(FIXTURES, ROOT);
    assert.ok(block.includes('// File: src/auth.ts'), 'path should be relative with forward slashes');
    assert.ok(!block.includes(ROOT), 'absolute root should be stripped');
  });

  test('falls back to basename when no workspaceRoot is provided', () => {
    const block = buildContextBlock(FIXTURES);
    assert.ok(block.includes('// File: auth.ts'), 'should use basename fallback');
  });

  test('includes raw skeleton strings directly (no JSON wrapping)', () => {
    const block = buildContextBlock(FIXTURES);
    for (const f of FIXTURES) {
      assert.ok(block.includes(f.skeleton), `missing skeleton for ${f.id}`);
    }
    assert.ok(!block.includes('"skeleton":'), 'output must not contain JSON key syntax');
  });

  test('deduplicates records with the same id', () => {
    const withDuplicate = [...FIXTURES, { ...FIXTURES[0] }];
    const block = buildContextBlock(withDuplicate);
    const headerCount = (block.match(/\/\/ File:/g) ?? []).length;
    assert.strictEqual(headerCount, 3, 'duplicate should not add an extra file section');
    const firstSkeleton = FIXTURES[0].skeleton;
    const occurrences = block.split(firstSkeleton).length - 1;
    assert.strictEqual(occurrences, 1, 'duplicate skeleton should appear only once');
  });

  test('logs token count to console', () => {
    const logged: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
    console.warn = (...args: unknown[]) => { logged.push(args.join(' ')); };
    try {
      buildContextBlock(FIXTURES);
      assert.ok(
        logged.some(msg => msg.includes('[F.I.N.D.]') && msg.includes('tokens')),
        'expected token count log from [F.I.N.D.]'
      );
    } finally {
      console.log = origLog;
      console.warn = origWarn;
    }
  });

  test('returns empty context block for no results', () => {
    const block = buildContextBlock([]);
    assert.ok(block.startsWith('<Workspace_Context>'));
    assert.ok(block.endsWith('</Workspace_Context>'));
    assert.ok(!block.includes('// File:'), 'empty block should have no file headers');
  });
});
