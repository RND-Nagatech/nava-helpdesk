import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { env } from "../src/config/env.js";
import { connectMongo, ensureIndexes, closeMongo } from "../src/database/mongodb.js";
import { normalizeKnowledgeArticleInput } from "../src/services/knowledge-article-service.js";
import { refreshKnowledgeEmbeddings } from "../src/services/knowledge-vector-sync.js";
import { articleSearchText } from "../src/utils/text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultFile = path.resolve(__dirname, "../data/nava-knowledge.json");
const inputFile = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const filePath = path.resolve(inputFile || defaultFile);
const publishImportedKnowledge = process.argv.includes("--publish");

async function main() {
  if (!env.mongodbUri) throw new Error("MONGODB_URI belum diisi di .env");

  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const articles = Array.isArray(parsed) ? parsed : parsed.articles;

  if (!Array.isArray(articles) || !articles.length) {
    throw new Error("File knowledge tidak memiliki array articles yang valid.");
  }

  const db = await connectMongo();
  const collection = db.collection(env.knowledgeCollection);
  const now = new Date();

  const operations = articles.map((article) => {
    // Backward-compatible: walaupun file lama masih memiliki clarificationQuestions,
    // field tersebut tidak ikut ditulis lagi ke MongoDB.
    const { clarificationQuestions: _legacyClarificationQuestions, ...cleanArticle } = article;
    const hasExplicitStatus = Object.prototype.hasOwnProperty.call(cleanArticle, "status");
    const status = publishImportedKnowledge
      ? "published"
      : hasExplicitStatus
        ? cleanArticle.status
        : "published";
    const normalizedArticle = normalizeKnowledgeArticleInput(cleanArticle, { status });
    const publishedAt = normalizedArticle.status === "published"
      ? cleanArticle.published_at || cleanArticle.publishedAt || now
      : null;

    return {
      updateOne: {
        filter: { articleId: normalizedArticle.articleId },
        update: {
          $set: {
            ...normalizedArticle,
            ...(publishedAt ? { published_at: publishedAt } : {}),
            search_text: articleSearchText(normalizedArticle),
            updated_at: now,
          },
        $setOnInsert: { created_at: now },
        // Isi knowledge berubah berarti vector lama harus dibuat ulang.
        // refreshKnowledgeEmbeddings dijalankan setelah bulkWrite selesai.
        $unset: {
          // clarificationQuestions versi lama adalah template generik dan tidak lagi dipakai.
          // $set tidak menghapus field lama yang tidak ada di JSON, jadi harus di-unset eksplisit.
          clarificationQuestions: "",
          [env.vectorField]: "",
          embedding_model: "",
          embedding_profile: "",
          embedding_dimensions: "",
          embedding_updated_at: "",
          },
        },
        upsert: true,
      },
    };
  });

  const result = await collection.bulkWrite(operations, { ordered: false });
  await ensureIndexes();
  const vectorResult = await refreshKnowledgeEmbeddings();

  console.log("Import knowledge selesai.");
  console.log(`File            : ${filePath}`);
  console.log(`Jumlah artikel  : ${articles.length}`);
  console.log(`Inserted/upsert : ${result.upsertedCount}`);
  console.log(`Modified        : ${result.modifiedCount}`);
  console.log(`Matched         : ${result.matchedCount}`);
  console.log(`Collection      : ${env.knowledgeCollection}`);
  console.log(`Embedding       : diproses ${vectorResult.processed} dari ${vectorResult.total}`);
  console.log(`Qdrant          : upserted=${vectorResult.upserted}, deleted=${vectorResult.deleted}`);
}

main()
  .catch((error) => {
    console.error("Import gagal:", error);
    process.exitCode = 1;
  })
  .finally(closeMongo);
