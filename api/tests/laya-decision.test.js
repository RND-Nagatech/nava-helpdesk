import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt } from "../src/agents/agent-prompt.js";
import { __layaInternals, parseLayaDecision } from "../src/services/laya-decision.js";

test("parses Laya choice and noul answers into a safe triage hint", () => {
  const decision = parseLayaDecision({
    model: "multilingual",
    answers: {
      support_area: { choice: "inventory_weight" },
      is_urgent: { noul: false },
    },
  });

  assert.deepEqual(decision, {
    enabled: true,
    source: "laya",
    area: "inventory_weight",
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
  assert.equal(__layaInternals.normalizeNoul("ya"), true);
  assert.equal(__layaInternals.normalizeNoul(0.75), true);
  assert.equal(__layaInternals.normalizeNoul(0.25), false);
});

test("keeps the Laya hint internal and preserves knowledge grounding", () => {
  const prompt = buildAgentPrompt({
    layaDecision: {
      source: "laya",
      area: "inventory_weight",
      urgent: false,
    },
  });

  assert.match(prompt, /SYSTEM-1 TRIAGE HINT \(LAYA\)/);
  assert.match(prompt, /Tetap gunakan search_knowledge/);
  assert.match(prompt, /Jangan menyebut Laya/);
});
