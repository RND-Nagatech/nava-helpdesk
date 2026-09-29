import test from "node:test";
import assert from "node:assert/strict";
import { __investigationPlaybookInternals } from "../src/services/investigation-playbook-service.js";

test("Playbook generic menyimpan parameter dan pipeline read-only tanpa executor legacy", () => {
  const playbook = __investigationPlaybookInternals.normalizeInvestigationPlaybookInput({
    playbook_id: "stock.summary_vs_detail_generic",
    name: "Selisih Summary dan Detail",
    description: "Mencari saldo barang yang berbeda.",
    parameters: [{ key: "tanggal", label: "Tanggal", type: "date", required: true }],
    collections: [{ name: "th_barang_saldo", purpose: "Saldo historis" }],
    execution: {
      source_collection: "th_barang_saldo",
      strategy: "standard",
      pipeline: [{ $match: { tanggal: "{{tanggal}}" } }, { $limit: 20 }],
    },
  });

  assert.equal(playbook.executor_id, "");
  assert.equal(playbook.execution.source_collection, "th_barang_saldo");
  assert.equal(playbook.parameters[0].key, "tanggal");
  assert.equal(playbook.execution.strategy, "standard");
  assert.deepEqual(
    __investigationPlaybookInternals.resolvePipelineParams(playbook.execution.pipeline, { tanggal: "2026-09-24" }),
    [{ $match: { tanggal: "2026-09-24" } }, { $limit: 20 }],
  );
});

test("Playbook dapat membaca format db.collection.aggregate dan menurunkan collection serta parameter", () => {
  const playbook = __investigationPlaybookInternals.normalizeInvestigationPlaybookInput({
    playbook_id: "stock.shell_format",
    name: "Format shell",
    description: "Aggregation lengkap.",
    aggregation_source: `db.th_barang_saldo.aggregate([{ $match: { tanggal: "{{tanggal}}" } }, { $lookup: { from: "tm_barang", localField: "kode_barcode", foreignField: "kode_barcode", as: "master" } }])`,
  });

  assert.equal(playbook.execution.source_collection, "th_barang_saldo");
  assert.deepEqual(playbook.collections.map((item) => item.name), ["th_barang_saldo", "tm_barang"]);
  assert.equal(playbook.parameters[0].key, "tanggal");
});

test("Filter gudang yang diinfer dari aggregation bersifat opsional", () => {
  const playbook = __investigationPlaybookInternals.normalizeInvestigationPlaybookInput({
    playbook_id: "stock.global_summary_check",
    name: "Pemeriksaan global summary",
    description: "Mencari selisih pada seluruh gudang.",
    aggregation_source: `db.tm_barang.aggregate([{ $match: { tanggal: "{{tanggal}}", kode_gudang: "{{kode_gudang}}" } }])`,
  });

  assert.equal(playbook.parameters.find((item) => item.key === "tanggal")?.required, true);
  assert.equal(playbook.parameters.find((item) => item.key === "kode_gudang")?.required, false);
  assert.deepEqual(
    __investigationPlaybookInternals.resolvePipelineParams(
      playbook.execution.pipeline,
      { tanggal: "2026-09-24" },
      new Set(["kode_gudang"]),
    ),
    [{ $match: { tanggal: "2026-09-24", kode_gudang: null } }],
  );
});

test("Playbook generic menolak write stage dan lookup di luar collection allowlist", () => {
  assert.throws(
    () => __investigationPlaybookInternals.normalizeInvestigationPlaybookInput({
      playbook_id: "unsafe.playbook",
      name: "Unsafe",
      description: "Tidak boleh write.",
      collections: [{ name: "th_barang_saldo" }],
      execution: { source_collection: "th_barang_saldo", pipeline: [{ $merge: { into: "result" } }] },
    }),
    /Langkah aggregation hanya boleh memakai/,
  );

  assert.throws(
    () => __investigationPlaybookInternals.normalizeInvestigationPlaybookInput({
      playbook_id: "unsafe.lookup",
      name: "Unsafe lookup",
      description: "Lookup luar allowlist.",
      collections: [{ name: "th_barang_saldo" }],
      execution: {
        source_collection: "th_barang_saldo",
        pipeline: [{ $lookup: { from: "tm_secret", localField: "x", foreignField: "x", as: "x" } }],
      },
    }),
    /harus masuk daftar data yang diperiksa/,
  );
});
