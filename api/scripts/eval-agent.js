import fs from "node:fs/promises";
import crypto from "node:crypto";
import { connectMongo, closeMongo, ensureIndexes } from "../src/database/mongodb.js";
import { initializeAgentMemory, deleteAgentThread } from "../src/services/agent-memory.js";
import { initializeHelpdeskAgent, runHelpdeskAgent } from "../src/agents/helpdesk-agent.js";
import { warmupEmbeddingModel } from "../src/services/embedding-service.js";

const datasetUrl = new URL("../tests/evaluation/nava-helpdesk.dataset.json", import.meta.url);

async function main() {
  const dataset = JSON.parse(await fs.readFile(datasetUrl, "utf8"));
  await connectMongo();
  await ensureIndexes();
  await initializeAgentMemory();
  initializeHelpdeskAgent();
  await warmupEmbeddingModel();

  const stats = {
    total: dataset.length,
    primaryCorrect: 0,
    toolCorrect: 0,
    escalationCorrect: 0,
    grounded: 0,
    totalToolCalls: 0,
    totalModelCalls: 0,
    totalLatency: 0,
  };

  for (const [index, item] of dataset.entries()) {
    const sessionId = `eval-${Date.now()}-${index}-${crypto.randomUUID().slice(0, 8)}`;
    const expectedTool = item.expected_tool || "search_knowledge";
    const shouldEscalate = Boolean(item.should_escalate);

    const result = await runHelpdeskAgent({
      sessionId,
      customerId: `eval-customer-${index}`,
      question: item.question,
      isFirstTurn: false,
      memoryContext: { text: "", source: "none", items: 0 },
    });

    const top = result.searches.find((search) => search.primary_article)?.primary_article || null;
    const primaryOk = item.expected_title_contains
      ? Boolean(top?.title?.toLowerCase().includes(item.expected_title_contains.toLowerCase()))
      : true;
    const toolOk = result.toolTrace.some((tool) => tool.name === expectedTool);
    const escalationOk = Boolean(result.escalation) === shouldEscalate;
    const groundedOk = !result.runtimeMeta.used_knowledge || Boolean(result.runtimeMeta.primary_article_id);

    if (primaryOk) stats.primaryCorrect += 1;
    if (toolOk) stats.toolCorrect += 1;
    if (escalationOk) stats.escalationCorrect += 1;
    if (groundedOk) stats.grounded += 1;
    stats.totalToolCalls += result.toolCallCount;
    stats.totalModelCalls += result.modelCallCount;
    stats.totalLatency += result.latencyMs;

    console.log(`${primaryOk && toolOk && escalationOk ? "PASS" : "FAIL"} | ${item.question}`);
    console.log(`  primary : ${top?.title || "(none)"}`);
    console.log(`  tools   : ${result.toolTrace.map((tool) => tool.name).join(", ") || "(none)"}`);
    console.log(`  latency : ${result.latencyMs} ms | model calls: ${result.modelCallCount} | tool calls: ${result.toolCallCount}`);

    await deleteAgentThread(sessionId).catch(() => {});
  }

  const pct = (value) => `${((value / Math.max(1, stats.total)) * 100).toFixed(1)}%`;
  console.log("\n=== NAVA FULL AGENT EVALUATION ===");
  console.log(`Primary Evidence Accuracy : ${pct(stats.primaryCorrect)}`);
  console.log(`Tool Selection Accuracy   : ${pct(stats.toolCorrect)}`);
  console.log(`Escalation Accuracy       : ${pct(stats.escalationCorrect)}`);
  console.log(`Grounded Turn Rate        : ${pct(stats.grounded)}`);
  console.log(`Avg Tool Calls            : ${(stats.totalToolCalls / Math.max(1, stats.total)).toFixed(2)}`);
  console.log(`Avg Model Calls           : ${(stats.totalModelCalls / Math.max(1, stats.total)).toFixed(2)}`);
  console.log(`Avg Latency               : ${(stats.totalLatency / Math.max(1, stats.total)).toFixed(0)} ms`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo().catch(() => {});
  });
