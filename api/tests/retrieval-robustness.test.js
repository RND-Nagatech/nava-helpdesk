import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  lexicalScore,
  mergeSearchQuery,
  problemMatchScore,
  stemIndonesianToken,
} from "../src/utils/text.js";

const raw = JSON.parse(fs.readFileSync(new URL("../data/nava-knowledge.json", import.meta.url), "utf8"));
const knowledge = Array.isArray(raw) ? raw : raw.articles || [];

function rank(query, limit = 10) {
  return knowledge
    .map((doc) => ({
      ...doc,
      lexical: lexicalScore(query, doc),
      problem: problemMatchScore(query, doc),
    }))
    .filter((doc) => doc.lexical.score > 0 || doc.problem.score > 0)
    .sort((a, b) =>
      b.problem.distinctiveCoverage - a.problem.distinctiveCoverage ||
      b.problem.titleDistinctiveCoverage - a.problem.titleDistinctiveCoverage ||
      b.problem.coverage - a.problem.coverage ||
      b.lexical.coverage - a.lexical.coverage ||
      b.problem.score - a.problem.score ||
      b.lexical.score - a.lexical.score
    )
    .slice(0, limit);
}

test("normalisasi morfologi Indonesia menyatukan variasi kata umum", () => {
  assert.equal(stemIndonesianToken("batal"), "batal");
  assert.equal(stemIndonesianToken("membatalkan"), "batal");
  assert.equal(stemIndonesianToken("dibatalkan"), "batal");
  assert.equal(stemIndonesianToken("pembatalan"), "batal");
});

test("query natural batal titipan memprioritaskan artikel Batal Titipan", () => {
  const result = rank("gimana cara batal titipan", 5);
  assert.equal(result[0]?.title, "Bagaimana cara melakukan Batal Titipan?");
  assert.equal(result[0]?.problem.distinctiveCoverage, 1);
});

test("parafrase membatalkan transaksi titipan tetap memprioritaskan artikel Batal Titipan", () => {
  const result = rank("cara membatalkan transaksi titipan", 5);
  assert.equal(result[0]?.title, "Bagaimana cara melakukan Batal Titipan?");
  assert.equal(result[0]?.problem.distinctiveCoverage, 1);
});

test("istilah pembeda detail mengalahkan artikel laporan barang lain yang hanya cocok kata generik", () => {
  const result = rank("laporan barang detail fungsi dan kegunaan menu", 10);
  assert.match(result[0]?.title || "", /Laporan Barang Detail/i);
  const wrong = result.find((doc) => /Laporan Barang Tukar/i.test(doc.title || ""));
  if (wrong) {
    assert.ok(result[0].problem.distinctiveCoverage > wrong.problem.distinctiveCoverage);
  }
});

test("merge search query mempertahankan discriminator customer yang dibuang oleh rewrite", () => {
  const merged = mergeSearchQuery(
    "cara membatalkan transaksi",
    "gimana cara batal titipan"
  );
  assert.match(merged, /titipan/i);
});

test("search kedua tidak lagi dikunci oleh blocked_reuse_primary", () => {
  const source = fs.readFileSync(new URL("../src/tools/helpdesk-tools.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /blocked_reuse_primary/);
  assert.match(source, /bestSearchResult/);
  assert.match(source, /reused_same_query/);
});

import { selectRelevantLongTermCases } from "../src/services/customer-memory.js";

test("long-term memory tidak memasukkan kasus lama yang tidak relevan", () => {
  const memory = {
    recent_cases: [
      {
        question: "berat dari timbangan tidak muncul",
        primary_article_title: "Tambah barang dan timbang baki tidak konek timbangan",
        answer_excerpt: "Jalankan aplikasi Timbangan.",
      },
      {
        question: "struk penjualan tidak keluar",
        primary_article_title: "Tidak keluar file download nota penjualan atau pembelian",
        answer_excerpt: "Periksa popup Chrome.",
      },
      {
        question: "cara batal titipan",
        primary_article_title: "Bagaimana cara melakukan Batal Titipan?",
        answer_excerpt: "Buka Lihat Titipan lalu pilih Batal Titipan.",
      },
    ],
  };

  const relevant = selectRelevantLongTermCases(memory, "pembatalan titipan saya masih bermasalah");
  assert.equal(relevant.length, 1);
  assert.match(relevant[0].primary_article_title, /Batal Titipan/i);
});

test("long-term memory lama tidak disuntikkan bila pertanyaan baru tidak berhubungan", () => {
  const memory = {
    recent_cases: [
      {
        question: "berat timbangan tidak muncul",
        primary_article_title: "Timbangan tidak konek",
      },
      {
        question: "struk penjualan tidak keluar",
        primary_article_title: "Nota penjualan tidak keluar",
      },
    ],
  };

  const relevant = selectRelevantLongTermCases(memory, "bagaimana cara batal titipan");
  assert.deepEqual(relevant, []);
});
