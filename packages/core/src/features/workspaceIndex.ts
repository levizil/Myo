import * as fs from 'fs/promises';
import * as path from 'path';
import * as lancedb from '@lancedb/lancedb';
import { initVectorStore } from '../clients/vectorStore';

const GITIGNORE_ENTRY = '.myo/';

export async function initializeWorkspace(workspacePath: string): Promise<lancedb.Table> {
  await ensureGitignore(workspacePath);
  const storePath = path.join(workspacePath, '.myo', 'vector_store');
  return initVectorStore(storePath);
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
