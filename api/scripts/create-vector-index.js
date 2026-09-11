import "dotenv/config";
import { env } from "../src/config/env.js";
import { connectMongo, ensureIndexes, closeMongo } from "../src/database/mongodb.js";
import { syncKnowledgeVectors } from "../src/database/qdrant.js";

const PROJECTION = {
  articleId: 1,
  status: 1,
  embedding: 1,
  embedding_model: 1,
  embedding_profile: 1,
};

async function main() {
  if (!env.mongodbUri) throw new Error("MONGODB_URI belum diisi di .env");
  const db = await connectMongo();
  await ensureIndexes();
  const docs = await db.collection(env.knowledgeCollection).find({}, { projection: PROJECTION }).toArray();
  const result = await syncKnowledgeVectors(docs);
  console.log("Qdrant vector index:", result);
}

main()
  .catch((error) => {
    console.error("Gagal membuat vector index:", error);
    process.exitCode = 1;
  })
  .finally(closeMongo);
