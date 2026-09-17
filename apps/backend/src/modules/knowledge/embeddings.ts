import { env, pipeline } from '@huggingface/transformers';
import { EMBEDDING_DIMENSIONS } from '../../db/schema.js';

const defaultModel = 'Xenova/all-MiniLM-L6-v2';
const batchSize = 8;

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: true },
) => Promise<{ tolist: () => unknown[][] }>;

let extractorPromise: Promise<Extractor> | undefined;

const loadExtractor = () => {
  extractorPromise ??= (async () => {
    env.cacheDir = process.env.HF_CACHE_DIR ?? './.cache/huggingface';
    const createPipeline = pipeline as unknown as (
      task: 'feature-extraction',
      model: string,
    ) => Promise<Extractor>;
    return createPipeline('feature-extraction', process.env.EMBEDDING_MODEL ?? defaultModel);
  })().catch((error) => {
    extractorPromise = undefined;
    throw error;
  });
  return extractorPromise;
};

export const embedTexts = async (texts: string[]): Promise<number[][]> => {
  const extractor = await loadExtractor();
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    for (const vector of output.tolist()) {
      if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Embedding model returned a vector with unexpected dimensions`);
      }
      vectors.push(vector.map(Number));
    }
  }
  if (vectors.length !== texts.length) throw new Error('Embedding count did not match chunk count');
  return vectors;
};

export const embedQuery = async (query: string): Promise<number[]> => {
  const [vector] = await embedTexts([query]);
  if (!vector) throw new Error('Embedding model returned no vector for the query');
  return vector;
};
