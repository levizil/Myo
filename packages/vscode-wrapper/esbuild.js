const esbuild = require("esbuild");
const { copyFile, mkdir } = require('fs/promises');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const copyWasmPlugin = {
	name: 'copy-wasm-files',
	setup(build) {
		build.onEnd(async (result) => {
			if (result.errors.length > 0) { return; }
			await mkdir(path.join(__dirname, 'dist'), { recursive: true });
			const webTreeSitterDir = path.dirname(require.resolve('web-tree-sitter'));
			const tsGrammarDir = path.dirname(require.resolve('tree-sitter-typescript/package.json'));
			await copyFile(
				path.join(webTreeSitterDir, 'web-tree-sitter.wasm'),
				path.join(__dirname, 'dist', 'web-tree-sitter.wasm')
			);
			await copyFile(
				path.join(tsGrammarDir, 'tree-sitter-typescript.wasm'),
				path.join(__dirname, 'dist', 'tree-sitter-typescript.wasm')
			);
		});
	}
};

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		// 'vscode' is always external (provided by the extension host).
		// Native addon packages cannot be bundled by esbuild — keep them as
		// require() calls resolved from node_modules at runtime.
		external: [
			'vscode',
			'@lancedb/lancedb',
			'@xenova/transformers',
			'onnxruntime-node',
			'sharp',
		],
		logLevel: 'silent',
		plugins: [
			copyWasmPlugin,
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
