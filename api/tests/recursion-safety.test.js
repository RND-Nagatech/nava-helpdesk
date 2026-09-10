import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { effectiveRecursionLimit, fallbackFromSearchState, isGraphRecursionError } from "../src/services/agent-limit-safety.js";

const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const promptSource = fs.readFileSync(new URL("../src/agents/agent-prompt.js", import.meta.url), "utf8");
const agentSource = fs.readFileSync(new URL("../src/agents/helpdesk-agent.js", import.meta.url), "utf8");

test("default budget v2.4.2 tetap diselaraskan", () => {
  assert.match(envExample, /AGENT_RECURSION_LIMIT=20/);
  assert.match(envExample, /MODEL_CALL_RUN_LIMIT=4/);
  assert.match(envExample, /SEARCH_TOOL_CALL_LIMIT=2/);
  assert.equal(effectiveRecursionLimit(10, 4), 20);
  assert.equal(effectiveRecursionLimit(24, 4), 24);
});

test("prompt melarang search ulang setelah search limit tercapai", () => {
  assert.match(promptSource, /search_limit_reached/);
  assert.match(promptSource, /JANGAN panggil search_knowledge lagi/);
});

test("GraphRecursionError dikenali dan memiliki fallback", () => {
  assert.equal(isGraphRecursionError({ lc_error_code: "GRAPH_RECURSION_LIMIT" }), true);
  assert.match(agentSource, /fallbackFromSearchState/);
  assert.match(agentSource, /recursion_fallback/);
});

test("fallback strong evidence memakai primary knowledge", () => {
  const fallback = fallbackFromSearchState({
    firstSearchResult: {
      found: true,
      query: "struk tidak keluar",
      confidence: 0.94,
      retrievalMode: "hybrid-vector+lexical",
      primaryEvidence: { strength: "strong" },
      vector: { enabled: true, ok: true },
      timing: { total_ms: 50 },
      documents: [
        {
          articleId: "A1",
          title: "Tidak keluar file download nota penjualan",
          category: "penjualan",
          userResponseTemplate: "Coba izinkan popup Chrome terlebih dahulu.",
          troubleshootingSteps: [
            { instruction: "Pilih Always allow pop-ups." },
            { instruction: "Coba cetak transaksi lagi." },
          ],
          retrieval: { evidenceStrength: "strong" },
        },
      ],
    },
  });

  assert.equal(fallback.mode, "primary_evidence");
  assert.match(fallback.answer, /popup Chrome/);
  assert.match(fallback.answer, /Always allow pop-ups/);
  assert.equal(fallback.searches[0].primary_article.article_id, "A1");
});
