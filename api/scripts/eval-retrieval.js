import fs from "node:fs/promises";
import { retrieveKnowledge } from "../src/services/knowledge-retriever.js";
import { closeMongo } from "../src/database/mongodb.js";

const datasetUrl = new URL("../tests/evaluation/nava-helpdesk.dataset.json", import.meta.url);

async function main() {
  const dataset = JSON.parse(await fs.readFile(datasetUrl, "utf8"));
  let correct = 0;

  for (const item of dataset) {
    const result = await retrieveKnowledge(item.question, { topK: 5 });
    const top = result.documents?.[0] || result.candidates?.[0] || null;
    const ok = Boolean(top?.title?.toLowerCase().includes(item.expected_title_contains.toLowerCase()));
    if (ok) correct += 1;
    console.log(`${ok ? "PASS" : "FAIL"} | ${item.question}`);
    console.log(`  expected: ${item.expected_title_contains}`);
    console.log(`  actual  : ${top?.title || "(tidak ditemukan)"}`);
  }

  console.log(`\nTop-1 retrieval accuracy: ${correct}/${dataset.length} (${((correct / dataset.length) * 100).toFixed(1)}%)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo().catch(() => {});
  });
