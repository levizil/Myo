import * as lancedb from '@lancedb/lancedb';

export type VectorRecord = {
  id: string;
  vector: number[];
  skeleton: string;
  filePath: string;
};

// Dimension of all-MiniLM-L6-v2 output
const VECTOR_DIM = 384;

export async function initVectorStore(storePath: string): Promise<lancedb.Table> {
  const db = await lancedb.connect(storePath);
  const tables = await db.tableNames();

  if (tables.includes('skeletons')) {
    return db.openTable('skeletons');
  }

  // Bootstrap the schema with a placeholder row, then remove it so the table
  // is empty but typed correctly for all future upserts.
  const placeholder: VectorRecord = {
    id: '__init__',
    vector: new Array(VECTOR_DIM).fill(0),
    skeleton: '',
    filePath: ''
  };
  const table = await db.createTable('skeletons', [placeholder]);
  await table.delete("id = '__init__'");
  return table;
}

export async function upsert(table: lancedb.Table, record: VectorRecord): Promise<void> {
  const safeId = record.id.replace(/'/g, "''");
  await table.delete(`id = '${safeId}'`);
  await table.add([record]);
}

export async function querySimilar(
  table: lancedb.Table,
  vector: number[],
  limit = 5
): Promise<VectorRecord[]> {
  const rows = await table.vectorSearch(vector).limit(limit).toArray();
  return rows as unknown as VectorRecord[];
}

export async function deleteById(table: lancedb.Table, id: string): Promise<void> {
  const safeId = id.replace(/'/g, "''");
  await table.delete(`id = '${safeId}'`);
}

export async function listByFilePath(
  table: lancedb.Table,
  filePath: string
): Promise<VectorRecord[]> {
  const safeFilePath = filePath.replace(/'/g, "''");
  const rows = await table.query().where(`filePath = '${safeFilePath}'`).toArray();
  return rows as unknown as VectorRecord[];
}
