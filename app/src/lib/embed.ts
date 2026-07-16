// In-process text embeddings via transformers.js (ONNX, CPU). Runs entirely
// inside the TEE — no embedding calls leave the VM. We use bge-small-en-v1.5,
// a small, strong retrieval model (384-dim). The model is downloaded once into
// the /data volume (see TRANSFORMERS_CACHE) so it survives redeploys.
//
// Embeddings are L2-normalized here, so a dot product equals cosine similarity —
// which is what db.searchChunks relies on.

export const EMBED_DIM = 384;
const MODEL_ID = "Xenova/bge-small-en-v1.5";

// bge models are tres sensitive to a query instruction prefix; the doc side gets
// no prefix. This asymmetry meaningfully improves retrieval.
const QUERY_PREFIX =
  "Represent this sentence for searching relevant passages: ";

type FeatureExtractor = (
  texts: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ dims: number[]; data: Float32Array }>;

let _extractorPromise: Promise<FeatureExtractor> | null = null;

async function getExtractor(): Promise<FeatureExtractor> {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Persist the downloaded model on the mounted volume so it isn't re-fetched
      // on every redeploy. DB_PATH's directory is the volume mount (/data).
      const dbDir =
        (process.env.DB_PATH && dirname(process.env.DB_PATH)) || "./data";
      env.cacheDir = `${dbDir}/models`;
      env.allowLocalModels = true;
      // onnxruntime-node runs on CPU inside the TEE; keep it single-threaded-ish
      // friendly by letting ORT pick, and use the quantized weights (smaller/faster).
      const pipe = await pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
      });
      return pipe as unknown as FeatureExtractor;
    })();
  }
  return _extractorPromise;
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "." : p.slice(0, i);
}

// Embed document chunks (no query prefix). Returns one Float32Array per input.
export async function embedPassages(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const out: Float32Array[] = [];
  // Batch to keep peak memory reasonable on the CPU-only VM.
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await extractor(batch, { pooling: "mean", normalize: true });
    const [n, d] = res.dims;
    for (let r = 0; r < n; r++) {
      out.push(res.data.slice(r * d, (r + 1) * d) as Float32Array);
    }
  }
  return out;
}

// Embed a search query (with the bge query instruction prefix).
export async function embedQuery(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const res = await extractor(QUERY_PREFIX + text, {
    pooling: "mean",
    normalize: true,
  });
  return res.data.slice(0, res.dims[res.dims.length - 1]) as Float32Array;
}

// ---- Chunking ---------------------------------------------------------------

export type TextChunk = { content: string; page: number | null; index: number };

// Split text into overlapping chunks sized for the embedder and the 8k chat
// context. We chunk on paragraph/sentence boundaries where possible so a chunk
// stays semantically coherent. `page` is best-effort (null unless the caller
// provides page markers).
export function chunkText(
  text: string,
  opts: { targetChars?: number; overlapChars?: number } = {},
): TextChunk[] {
  const target = opts.targetChars ?? 1200; // ~300 tokens
  const overlap = opts.overlapChars ?? 200;

  // Break into paragraphs first, then greedily pack into chunks.
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: TextChunk[] = [];
  let buf = "";
  const flush = () => {
    const content = buf.trim();
    if (content) chunks.push({ content, page: null, index: chunks.length });
  };

  for (const para of paras) {
    // A single paragraph longer than the target gets hard-split by sentences.
    if (para.length > target) {
      if (buf) {
        flush();
        buf = "";
      }
      for (const piece of splitLong(para, target, overlap)) {
        chunks.push({ content: piece, page: null, index: chunks.length });
      }
      continue;
    }
    if (buf.length + para.length + 2 > target) {
      flush();
      // Carry an overlap tail into the next chunk for context continuity.
      buf = buf.length > overlap ? buf.slice(buf.length - overlap) + "\n\n" : "";
    }
    buf += (buf ? "\n\n" : "") + para;
  }
  flush();

  // Re-index in case flush ordering left gaps.
  return chunks.map((c, i) => ({ ...c, index: i }));
}

function splitLong(text: string, target: number, overlap: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf.length + s.length + 1 > target && buf) {
      out.push(buf.trim());
      buf = buf.length > overlap ? buf.slice(buf.length - overlap) + " " : "";
    }
    // A single monster sentence (no boundaries) still has to be cut.
    if (s.length > target) {
      for (let i = 0; i < s.length; i += target - overlap) {
        out.push(s.slice(i, i + target));
      }
      buf = "";
      continue;
    }
    buf += (buf ? " " : "") + s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
