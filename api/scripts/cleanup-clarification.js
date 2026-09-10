import "dotenv/config";
import { env } from "../src/config/env.js";
import { connectMongo, closeMongo } from "../src/database/mongodb.js";
import { articleSearchText } from "../src/utils/text.js";

async function main() {
  if (!env.mongodbUri) throw new Error("MONGODB_URI belum diisi di .env");

  const db = await connectMongo();
  const collection = db.collection(env.knowledgeCollection);
  const cursor = collection.find({}, {
    projection: {
      articleId: 1, title: 1, category: 1, product: 1, symptoms: 1, tags: 1,
      userResponseTemplate: 1, troubleshootingSteps: 1, clarificationQuestions: 1,
    },
  });

  let scanned = 0;
  let cleaned = 0;
  const batch = [];

  for await (const article of cursor) {
    scanned += 1;
    const hadClarification = Array.isArray(article.clarificationQuestions) || Object.hasOwn(article, "clarificationQuestions");
    const searchText = articleSearchText(article);

    batch.push({
      updateOne: {
        filter: { _id: article._id },
        update: {
          $set: { search_text: searchText, updated_at: new Date() },
          $unset: { clarificationQuestions: "" },
        },
      },
    });

    if (hadClarification) cleaned += 1;

    if (batch.length >= 500) {
      await collection.bulkWrite(batch, { ordered: false });
      batch.length = 0;
    }
  }

  if (batch.length) await collection.bulkWrite(batch, { ordered: false });

  console.log("Cleanup clarification selesai.");
  console.log(`Dokumen diperiksa : ${scanned}`);
  console.log(`Field dibersihkan : ${cleaned}`);
  console.log(`Collection        : ${env.knowledgeCollection}`);
  console.log("Embedding tidak perlu dibuat ulang hanya karena cleanup ini, karena profile problem-v2 tidak menggunakan clarificationQuestions.");
}

main()
  .catch((error) => {
    console.error("Cleanup gagal:", error);
    process.exitCode = 1;
  })
  .finally(closeMongo);
