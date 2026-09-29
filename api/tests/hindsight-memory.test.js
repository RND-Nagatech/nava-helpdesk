import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHindsightCaseContent,
  formatHindsightRecall,
  hindsightBankId,
  redactSensitiveText,
} from "../src/services/hindsight-memory.js";

test("customer bank ID stabil dan tidak membocorkan customer ID", () => {
  const first = hindsightBankId("CUSTOMER-001");
  assert.equal(first, hindsightBankId("CUSTOMER-001"));
  assert.match(first, /^nava-customer-[a-f0-9]{32}$/);
  assert.doesNotMatch(first, /CUSTOMER-001/);
});

test("recall Hindsight diformat sebagai konteks historis, bukan knowledge resmi", () => {
  const result = formatHindsightRecall({
    results: [{
      id: "fact-1",
      type: "experience",
      occurred_start: "2026-09-20T09:00:00Z",
      text: "Customer sudah mencoba restart aplikasi.",
    }],
  });

  assert.equal(result.items, 1);
  assert.deepEqual(result.factIds, ["fact-1"]);
  assert.match(result.text, /MEMORI HINDSIGHT CUSTOMER/i);
  assert.match(result.text, /konteks historis/i);
  assert.match(result.text, /restart aplikasi/i);
  assert.match(result.text, /knowledge resmi/i);
});

test("retain content membawa kasus grounded dan sumber knowledge", () => {
  const content = buildHindsightCaseContent({
    question: "Struk tidak keluar",
    answer: "Periksa popup browser.",
    runtimeMeta: {
      primary_article_id: "KB-001",
      primary_article_title: "Struk penjualan tidak keluar",
      evidence_strength: "strong",
    },
  });

  assert.match(content, /grounded_answer/);
  assert.match(content, /Struk tidak keluar/);
  assert.match(content, /KB-001/);
  assert.match(content, /Struk penjualan tidak keluar/);
});

test("payload memory meredaksi credential yang tertulis di chat", () => {
  const safe = redactSensitiveText("password=SuperRahasia123 dan api_key: sk-123456789012345", 500);
  assert.doesNotMatch(safe, /SuperRahasia123/);
  assert.doesNotMatch(safe, /sk-123456789012345/);
  assert.match(safe, /REDACTED/i);
});
