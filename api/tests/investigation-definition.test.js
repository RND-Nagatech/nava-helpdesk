import test from "node:test";
import assert from "node:assert/strict";
import { __investigationDefinitionInternals } from "../src/services/investigation-definition-service.js";

test("definition investigasi dapat menyimpan rancangan relasi tanpa pipeline sebagai draft", () => {
  const definition = __investigationDefinitionInternals.normalizeInvestigationDefinitionInput({
    operation_id: "finance.sales_vs_cash",
    name: "Selisih Penjualan dan Keuangan",
    allowed_collections: ["tt_jual_detail", "tt_cash_daily"],
    filters: ["tanggal_awal", "tanggal_akhir", "kode_toko"],
    group_by: ["no_faktur", "kode_toko"],
    metrics: [{ source: "tt_jual_detail", field: "nominal", operation: "sum" }],
    relation: {
      left_collection: "tt_jual_detail",
      left_field: "no_faktur",
      right_collection: "tt_cash_daily",
      right_field: "deskripsi",
    },
  });

  assert.equal(definition.status, "draft");
  assert.equal(definition.execution, null);
  assert.deepEqual(definition.allowed_collections, ["tt_jual_detail", "tt_cash_daily"]);
});

test("definition investigasi hanya dapat dipublish jika pipeline read-only tersedia", () => {
  const definition = __investigationDefinitionInternals.normalizeInvestigationDefinitionInput({
    operation_id: "stock.example",
    name: "Contoh",
    allowed_collections: ["th_barang_saldo"],
    filters: ["tanggal"],
    execution: {
      source_collection: "th_barang_saldo",
      pipeline: [{ $match: { tanggal: "{{tanggal}}" } }, { $limit: 10 }],
    },
  });

  assert.doesNotThrow(() => __investigationDefinitionInternals.validatePublishableInvestigationDefinition(definition));
  assert.deepEqual(
    __investigationDefinitionInternals.resolvePipelineParams(definition.execution.pipeline, { tanggal: "2026-07-20" }),
    [{ $match: { tanggal: "2026-07-20" } }, { $limit: 10 }],
  );
});

test("definition investigasi menolak stage write dan lookup di luar allowlist", () => {
  assert.throws(
    () => __investigationDefinitionInternals.normalizeInvestigationDefinitionInput({
      operation_id: "stock.unsafe",
      name: "Unsafe",
      allowed_collections: ["th_barang_saldo"],
      execution: {
        source_collection: "th_barang_saldo",
        pipeline: [{ $out: "tt_result" }],
      },
    }),
    /Pipeline stage hanya boleh memakai/,
  );

  assert.throws(
    () => __investigationDefinitionInternals.normalizeInvestigationDefinitionInput({
      operation_id: "stock.lookup_external",
      name: "Lookup external",
      allowed_collections: ["th_barang_saldo"],
      execution: {
        source_collection: "th_barang_saldo",
        pipeline: [{ $lookup: { from: "tt_customer_secret", localField: "x", foreignField: "x", as: "x" } }],
      },
    }),
    /harus masuk allowed_collections/,
  );
});
