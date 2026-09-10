import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/agents/helpdesk-agent.js", import.meta.url), "utf8");

test("runtime tidak memakai hard-coded smalltalk/intent classifier", () => {
  assert.doesNotMatch(source, /isPureSmalltalk/);
  assert.doesNotMatch(source, /halo\|hai\|hello\|hi/);
  assert.doesNotMatch(source, /message\.includes/);
});

test("main agent tidak memakai forced structured output", () => {
  assert.doesNotMatch(source, /toolStrategy/);
  assert.doesNotMatch(source, /responseFormat\s*:/);
});

test("agent menggunakan singleton dan state pencarian per-request lewat AsyncLocalStorage", () => {
  assert.match(source, /let agent;/);
  assert.match(source, /function getAgent\(\)/);
  assert.match(source, /agentRunContext\.run/);
  assert.doesNotMatch(source, /function createRunAgent/);
});


test("tool payload tidak mengekspos metadata product ke LLM dan evidence kuat tidak membawa kandidat ambigu", () => {
  const toolSource = fs.readFileSync(new URL("../src/tools/helpdesk-tools.js", import.meta.url), "utf8");
  assert.doesNotMatch(toolSource, /product:\s*doc\.product/);
  assert.match(toolSource, /const isStrongEvidence = evidenceStrength === "strong"/);
  assert.match(toolSource, /const supportingCandidates = isStrongEvidence\s*\? \[\]/);
  assert.doesNotMatch(toolSource, /clarification_questions/);
  assert.doesNotMatch(toolSource, /includeClarificationQuestions/);
});
