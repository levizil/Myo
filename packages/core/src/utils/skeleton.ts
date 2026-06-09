import { Parser, Language, Node as SyntaxNode } from 'web-tree-sitter';
import * as path from 'path';

let _parser: Parser | null = null;

export async function initializeSkeletonParser(
    parserWasmDir: string,
    typescriptGrammarWasmPath: string
): Promise<void> {
    if (_parser) { return; }

    await Parser.init({
        locateFile: (filename: string) => path.join(parserWasmDir, filename)
    });

    const tsLanguage: Language = await Language.load(typescriptGrammarWasmPath);
    _parser = new Parser();
    _parser.setLanguage(tsLanguage);
}

export function extractSkeleton(code: string): string {
    if (!_parser) {
        throw new Error('B.O.N.E.S. parser not initialized. Call initializeSkeletonParser() first.');
    }

    const tree = _parser.parse(code);
    if (!tree) { return ''; }

    const lines: string[] = [];
    const topLevel = tree.rootNode.children;

    for (let i = 0; i < topLevel.length; i++) {
        const node = topLevel[i];

        if (node.type === 'comment' && node.text.startsWith('/**')) {
            // Keep JSDoc only if the next sibling is a kept export declaration
            let nextIdx = i + 1;
            while (nextIdx < topLevel.length && topLevel[nextIdx].type === 'comment') {
                nextIdx++;
            }
            if (nextIdx < topLevel.length && isKeptExportStatement(topLevel[nextIdx])) {
                lines.push(node.text);
            }
            continue;
        }

        if (node.type === 'export_statement') {
            const snippet = extractExportSnippet(node, code);
            if (snippet) {
                lines.push(snippet);
                lines.push('');
            }
        }
    }

    return lines.join('\n').trimEnd();
}

const keptDeclarationTypes = new Set([
    'function_declaration',
    'generator_function_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'class_declaration',
    'abstract_class_declaration',
]);

function isKeptExportStatement(node: SyntaxNode): boolean {
    if (node.type !== 'export_statement') { return false; }
    const decl = node.namedChildren[0];
    return !!decl && keptDeclarationTypes.has(decl.type);
}

function extractExportSnippet(exportNode: SyntaxNode, code: string): string | null {
    const decl = exportNode.namedChildren[0];
    if (!decl) { return null; }

    switch (decl.type) {
        case 'function_declaration':
        case 'generator_function_declaration':
            return stripFunctionBody(exportNode.startIndex, decl, code);
        case 'interface_declaration':
        case 'type_alias_declaration':
            return exportNode.text;
        case 'class_declaration':
        case 'abstract_class_declaration':
            return extractClassSkeleton(exportNode.startIndex, decl, code);
        default:
            return null;
    }
}

function stripFunctionBody(exportStart: number, funcDecl: SyntaxNode, code: string): string {
    const body = funcDecl.children.find(c => c.type === 'statement_block');
    if (!body) {
        return code.slice(exportStart);
    }
    return code.slice(exportStart, body.startIndex).trimEnd() + ' {}';
}

function extractClassSkeleton(exportStart: number, classDecl: SyntaxNode, code: string): string {
    const classBody = classDecl.children.find(c => c.type === 'class_body');
    if (!classBody) {
        return code.slice(exportStart).split('\n')[0] + ' {}';
    }

    const header = code.slice(exportStart, classBody.startIndex).trimEnd();
    const memberLines: string[] = [];

    for (const member of classBody.namedChildren) {
        if (member.type === 'comment' && member.text.startsWith('/**')) {
            memberLines.push('  ' + member.text);
            continue;
        }

        if (member.type === 'method_definition') {
            const isPrivateOrProtected = member.namedChildren.some(
                c => c.type === 'accessibility_modifier' && (c.text === 'private' || c.text === 'protected')
            );
            if (isPrivateOrProtected) { continue; }

            const body = member.children.find(c => c.type === 'statement_block');
            if (body) {
                const sig = code.slice(member.startIndex, body.startIndex).trimEnd();
                memberLines.push('  ' + sig + ' {}');
            } else {
                memberLines.push('  ' + member.text);
            }
        }
    }

    return header + ' {\n' + memberLines.join('\n') + '\n}';
}
