import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { articleSearchText } from "../src/utils/text.js";
import { fallbackFromSearchState } from "../src/services/agent-limit-safety.js";

const promptSource = fs.readFileSync(new URL("../src/agents/agent-prompt.js", import.meta.url), "utf8");
const toolSource = fs.readFileSync(new URL("../src/tools/helpdesk-tools.js", import.meta.url), "utf8");
const retrieverSource = fs.readFileSync(new URL("../src/services/knowledge-retriever.js", import.meta.url), "utf8");
const importerSource = fs.readFileSync(new URL("../scripts/import-knowledge.js", import.meta.url), "utf8");
const bundledKnowledge = JSON.parse(fs.readFileSync(new URL("../data/nava-knowledge.json", import.meta.url), "utf8"));

test("DeepSeek membuat klarifikasi sendiri berdasarkan konteks", () => {
  assert.match(promptSource, /BUAT SENDIRI satu pertanyaan/i);
  assert.match(promptSource, /pesan customer \+ konteks percakapan/i);
  assert.match(promptSource, /Jangan otomatis bertanya tentang error, perangkat/i);
});

test("retrieval tidak lagi mengirim clarificationQuestions ke LLM", () => {
  assert.doesNotMatch(toolSource, /clarification_questions/);
  assert.doesNotMatch(retrieverSource, /clarificationQuestions:\s*1/);
  assert.doesNotMatch(retrieverSource, /Pertanyaan klarifikasi:/);
});

test("search_text tidak memasukkan clarificationQuestions lama", () => {
  const article = {
    title: "Cara melihat laporan margin",
    category: "penjualan",
    symptoms: ["ingin melihat keuntungan penjualan"],
    tags: ["margin"],
    clarificationQuestions: ["Error atau kendala apa yang muncul di layar?"],
    userResponseTemplate: "Buka laporan margin.",
    troubleshootingSteps: [{ instruction: "Pilih tanggal." }],
  };
  const text = articleSearchText(article);
  assert.match(text, /laporan margin/i);
  assert.doesNotMatch(text, /Error atau kendala apa yang muncul/i);
});

test("importer membuang field clarification lama dan meng-unset MongoDB", () => {
  assert.match(importerSource, /clarificationQuestions: _legacyClarificationQuestions/);
  assert.match(importerSource, /clarificationQuestions: ""/);
});

test("bundled knowledge 575 artikel tidak memiliki clarificationQuestions", () => {
  const articles = Array.isArray(bundledKnowledge) ? bundledKnowledge : bundledKnowledge.articles;
  assert.equal(articles.length, 575);
  assert.equal(articles.filter((article) => Object.hasOwn(article, "clarificationQuestions")).length, 0);
});

test("recursion fallback tidak mengambil canned clarification dari knowledge", () => {
  const fallback = fallbackFromSearchState({
    firstSearchResult: {
      found: true,
      query: "laporan margin",
      confidence: 0.6,
      primaryEvidence: { strength: "medium" },
      vector: { enabled: true, ok: true },
      documents: [{
        articleId: "A2",
        title: "Laporan Penjualan Margin",
        category: "penjualan",
        clarificationQuestions: ["Error atau kendala apa yang muncul di layar?"],
        retrieval: { evidenceStrength: "medium" },
      }],
    },
  });
  assert.equal(fallback.mode, "clarification");
  assert.doesNotMatch(fallback.answer, /Error atau kendala apa yang muncul/i);
});
