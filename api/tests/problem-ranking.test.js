import test from "node:test";
import assert from "node:assert/strict";
import { problemMatchScore, lexicalScore, articleEmbeddingText } from "../src/utils/text.js";
import { fuseHybridResults } from "../src/utils/hybrid.js";

const query = "struk nota penjualan tidak muncul setelah transaksi selesai";

const docs = {
  viewSales: {
    articleId: "VIEW",
    title: "Bagaimana tahapan untuk melihat penjualan pada Menu Transaksi Penjualan?",
    category: "penjualan",
    symptoms: ["Bagaimana tahapan untuk melihat penjualan pada Menu Transaksi Penjualan?"],
    tags: ["penjualan", "transaksi"],
    userResponseTemplate: "Untuk melihat penjualan buka menu transaksi.",
    troubleshootingSteps: [],
  },
  reportMissing: {
    articleId: "REPORT",
    title: "Saya sudah melakukan transaksi penjualan, tapi datanya tidak muncul di laporan",
    category: "penjualan",
    symptoms: ["Saya sudah melakukan transaksi penjualan, tapi datanya tidak muncul di laporan"],
    tags: ["penjualan", "laporan", "tidak", "muncul"],
    userResponseTemplate: "Cek laporan penjualan.",
    troubleshootingSteps: [],
  },
  receiptMissing: {
    articleId: "RECEIPT",
    title: "Tidak keluar file download nota penjualan atau pembelian",
    category: "penjualan",
    symptoms: ["Tidak keluar file download nota penjualan atau pembelian"],
    tags: ["penjualan", "tidak", "keluar", "file", "download", "nota"],
    userResponseTemplate: "Allow popup Chrome lalu print kembali.",
    troubleshootingSteps: [{ instruction: "Pilih Always Allow popup." }],
  },
  cancelSale: {
    articleId: "CANCEL",
    title: "Apa tahapan untuk melakukan pembatalan penjualan?",
    category: "penjualan",
    symptoms: ["Apa tahapan untuk melakukan pembatalan penjualan?"],
    tags: ["penjualan", "pembatalan"],
    userResponseTemplate: "Batalkan transaksi lalu cetak nota.",
    troubleshootingSteps: [{ instruction: "Setelah pembatalan, nota dapat dicetak." }],
  },
  afterPayment: {
    articleId: "PAYMENT",
    title: "Apa yang harus dilakukan setelah proses pembayaran transaksi penjualan selesai?",
    category: "penjualan",
    symptoms: ["Apa yang harus dilakukan setelah proses pembayaran transaksi penjualan selesai?"],
    tags: ["penjualan", "pembayaran", "transaksi"],
    userResponseTemplate: "Lakukan validasi transaksi.",
    troubleshootingSteps: [],
  },
};

function withSignals(doc) {
  return {
    ...doc,
    lexical: lexicalScore(query, doc),
    problem: problemMatchScore(query, doc),
  };
}

test("problem score memprioritaskan nota tidak keluar dibanding artikel prosedur penjualan lain", () => {
  const receipt = problemMatchScore(query, docs.receiptMissing);
  const cancel = problemMatchScore(query, docs.cancelSale);
  const view = problemMatchScore(query, docs.viewSales);

  assert.ok(receipt.coverage > cancel.coverage);
  assert.ok(receipt.coverage > view.coverage);
  assert.ok(receipt.score > cancel.score);
});

test("hybrid reranking menaikkan artikel nota tidak keluar pada ranking trace kasus nyata", () => {
  // Meniru ranking yang terlihat pada trace user: cancellation keyword rank 1,
  // receipt rank 3 / vector rank 8, report-missing vector rank 1.
  const filler = (id) => withSignals({ articleId: id, title: id, category: "", symptoms: [], tags: [], troubleshootingSteps: [] });
  const lexical = [
    withSignals(docs.cancelSale),
    withSignals(docs.viewSales),
    withSignals(docs.receiptMissing),
    filler("L4"), filler("L5"), filler("L6"), filler("L7"),
    withSignals(docs.reportMissing),
    withSignals(docs.afterPayment),
  ];
  const vectorBase = [
    docs.reportMissing,
    { articleId: "V2", title: "V2" },
    { articleId: "V3", title: "V3" },
    docs.viewSales,
    { articleId: "V5", title: "V5" },
    { articleId: "V6", title: "V6" },
    docs.afterPayment,
    docs.receiptMissing,
    { articleId: "V9", title: "V9" },
    { articleId: "V10", title: "V10" },
    { articleId: "V11", title: "V11" },
    docs.cancelSale,
  ];
  const vector = vectorBase.map((doc, index) => ({
    ...doc,
    problem: problemMatchScore(query, doc),
    vectorScore: 0.941 - index * 0.0007,
  }));

  const result = fuseHybridResults(lexical, vector, 5, {
    keywordWeight: 1,
    vectorWeight: 1.25,
    problemWeight: 3,
  });

  assert.equal(result[0].articleId, "RECEIPT");
  assert.equal(result[0].retrieval.evidenceStrength, "strong");
  assert.ok(result[0].retrieval.problemCoverage >= 0.6);
});

test("embedding problem-v2 tidak memasukkan solusi/troubleshooting", () => {
  const text = articleEmbeddingText(docs.receiptMissing);
  assert.match(text, /Tidak keluar file download nota/i);
  assert.doesNotMatch(text, /Always Allow popup/i);
  assert.doesNotMatch(text, /print kembali/i);
});
