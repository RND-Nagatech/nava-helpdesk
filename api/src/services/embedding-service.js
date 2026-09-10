import { env } from "../config/env.js";

let extractorPromise;

function trimForEmbedding(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.slice(0, Math.max(200, env.embeddingMaxChars));
}

async function getExtractor() {
  if (!env.vectorSearchEnabled) {
    throw new Error("Vector search sedang dinonaktifkan.");
  }

  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      console.log(`Memuat embedding model lokal: ${env.embeddingModel} (${env.embeddingDtype})`);
      const extractor = await pipeline(
        "feature-extraction",
        env.embeddingModel,
        { dtype: env.embeddingDtype }
      );
      console.log("Embedding model siap.");
      return extractor;
    })().catch((error) => {
      extractorPromise = undefined;
      throw error;
    });
  }

  return extractorPromise;
}

function validateVectors(vectors) {
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== env.embeddingDimensions) {
      throw new Error(
        `Dimensi embedding tidak sesuai. Diharapkan ${env.embeddingDimensions}, didapat ${vector?.length ?? "unknown"}.`
      );
    }
  }
  return vectors;
}

async function embedTexts(texts, prefix) {
  if (!Array.isArray(texts) || !texts.length) return [];

  const extractor = await getExtractor();
  const prepared = texts.map((text) => `${prefix}: ${trimForEmbedding(text) || "-"}`);
  const output = await extractor(prepared, { pooling: "mean", normalize: true });
  const vectors = output.tolist();

  return validateVectors(vectors);
}

export async function embedQuery(text) {
  const [vector] = await embedTexts([text], "query");
  return vector;
}

export async function embedDocuments(texts) {
  return embedTexts(texts, "passage");
}

export async function warmupEmbeddingModel() {
  if (!env.vectorSearchEnabled || !env.embeddingWarmupOnStart) return false;
  await getExtractor();
  return true;
}
