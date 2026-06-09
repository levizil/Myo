import * as assert from 'assert';
import * as path from 'path';
import { initializeSkeletonParser, extractSkeleton } from '../index';

suite('B.O.N.E.S. — extractSkeleton', () => {

    suiteSetup(async () => {
        const webTreeSitterDir = path.dirname(require.resolve('web-tree-sitter'));
        const tsGrammarPath = path.join(
            path.dirname(require.resolve('tree-sitter-typescript/package.json')),
            'tree-sitter-typescript.wasm'
        );
        await initializeSkeletonParser(webTreeSitterDir, tsGrammarPath);
    });

    suite('Function body elision', () => {
        test('exported function: body stripped, signature retained', () => {
            const code = [
                'export function buildPrompt(template: string, vars: Record<string, string>): string {',
                "  return template.replace('x', vars.x);",
                '}',
            ].join('\n');
            const result = extractSkeleton(code);
            assert.ok(result.includes('export function buildPrompt(template: string, vars: Record<string, string>): string'), `Got: ${result}`);
            assert.ok(!result.includes('return template'), `Body leaked into skeleton: ${result}`);
        });

        test('non-exported function: entirely absent from skeleton', () => {
            const code = 'function internalHelper(x: number): number {\n  return x * 2;\n}';
            const result = extractSkeleton(code);
            assert.strictEqual(result.trim(), '', `Expected empty skeleton, got: ${result}`);
        });

        test('async exported function: signature retained with async keyword', () => {
            const code = 'export async function fetchData(url: string): Promise<Response> {\n  return fetch(url);\n}';
            const result = extractSkeleton(code);
            assert.ok(result.includes('export async function fetchData('), `Got: ${result}`);
            assert.ok(!result.includes('fetch(url)'), `Body leaked: ${result}`);
        });
    });

    suite('Interface preservation', () => {
        test('exported interface with properties is fully retained', () => {
            const code = [
                'export interface OllamaOptions {',
                '  baseUrl: string;',
                '  model: string;',
                '  keepAlive?: number;',
                '}',
            ].join('\n');
            const result = extractSkeleton(code);
            assert.ok(result.includes('baseUrl: string;'), `Got: ${result}`);
            assert.ok(result.includes('keepAlive?: number;'), `Got: ${result}`);
        });

        test('interface with JSDoc is fully retained including comment', () => {
            const code = [
                '/** Configuration for LLM inference calls */',
                'export interface OllamaOptions {',
                '  baseUrl: string;',
                '}',
            ].join('\n');
            const result = extractSkeleton(code);
            assert.ok(result.includes('/** Configuration for LLM inference calls */'), `Got: ${result}`);
            assert.ok(result.includes('baseUrl: string;'), `Got: ${result}`);
        });
    });

    suite('Type alias preservation', () => {
        test('exported type alias is fully retained', () => {
            const code = "export type ModelName = 'llama3.1:8b' | 'qwen2.5-coder:7b';";
            const result = extractSkeleton(code);
            assert.ok(result.includes("export type ModelName = 'llama3.1:8b'"), `Got: ${result}`);
        });
    });

    suite('Class skeleton', () => {
        test('class: public method signatures kept, bodies stripped', () => {
            const code = [
                'export class GitHubClient {',
                '  async getProjectInfo(owner: string, num: number): Promise<string> {',
                '    const r = await fetch(owner);',
                '    return r.json();',
                '  }',
                '}',
            ].join('\n');
            const result = extractSkeleton(code);
            assert.ok(result.includes('async getProjectInfo(owner: string, num: number): Promise<string> {}'), `Got: ${result}`);
            assert.ok(!result.includes('fetch(owner)'), `Body leaked: ${result}`);
        });

        test('class: private methods are absent from skeleton', () => {
            const code = [
                'export class Foo {',
                '  public doWork(): void { console.log("work"); }',
                '  private buildHeaders(): Record<string, string> { return {}; }',
                '}',
            ].join('\n');
            const result = extractSkeleton(code);
            assert.ok(!result.includes('buildHeaders'), `Private method leaked: ${result}`);
            assert.ok(result.includes('doWork'), `Public method missing: ${result}`);
        });
    });

    suite('Import stripping', () => {
        test('import statements are completely absent from skeleton', () => {
            const code = [
                "import * as path from 'path';",
                'export function resolve(p: string): string { return path.resolve(p); }',
            ].join('\n');
            const result = extractSkeleton(code);
            assert.ok(!result.includes('import'), `Import leaked: ${result}`);
            assert.ok(result.includes('export function resolve('), `Got: ${result}`);
        });
    });

    suite('JSDoc look-ahead', () => {
        test('JSDoc before non-exported function is dropped', () => {
            const code = [
                '/** This is internal */',
                'function internalFn(): void {}',
                '/** This is exported */',
                'export function exportedFn(): void {}',
            ].join('\n');
            const result = extractSkeleton(code);
            assert.ok(!result.includes('This is internal'), `Internal JSDoc leaked: ${result}`);
            assert.ok(result.includes('This is exported'), `Exported JSDoc missing: ${result}`);
        });
    });
});
