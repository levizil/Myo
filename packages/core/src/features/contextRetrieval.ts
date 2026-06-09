import * as path from 'path';
import * as lancedb from '@lancedb/lancedb';
import { embed } from '../clients/embedder';
import { querySimilar, VectorRecord } from '../clients/vectorStore';

const TOKEN_WARN_THRESHOLD = 2000;

export function buildContextBlock(
  records: Pick<VectorRecord, 'id' | 'skeleton' | 'filePath'>[],
  workspaceRoot?: string
): string {
  // Deduplicate by id
  const seen = new Set<string>();
  const unique = records.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  // Group by filePath, preserving insertion order
  const byFile = new Map<string, string[]>();
  for (const r of unique) {
    const group = byFile.get(r.filePath) ?? [];
    group.push(r.skeleton);
    byFile.set(r.filePath, group);
  }

  // Build flat Markdown sections — N.A.T.I.V.E. format (ADR 008)
  const sections: string[] = [];
  for (const [filePath, skeletons] of byFile) {
    const displayPath = (workspaceRoot
      ? path.relative(workspaceRoot, filePath)
      : path.basename(filePath)
    ).split(path.sep).join('/');
    sections.push(`// File: ${displayPath}\n\n${skeletons.join('\n\n')}`);
  }

  const inner = sections.join('\n\n');
  const block = `<Workspace_Context>\n${inner}\n</Workspace_Context>`;

  const estimatedTokens = Math.ceil(block.length / 4);
  if (estimatedTokens > TOKEN_WARN_THRESHOLD) {
    console.warn(`[F.I.N.D.] Context block is ~${estimatedTokens} tokens — approaching model context limits.`);
  } else {
    console.log(`[F.I.N.D.] Context block ~${estimatedTokens} tokens (${unique.length} symbols).`);
  }

  return block;
}

export async function retrieveContext(
  query: string,
  db: lancedb.Table,
  topK = 5,
  workspaceRoot?: string
): Promise<string> {
  const queryVector = await embed(query);
  const results = await querySimilar(db, queryVector, topK);
  return buildContextBlock(results, workspaceRoot);
}
