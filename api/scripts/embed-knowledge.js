import "dotenv/config";
import { env } from "../src/config/env.js";
import {
  connectMongo,
  ensureIndexes,
  ensureVectorSearchIndex,
  closeMongo,
} from "../src/database/mongodb.js";
import { embedDocuments } from "../src/services/embedding-service.js";
import { articleEmbeddingText } from "../src/utils/text.js";

const force = process.argv.includes("--force");

const PROJECTION = {
  articleId: 1,
  title: 1,
  category: 1,
  product: 1,
  symptoms: 1,
  tags: 1,
  userResponseTemplate: 1,
  troubleshootingSteps: 1,
  embedding: 1,
  embedding_model: 1,
  embedding_profile: 1,
};

function hasCurrentEmbedding(doc) {
  return (
    !force &&
    doc.embedding_model === env.embeddingModel &&
    doc.embedding_profile === env.embeddingProfile &&
    Array.isArray(doc.embedding) &&
    doc.embedding.length === env.embeddingDimensions
  );
}

async function main() {
  if (!env.mongodbUri) throw new Error("MONGODB_URI belum diisi di .env");
  if (!env.vectorSearchEnabled) throw new Error("VECTOR_SEARCH_ENABLED=false. Aktifkan terlebih dahulu.");

  const db = await connectMongo();
  await ensureIndexes();
  const collection = db.collection(env.knowledgeCollection);
  const docs = await collection.find({}, { projection: PROJECTION }).toArray();

  if (!docs.length) {
    throw new Error(`Collection ${env.knowledgeCollection} masih kosong.`);
  }

  const pending = docs.filter((doc) => !hasCurrentEmbedding(doc));
  console.log(`Jumlah knowledge          : ${docs.length}`);
  console.log(`Sudah punya embedding     : ${docs.length - pending.length}`);
  console.log(`Perlu dibuat/update vector: ${pending.length}`);
  console.log(`Model                     : ${env.embeddingModel}`);
  console.log(`Dimensi                   : ${env.embeddingDimensions}`);
  console.log(`Embedding profile          : ${env.embeddingProfile}`);

  if (!pending.length) {
    await ensureVectorSearchIndex();
    console.log("Tidak ada embedding yang perlu diperbarui.");
    return;
  }

  const batchSize = Math.max(1, env.embeddingBatchSize);
  let processed = 0;

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const texts = batch.map(articleEmbeddingText);
    const vectors = await embedDocuments(texts);
    const now = new Date();

    const operations = batch.map((doc, index) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            [env.vectorField]: vectors[index],
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
    console.log(`Embedding progress: ${processed}/${pending.length}`);
  }

  const indexResult = await ensureVectorSearchIndex();
  console.log("Embedding knowledge selesai.");
  console.log(`Vector field : ${env.vectorField}`);
  console.log(`Vector index : ${env.vectorIndexName}`);
  console.log(`Index status : ${indexResult.reason || (indexResult.created ? "created" : "ok")}`);
  console.log("Jika index baru dibuat, tunggu sampai status READY di Atlas sebelum test vector search.");
}

main()
  .catch((error) => {
    console.error("Pembuatan embedding gagal:", error);
    process.exitCode = 1;
  })
  .finally(closeMongo);
