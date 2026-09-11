import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";
import { syncKnowledgeVectors } from "../database/qdrant.js";
import { embedDocuments } from "./embedding-service.js";
import { articleEmbeddingText } from "../utils/text.js";

const PROJECTION = {
  articleId: 1,
  title: 1,
  category: 1,
  product: 1,
  symptoms: 1,
  tags: 1,
  userResponseTemplate: 1,
  troubleshootingSteps: 1,
  status: 1,
  embedding: 1,
  embedding_model: 1,
  embedding_profile: 1,
};

function hasCurrentEmbedding(doc, force) {
  return (
    !force &&
    doc.embedding_model === env.embeddingModel &&
    doc.embedding_profile === env.embeddingProfile &&
    Array.isArray(doc.embedding) &&
    doc.embedding.length === env.embeddingDimensions
  );
}

export async function refreshKnowledgeEmbeddings({ force = false } = {}) {
  if (!env.vectorSearchEnabled) {
    throw new Error("VECTOR_SEARCH_ENABLED=false. Aktifkan terlebih dahulu.");
  }

  const db = await getDb();
  const collection = db.collection(env.knowledgeCollection);
  const docs = await collection.find({}, { projection: PROJECTION }).toArray();
  if (!docs.length) throw new Error(`Collection ${env.knowledgeCollection} masih kosong.`);

  const pending = docs.filter((doc) => !hasCurrentEmbedding(doc, force));
  const batchSize = Math.max(1, env.embeddingBatchSize);
  let processed = 0;

  for (let index = 0; index < pending.length; index += batchSize) {
    const batch = pending.slice(index, index + batchSize);
    const vectors = await embedDocuments(batch.map(articleEmbeddingText));
    const now = new Date();
    const operations = batch.map((doc, vectorIndex) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            [env.vectorField]: vectors[vectorIndex],
            embedding_model: env.embeddingModel,
            embedding_profile: env.embeddingProfile,
            embedding_dimensions: env.embeddingDimensions,
            embedding_updated_at: now,
          },
        },
      },
    }));

    await collection.bulkWrite(operations, { ordered: false });
    processed += batch.length;
  }

  const currentDocs = await collection.find({}, { projection: PROJECTION }).toArray();
  const indexResult = await syncKnowledgeVectors(currentDocs);
  return {
    total: docs.length,
    pending: pending.length,
    processed,
    ...indexResult,
  };
}

