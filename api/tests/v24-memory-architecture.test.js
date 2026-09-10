import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const agentSource = fs.readFileSync(new URL("../src/agents/helpdesk-agent.js", import.meta.url), "utf8");
const controllerSource = fs.readFileSync(new URL("../src/controllers/chat-controller.js", import.meta.url), "utf8");
const promptSource = fs.readFileSync(new URL("../src/agents/agent-prompt.js", import.meta.url), "utf8");
const memorySource = fs.readFileSync(new URL("../src/services/agent-memory.js", import.meta.url), "utf8");
const customerMemorySource = fs.readFileSync(new URL("../src/services/customer-memory.js", import.meta.url), "utf8");

test("v2.4 memakai MongoDBSaver dan MongoDBStore", () => {
  assert.match(memorySource, /MongoDBSaver/);
  assert.match(memorySource, /MongoDBStore/);
  assert.match(agentSource, /checkpointer:/);
  assert.match(agentSource, /store:/);
});

test("summarization adaptif dan model call limit aktif tanpa forced structured output", () => {
  assert.match(agentSource, /summarizationMiddleware/);
  assert.match(agentSource, /modelCallLimitMiddleware/);
  assert.match(agentSource, /SUMMARIZATION|summarizationTriggerMessages/);
  assert.doesNotMatch(agentSource, /toolStrategy/);
  assert.doesNotMatch(agentSource, /responseFormat\s*:/);
});

test("main agent tetap singleton dan active history tidak dibaca manual", () => {
  assert.match(agentSource, /let agent;/);
  assert.match(agentSource, /function getAgent\(\)/);
  assert.doesNotMatch(controllerSource, /getChatHistory/);
});

test("first turn selalu meminta identitas NAVA tanpa regex sapaan", () => {
  assert.match(promptSource, /FIRST TURN/);
  assert.match(promptSource, /NAVA, AI Helpdesk Nagatech \(Nagatech Virtual Assistant\)/);
  assert.doesNotMatch(agentSource, /halo\|hai\|hello\|hi/);
});

test("long-term memory hanya menyimpan kasus grounded atau eskalasi", () => {
  assert.match(customerMemorySource, /primary_article_id/);
  assert.match(customerMemorySource, /if \(!runtimeMeta\?\.primary_article_id && !escalation\) return false/);
});
