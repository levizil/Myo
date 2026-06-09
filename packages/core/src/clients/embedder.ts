// Dynamic import required — @xenova/transformers is an ESM-only package
// but @myo/core compiles as CommonJS (Node16 module resolution without "type":"module").

const MODEL = 'Xenova/all-MiniLM-L6-v2';

let _extractor: unknown | null = null;

async function getExtractor(): Promise<unknown> {
  if (!_extractor) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { pipeline } = (await import('@xenova/transformers')) as any;
    _extractor = await pipeline('feature-extraction', MODEL);
  }
  return _extractor;
}

export async function embed(text: string): Promise<number[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractor = (await getExtractor()) as any;
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data) as number[];
}
