import test from "node:test";
import assert from "node:assert/strict";
import { __investigationInternals } from "../src/services/investigation-service.js";

test("investigation stock scope mengunci barcode dan tanggal", () => {
  assert.deepEqual(
    __investigationInternals.scopeFilter({
      kode_barcode: "BC-1",
      kode_toko: "ITY",
      kode_gudang: "GD1",
      tanggal: "2026-09-14",
    }),
    {
      kode_barcode: "BC-1",
      kode_toko: "ITY",
      kode_gudang: "GD1",
      tanggal: "2026-09-14",
    },
  );
});

test("investigation menerima kode_baki sebagai alias kode_toko", () => {
  assert.equal(__investigationInternals.resolveKodeBaki({ kode_baki: "BAKI-01" }), "BAKI-01");
  assert.equal(__investigationInternals.resolveKodeBaki({ kode_toko: "BAKI-RAW", kode_baki: "BAKI-ALIAS" }), "BAKI-RAW");
});

test("investigation mendeteksi selisih saldo dan summary", () => {
  const findings = __investigationInternals.buildDifferences({
    master: { kode_barcode: "BC-1", stock_on_hand: 3 },
    barcodeTotals: { count: 1, stock_akhir: 2, berat_akhir: 10 },
    scopeTotals: { count: 1, stock_akhir: 2, berat_akhir: 10 },
    summary: { stock_akhir: 3, berat_akhir: 10 },
    scopeComplete: true,
  });

  assert.equal(findings.some((item) => item.code === "SUMMARY_METRIC_MISMATCH" && item.field === "stock_akhir"), true);
  assert.equal(findings.some((item) => item.code === "MASTER_SALDO_MISMATCH"), true);
});

test("investigation menolak tanggal yang tidak dikenali", () => {
  assert.throws(
    () => __investigationInternals.normalizeDate("tanggal yang tidak valid"),
    (error) => error.code === "INVESTIGATION_DATE_INVALID",
  );
});

test("investigation memahami tanggal relatif dengan zona waktu Jakarta", () => {
  const reference = new Date("2026-09-24T01:00:00.000Z");
  assert.equal(__investigationInternals.resolveInvestigationDate("hari ini", reference), "2026-09-24");
  assert.equal(__investigationInternals.resolveInvestigationDate("kemarin", reference), "2026-09-23");
  assert.equal(__investigationInternals.resolveInvestigationDate("besok", reference), "2026-09-25");
  assert.equal(__investigationInternals.resolveInvestigationDate("19 September 2026", reference), "2026-09-19");
  assert.equal(__investigationInternals.resolveInvestigationDate("19/09/2026", reference), "2026-09-19");
});

test("report stock memilih saldo realtime untuk tanggal tp_system dan histori untuk tanggal lama", () => {
  const current = __investigationInternals.resolveStockReportSource({
    tanggal_awal: "2026-09-24",
    tanggal_akhir: "2026-09-24",
    systemDate: "2026-09-24",
  });
  assert.equal(current.source.collection, "tt_barang_saldo");
  assert.equal(current.sourceMode, "realtime");

  const historical = __investigationInternals.resolveStockReportSource({
    tanggal_awal: "2026-09-23",
    tanggal_akhir: "2026-09-23",
    systemDate: "2026-09-24",
  });
  assert.equal(historical.source.collection, "th_barang_saldo");
  assert.equal(historical.sourceMode, "historical");
});

test("investigation membedakan tidak ada selisih dan scope belum lengkap", () => {
  assert.equal(__investigationInternals.buildInvestigationStatus([]), "no_difference");
  assert.equal(
    __investigationInternals.buildInvestigationStatus([{ code: "SUMMARY_SCOPE_REQUIRED" }]),
    "insufficient_scope",
  );
  assert.equal(
    __investigationInternals.buildInvestigationStatus([{ code: "MASTER_SALDO_MISMATCH" }]),
    "difference_found",
  );
});

test("investigation memberi kandidat koreksi carry-forward ketika tanggal berjalan tanpa mutasi", () => {
  const candidate = __investigationInternals.buildRolloverCorrectionCandidate({
    previous: { tanggal: "2026-07-19", stock_akhir: 1, berat_akhir: 4.1, row_count: 1 },
    current: {
      tanggal: "2026-07-20",
      stock_awal: 0,
      berat_awal: 4.1,
      stock_akhir: 0,
      berat_akhir: 4.1,
      movements: {},
      stock_in: 0,
      stock_out: 0,
      stock_jual: 0,
      stock_beli: 0,
      stock_hancur: 0,
      stock_tambah: 0,
      berat_in: 0,
      berat_out: 0,
      berat_jual: 0,
      berat_beli: 0,
      berat_hancur: 0,
      berat_tambah: 0,
      row_count: 1,
    },
  });

  assert.equal(candidate.type, "opening_carry_forward_mismatch");
  assert.equal(candidate.confidence, "high");
  assert.equal(candidate.expected.stock_awal, 1);
  assert.equal(candidate.expected.stock_akhir, 1);
  assert.equal(candidate.expected.berat_awal, 4.1);
  assert.equal(candidate.requires_human_confirmation, true);
});

test("investigation tidak memaksakan nilai koreksi ketika tanggal berjalan memiliki mutasi", () => {
  const candidate = __investigationInternals.buildRolloverCorrectionCandidate({
    previous: { tanggal: "2026-07-19", stock_akhir: 1, berat_akhir: 4.1, row_count: 1 },
    current: {
      tanggal: "2026-07-20",
      stock_awal: 0,
      berat_awal: 4.1,
      stock_akhir: 0,
      berat_akhir: 4.1,
      movements: { stock_jual: 1 },
      stock_jual: 1,
      row_count: 1,
    },
  });

  assert.equal(candidate.type, "opening_carry_forward_mismatch_with_movements");
  assert.equal(candidate.confidence, "needs_verification");
  assert.equal(candidate.expected.stock_awal, 1);
  assert.equal(Object.hasOwn(candidate.expected, "stock_akhir"), false);
});

test("finance.sales_vs_cash menganggap nominal cocok setelah adjustment", () => {
  const finding = __investigationInternals.classifySalesCashFinding({
    sales: { gross_sales: 1000 },
    cash: { PENJUALAN: { jumlah_in: 1000 }, "BATAL PENJUALAN": { jumlah_out: 200 } },
    paymentTotal: 800,
    saleCashIn: 1000,
    cancelCashOut: 200,
    adjustmentIn: 0,
    adjustmentOut: 0,
  });

  assert.equal(finding.code, "MATCH_WITH_ADJUSTMENT");
  assert.equal(finding.difference, 0);
});

test("finance.sales_vs_cash membedakan cash yang hilang dari selisih nominal", () => {
  const missingCash = __investigationInternals.classifySalesCashFinding({
    sales: { gross_sales: 1000 },
    cash: null,
    paymentTotal: 1000,
    saleCashIn: 0,
    cancelCashOut: 0,
    adjustmentIn: 0,
    adjustmentOut: 0,
  });
  assert.equal(missingCash.code, "MISSING_CASH");

  const amountDifference = __investigationInternals.classifySalesCashFinding({
    sales: { gross_sales: 1000 },
    cash: { PENJUALAN: { jumlah_in: 800 } },
    paymentTotal: 1000,
    saleCashIn: 800,
    cancelCashOut: 0,
    adjustmentIn: 0,
    adjustmentOut: 0,
  });
  assert.equal(amountDifference.code, "AMOUNT_DIFFERENCE");
  assert.equal(amountDifference.difference, -200);
});

test("finance.buyback_vs_cash membedakan buyback customer dari cash", () => {
  const missingCash = __investigationInternals.classifyBuybackCashFinding({
    buyback: { buyback_total: 1250 },
    cash: null,
    expectedPayment: 1250,
    buybackTotal: 1250,
    cancellationTotal: 0,
  });
  assert.equal(missingCash.code, "MISSING_BUYBACK_CASH");

  const amountDifference = __investigationInternals.classifyBuybackCashFinding({
    buyback: { buyback_total: 1250 },
    cash: { cash_out: 1000, cash_in: 0 },
    expectedPayment: 1250,
    buybackTotal: 1250,
    cancellationTotal: 0,
  });
  assert.equal(amountDifference.code, "BUYBACK_AMOUNT_DIFFERENCE");
  assert.equal(amountDifference.difference, -250);
});

test("kategori cash buyback yang dikenal dipisahkan dari kategori terenkripsi", () => {
  assert.equal(__investigationInternals.normalizeKnownCashCategory("PEMBELIAN"), "PEMBELIAN");
  assert.equal(__investigationInternals.normalizeKnownCashCategory("BATAL PEMBELIAN"), "BATAL PEMBELIAN");
  assert.equal(__investigationInternals.normalizeKnownCashCategory("ciphertext"), "UNKNOWN");
});

test("service.status_vs_cash membedakan service tanpa cash dan service batal tanpa refund", () => {
  const missingCash = __investigationInternals.classifyServiceCashFinding({
    service: { status_proses: ["OPEN"] },
    cash: null,
    expectedCash: 500000,
  });
  assert.equal(missingCash.code, "MISSING_SERVICE_CASH");

  const missingRefund = __investigationInternals.classifyServiceCashFinding({
    service: { status_proses: ["CANC"] },
    cash: { service_cash_in: 500000, service_ambil_cash_in: 0, cancel_service_cash_out: 0 },
    expectedCash: 500000,
  });
  assert.equal(missingRefund.code, "CANCELED_SERVICE_WITHOUT_REFUND");
});

test("stock.opname_vs_saldo mendeteksi barcode opname yang berbeda dari saldo", () => {
  const finding = __investigationInternals.classifyOpnameSaldoFinding({
    opname: { status_barang: "DONE", stock_on_hand: 4, berat: 10 },
    saldo: { stock_akhir: 5, berat_akhir: 10 },
  });
  assert.equal(finding.code, "OPNAME_SALDO_MISMATCH");
  assert.equal(finding.stock_difference, -1);
});

test("stock.hancur_vs_saldo memastikan saldo akhir kosong setelah hancur", () => {
  const finding = __investigationInternals.classifyHancurSaldoFinding({
    hancur: { stock: 1, berat: 2 },
    saldo: { stock_hancur: 1, berat_hancur: 2, stock_akhir: 1, berat_akhir: 2 },
  });
  assert.equal(finding.code, "HANCUR_SALDO_MISMATCH");
  assert.equal(finding.remaining_stock, 1);
});

test("finance.debt_vs_cash membedakan hutang tanpa cash pembentukan", () => {
  const finding = __investigationInternals.classifyDebtCashFinding({
    kind: "hutang",
    source: { jumlah_hutang: 1000000, total_bayar: 0, status_hutang: "OPEN" },
    cash: { categories: {} },
  });
  assert.equal(finding.code, "MISSING_HUTANG_CASH");
  assert.equal(finding.expected, 1000000);
});
