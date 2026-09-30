import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt } from "../src/agents/agent-prompt.js";
import { __layaInternals, parseLayaDecision } from "../src/services/laya-decision.js";

test("parses Laya choice and noul answers into a safe triage hint", () => {
  const decision = parseLayaDecision({
    model: "multilingual",
    answers: {
      support_area: { choice: "inventory_weight" },
      report_type: { choice: "other" },
      is_urgent: { noul: false },
    },
  });

  assert.deepEqual(decision, {
    enabled: true,
    source: "laya",
    area: "inventory_weight",
    reportType: "other",
    urgent: false,
    model: "multilingual",
  });
});

test("rejects unknown Laya choices instead of trusting arbitrary labels", () => {
  const decision = parseLayaDecision({
    answers: {
      support_area: { choice: "make_up_a_new_area" },
      is_urgent: { noul: "unknown" },
    },
  });

  assert.equal(decision, null);
  assert.equal(__layaInternals.normalizeChoice("inventory-weight"), "inventory_weight");
  assert.equal(__layaInternals.normalizeReportType("sales-report"), "sales_report");
  assert.equal(__layaInternals.normalizeReportType("unknown-report"), null);
  assert.equal(__layaInternals.normalizeNoul("ya"), true);
  assert.equal(__layaInternals.normalizeNoul(0.75), true);
  assert.equal(__layaInternals.normalizeNoul(0.25), false);
});

test("keeps the Laya hint internal and preserves knowledge grounding", () => {
  const prompt = buildAgentPrompt({
    layaDecision: {
      source: "laya",
      area: "inventory_weight",
      reportType: null,
      urgent: false,
    },
  });

  assert.match(prompt, /SYSTEM-1 TRIAGE HINT \(LAYA\)/);
  assert.match(prompt, /Tetap gunakan search_knowledge/);
  assert.match(prompt, /Jangan menyebut Laya/);
});

test("parses report type independently and keeps it bounded to known labels", () => {
  const decision = parseLayaDecision({
    answers: {
      support_area: { choice: "reports" },
      report_type: { choice: "sales_report" },
      is_urgent: { noul: false },
    },
  });

  assert.equal(decision.area, "reports");
  assert.equal(decision.reportType, "sales_report");
});

test("prioritizes sold-item intent over a comparison report name", () => {
  const decision = parseLayaDecision({
    answers: {
      support_area: { choice: "reports" },
      report_type: { choice: "item_detail_report" },
      report_sold_items: { noul: true },
      is_urgent: { noul: false },
    },
  });

  assert.equal(decision.reportType, "sales_report");
});

test("prompt tells the agent to use report type only as a retrieval hint", () => {
  const prompt = buildAgentPrompt({
    layaDecision: {
      source: "laya",
      area: "reports",
      reportType: "sales_report",
      urgent: false,
    },
  });

  assert.match(prompt, /Jenis laporan yang relevan: sales_report/);
  assert.match(prompt, /gunakan label tersebut untuk mempersempit query search_knowledge/);
  assert.match(prompt, /bukan berdasarkan label Laya saja/);
});
