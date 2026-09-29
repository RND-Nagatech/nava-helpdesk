import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt } from "../src/agents/agent-prompt.js";
import { lexicalScore } from "../src/utils/text.js";

const receiptArticle = {
  title: "Tidak keluar file download nota penjualan atau pembelian",
  category: "penjualan",
  symptoms: ["Tidak keluar file download nota penjualan atau pembelian"],
  tags: ["penjualan", "tidak", "keluar", "file", "download", "nota"],
  userResponseTemplate: "Allow popup di Google Chrome lalu coba print kembali.",
  troubleshootingSteps: [{ instruction: "Pilih Always Allow popup." }],
};

test("identitas NAVA adalah Nagatech Virtual Assistant, bukan nama program customer", () => {
  const prompt = buildAgentPrompt();
  assert.match(prompt, /Nagatech Virtual Assistant/i);
  assert.match(prompt, /NAVA adalah nama asistennya, bukan nama program customer/i);
  assert.match(prompt, /AI Helpdesk milik Nagatech/i);
  assert.match(prompt, /JANGAN menanyakan customer menggunakan program apa/i);
  assert.match(prompt, /SEARCH FIRST, ANSWER FIRST, CLARIFY ONLY IF NEEDED/i);
});

test("prompt mengarahkan jawaban to the point tanpa keyword router", () => {
  const prompt = buildAgentPrompt();
  assert.match(prompt, /TO THE POINT/i);
  assert.match(prompt, /jangan membuka dengan banyak pertanyaan tambahan/i);
  assert.match(prompt, /JANGAN menyebut nama program dari metadata knowledge/i);
  assert.match(prompt, /berdasarkan knowledge yang tersedia/i);
  assert.match(prompt, /parafrase GEJALA/i);
  assert.match(prompt, /jangan memasukkan dugaan penyebab/i);
});

test("prompt investigasi memaksa format temuan yang ringkas dan berbasis evidence", () => {
  const prompt = buildAgentPrompt({ investigationMode: true });
  assert.match(prompt, /## TEMUAN/);
  assert.match(prompt, /## EVIDENCE/);
  assert.match(prompt, /## KEMUNGKINAN PENYEBAB/);
  assert.match(prompt, /## SARAN PERBAIKAN/);
  assert.match(prompt, /expected hanya boleh ditulis jika diberikan tool sebagai correction_candidate/i);
  assert.match(prompt, /tidak diawali pembukaan panjang/i);
  assert.match(prompt, /Referensi tanggal server Jakarta saat ini/i);
  assert.match(prompt, /"hari ini"/i);
  assert.match(prompt, /format YYYY-MM-DD/i);
});

test("fallback lexical memahami struk tidak muncul sebagai nota tidak keluar", () => {
  const result = lexicalScore(
    "aku udh beres penjualan kenapa struknya gak muncul ya",
    receiptArticle
  );
  assert.ok(result.score > 0);
  assert.ok(result.matchedTokens.includes("penjualan"));
  assert.ok(result.matchedTokens.includes("struk"));
  assert.ok(result.coverage >= 0.5);
});
