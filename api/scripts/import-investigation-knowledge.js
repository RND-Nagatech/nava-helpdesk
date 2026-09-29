import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { env } from "../src/config/env.js";
import { connectMongo, ensureIndexes, closeMongo } from "../src/database/mongodb.js";
import { __investigationKnowledgeInternals } from "../src/services/investigation-knowledge-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultFile = path.resolve(__dirname, "../data/investigation-knowledge.json");
const inputFile = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const filePath = path.resolve(inputFile || defaultFile);
const publishImportedKnowledge = process.argv.includes("--publish");

async function main() {
  if (!env.mongodbUri) throw new Error("MONGODB_URI belum diisi di .env");
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  const articles = Array.isArray(parsed) ? parsed : parsed.articles;
  if (!Array.isArray(articles) || !articles.length) throw new Error("File knowledge investigasi tidak memiliki array yang valid.");

  const db = await connectMongo();
  const collection = db.collection(env.investigationKnowledgeCollection);
  const now = new Date();
  const operations = articles.map((input) => {
    const status = publishImportedKnowledge ? "published" : (input.status || "draft");
    const article = __investigationKnowledgeInternals.normalizeInput(input, { status });
    return {
      updateOne: {
        filter: { articleId: article.articleId },
        update: {
          $set: {
            ...article,
            updated_at: now,
            ...(article.status === "published" ? { published_at: input.published_at || now } : {}),
          },
          $setOnInsert: { created_at: now },
        },
        upsert: true,
      },
    };
  });

  const result = await collection.bulkWrite(operations, { ordered: false });
  await ensureIndexes();
  console.log("Import knowledge investigasi selesai.");
  console.log(`File            : ${filePath}`);
  console.log(`Jumlah artikel  : ${articles.length}`);
  console.log(`Inserted/upsert : ${result.upsertedCount}`);
  console.log(`Modified        : ${result.modifiedCount}`);
  console.log(`Collection      : ${env.investigationKnowledgeCollection}`);
}

main()
  .catch((error) => {
    console.error("Import knowledge investigasi gagal:", error);
    process.exitCode = 1;
  })
  .finally(closeMongo);
