import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Recursively scans a directory to list all file paths relative to baseDir.
 * Ignores node_modules, .git, out, and dist directories.
 */
export async function scanWorkspaceDir(dir: string, baseDir: string = dir): Promise<string[]> {
	let results: string[] = [];
	try {
		const list = await fs.readdir(dir, { withFileTypes: true });
		for (const file of list) {
			const res = path.resolve(dir, file.name);
			const relative = path.relative(baseDir, res);
			
			// Ignore standard non-source folders
			if (file.isDirectory()) {
				if (
					file.name === 'node_modules' ||
					file.name === '.git' ||
					file.name === 'out' ||
					file.name === 'dist' ||
					file.name === '.vscode' ||
					file.name === '.vscode-test'
				) {
					continue;
				}
				const subResults = await scanWorkspaceDir(res, baseDir);
				results = results.concat(subResults);
			} else {
				results.push(relative);
			}
		}
	} catch (e) {
		// Ignore readdir failures (e.g. permission errors)
	}
	return results;
}
