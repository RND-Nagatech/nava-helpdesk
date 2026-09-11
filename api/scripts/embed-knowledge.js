import "dotenv/config";
import { env } from "../src/config/env.js";
import { connectMongo, ensureIndexes, closeMongo } from "../src/database/mongodb.js";
import { refreshKnowledgeEmbeddings } from "../src/services/knowledge-vector-sync.js";

const force = process.argv.includes("--force");

async function main() {
  if (!env.mongodbUri) throw new Error("MONGODB_URI belum diisi di .env");
  if (!env.vectorSearchEnabled) throw new Error("VECTOR_SEARCH_ENABLED=false. Aktifkan terlebih dahulu.");

  await connectMongo();
  await ensureIndexes();
  const result = await refreshKnowledgeEmbeddings({ force });
  console.log(`Jumlah knowledge          : ${result.total}`);
  console.log(`Perlu dibuat/update vector: ${result.pending}`);
  console.log(`Model                     : ${env.embeddingModel}`);
  console.log(`Dimensi                   : ${env.embeddingDimensions}`);
  console.log(`Embedding profile          : ${env.embeddingProfile}`);
  console.log("Embedding knowledge selesai.");
  console.log(`Vector field : ${env.vectorField}`);
  console.log(`Qdrant collection : ${env.qdrantCollection}`);
  console.log(`Qdrant status : upserted=${result.upserted}, deleted=${result.deleted}`);
}

main()
  .catch((error) => {
    console.error("Pembuatan embedding gagal:", error);
    process.exitCode = 1;
  })
  .finally(closeMongo);
