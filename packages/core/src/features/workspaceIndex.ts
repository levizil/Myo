import * as fs from 'fs/promises';
import * as path from 'path';
import * as lancedb from '@lancedb/lancedb';
import { initVectorStore, upsert, deleteById, listByFilePath } from '../clients/vectorStore';
import { embed } from '../clients/embedder';
import { extractSymbols } from '../utils/skeleton';

const GITIGNORE_ENTRY = '.myo/';

let _table: lancedb.Table | null = null;

export async function initializeWorkspace(workspacePath: string): Promise<lancedb.Table> {
  await ensureGitignore(workspacePath);
  const storePath = path.join(workspacePath, '.myo', 'vector_store');
  _table = await initVectorStore(storePath);
  return _table;
}

export async function synchronizeFileVector(filePath: string, textContent: string): Promise<void> {
  if (!_table) { return; }

  const symbols = extractSymbols(textContent);
  const existing = await listByFilePath(_table, filePath);

  const currentIds = new Set<string>();
  for (const sym of symbols) {
    const id = `${filePath}::${sym.name}`;
    currentIds.add(id);
    const vector = await embed(sym.skeleton);
    await upsert(_table, { id, vector, skeleton: sym.skeleton, filePath });
  }

  for (const record of existing) {
    if (!currentIds.has(record.id)) {
      await deleteById(_table, record.id);
    }
  }
}

async function ensureGitignore(workspacePath: string): Promise<void> {
  const gitignorePath = path.join(workspacePath, '.gitignore');
  let content = '';
  try {
    content = await fs.readFile(gitignorePath, 'utf8');
  } catch {
    // File doesn't exist yet — will be created below
  }

  const lines = content.split('\n');
  const alreadyPresent = lines.some(l => l.trim() === '.myo/' || l.trim() === '.myo');
  if (alreadyPresent) {
    return;
  }

  const trailing = content === '' || content.endsWith('\n') ? '' : '\n';
  await fs.writeFile(gitignorePath, content + trailing + GITIGNORE_ENTRY + '\n', 'utf8');
}
