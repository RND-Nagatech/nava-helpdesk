import "dotenv/config";
import { env } from "../src/config/env.js";
import { connectMongo, ensureVectorSearchIndex, closeMongo } from "../src/database/mongodb.js";

async function main() {
  if (!env.mongodbUri) throw new Error("MONGODB_URI belum diisi di .env");
  await connectMongo();
  const result = await ensureVectorSearchIndex();
  console.log("Vector index:", result);
}

main()
  .catch((error) => {
    console.error("Gagal membuat vector index:", error);
    process.exitCode = 1;
  })
  .finally(closeMongo);
