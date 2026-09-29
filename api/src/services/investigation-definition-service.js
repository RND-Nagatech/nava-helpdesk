import { getDb } from "../database/mongodb.js";
import { env } from "../config/env.js";
import { getInvestigationDatabase } from "./investigation-service.js";

const DEFINITION_STATUSES = new Set(["draft", "published", "archived"]);
const METRIC_OPERATIONS = new Set(["sum", "count", "avg", "min", "max"]);
const RESULT_TYPES = new Set(["unmatched_and_amount_difference", "summary_difference", "relation_lookup", "custom"]);
const SAFE_PIPELINE_STAGES = new Set([
  "$match", "$project", "$group", "$lookup", "$unwind", "$addFields", "$set",
  "$unset", "$sort", "$limit", "$count", "$facet", "$replaceRoot", "$replaceWith",
]);
const FORBIDDEN_TOKENS = new Set([
  "$out", "$merge", "$where", "$function", "$accumulator", "mapReduce", "insert",
  "update", "delete", "drop",
]);

function now() {
  return new Date();
}

function error(message, code = "INVESTIGATION_DEFINITION_INVALID", statusCode = 400) {
  const result = new Error(message);
  result.code = code;
  result.statusCode = statusCode;
  return result;
}

function clean(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function list(values, maxItems = 30, maxLength = 120) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => clean(value, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

function collectionName(value) {
  const name = clean(value, 120);
  if (!/^(tm|tt|th|tr)_[a-z0-9_]+$/i.test(name)) {
    throw error(`Nama collection '${name || "-"}' tidak diizinkan untuk investigasi.`);
  }
  return name;
}

function normalizeMetrics(values = []) {
  return (Array.isArray(values) ? values : []).slice(0, 30).map((metric) => {
    const operation = clean(metric?.operation, 20).toLowerCase();
    if (!METRIC_OPERATIONS.has(operation)) throw error(`Operasi metric '${operation}' tidak diizinkan.`);
    return {
      source: collectionName(metric?.source),
      field: clean(metric?.field, 160),
      operation,
      ...(metric?.alias ? { alias: clean(metric.alias, 120) } : {}),
    };
  }).filter((metric) => metric.field);
}

function normalizeRelation(value) {
  if (!value || typeof value !== "object") return null;
  return {
    left_collection: collectionName(value.left_collection),
    left_field: clean(value.left_field, 160),
    right_collection: collectionName(value.right_collection),
    right_field: clean(value.right_field, 160),
  };
}

function validatePipelineValue(value, allowedCollections, path = "pipeline") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validatePipelineValue(item, allowedCollections, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_TOKENS.has(key) || FORBIDDEN_TOKENS.has(String(child))) {
      throw error(`Operator '${key}' tidak diizinkan dalam investigasi read-only.`);
    }
    if (key === "from" && typeof child === "string") {
      const from = collectionName(child);
      if (!allowedCollections.includes(from)) {
        throw error(`Collection lookup '${from}' harus masuk allowed_collections.`);
      }
    }
    validatePipelineValue(child, allowedCollections, `${path}.${key}`);
  }
}

function normalizeExecution(value, allowedCollections) {
  if (!value || typeof value !== "object") return null;
  const sourceCollection = collectionName(value.source_collection || allowedCollections[0]);
  if (!allowedCollections.includes(sourceCollection)) {
    throw error("source_collection harus masuk allowed_collections.");
  }
  const pipeline = Array.isArray(value.pipeline) ? value.pipeline.slice(0, 50) : [];
  for (const stage of pipeline) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) throw error("Setiap pipeline stage harus berupa object.");
    const stageNames = Object.keys(stage);
    if (stageNames.length !== 1 || !SAFE_PIPELINE_STAGES.has(stageNames[0])) {
      throw error(`Pipeline stage hanya boleh memakai: ${[...SAFE_PIPELINE_STAGES].join(", ")}.`);
    }
  }
  validatePipelineValue(pipeline, allowedCollections);
  return {
    source_collection: sourceCollection,
    pipeline,
    max_rows: Math.min(Math.max(Number(value.max_rows) || 100, 1), 500),
  };
}

export function normalizeInvestigationDefinitionInput(input = {}, { status = "draft" } = {}) {
  const operationId = clean(input.operation_id, 100).toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{2,99}$/.test(operationId)) {
    throw error("operation_id wajib berupa identifier seperti finance.sales_vs_cash.");
  }
  const allowedCollections = list(input.allowed_collections, 20, 120).map(collectionName);
  if (!allowedCollections.length) throw error("Minimal satu allowed_collection wajib diisi.");

  const definition = {
    operation_id: operationId,
    name: clean(input.name, 200),
    description: clean(input.description, 2000),
    status: DEFINITION_STATUSES.has(input.status) ? input.status : status,
    allowed_collections: allowedCollections,
    filters: list(input.filters, 30, 120),
    group_by: list(input.group_by, 30, 160),
    metrics: normalizeMetrics(input.metrics),
    relation: normalizeRelation(input.relation),
    result_type: RESULT_TYPES.has(input.result_type) ? input.result_type : "custom",
    executor: clean(input.executor, 120) || "declarative",
    execution: normalizeExecution(input.execution, allowedCollections),
    linked_knowledge_ids: list(input.linked_knowledge_ids, 30, 120),
  };

  if (!definition.name) throw error("Nama operation wajib diisi.");
  return definition;
}

export function validatePublishableInvestigationDefinition(definition) {
  if (!definition?.execution?.pipeline?.length) {
    throw error(
      "Definition belum dapat dijalankan. Isi execution.source_collection dan execution.pipeline sebelum publish.",
      "INVESTIGATION_DEFINITION_NOT_EXECUTABLE",
    );
  }
  if (!definition.allowed_collections?.length) throw error("allowed_collections wajib diisi.");
  if (definition.relation && (!definition.relation.left_field || !definition.relation.right_field)) {
    throw error("Field relasi kiri dan kanan wajib diisi.");
  }
}

function serialize(doc) {
  if (!doc) return null;
  return {
    ...doc,
    _id: doc._id ? String(doc._id) : undefined,
  };
}

const BUILT_IN_DEFINITIONS = [
  {
    operation_id: "stock.detail_vs_summary",
    name: "Selisih Barang Detail dan Summary",
    description: "Membandingkan barang realtime di tm_barang dengan saldo summary pada tanggal yang diminta.",
    status: "published",
    allowed_collections: ["tm_barang", "tt_barang_saldo", "th_barang_saldo", "tt_barang_summary"],
    filters: ["tanggal", "kode_barcode", "kode_toko", "kode_gudang", "max_rows"],
    group_by: ["kode_barcode", "kode_toko", "kode_gudang"],
    metrics: [
      { source: "tm_barang", field: "stock_on_hand", operation: "sum", alias: "detail_stock_on_hand" },
      { source: "tt_barang_saldo", field: "stock_akhir", operation: "sum", alias: "saldo_stock_akhir" },
      { source: "tm_barang", field: "berat", operation: "sum", alias: "detail_berat" },
      { source: "tt_barang_saldo", field: "berat_akhir", operation: "sum", alias: "saldo_berat_akhir" },
    ],
    relation: {
      left_collection: "tm_barang",
      left_field: "kode_barcode",
      right_collection: "tt_barang_saldo",
      right_field: "kode_barcode",
    },
    result_type: "summary_difference",
    executor: "builtin:stock.detail_vs_summary",
    execution: {
      source_collection: "tm_barang",
      pipeline: [{ $match: {} }, { $limit: 1 }],
      max_rows: 100,
    },
    linked_knowledge_ids: [],
  },
  {
    operation_id: "stock.opening_vs_previous_closing",
    name: "Saldo Awal vs Saldo Akhir Hari Sebelumnya",
    description: "Mencari barcode yang saldo akhir hari sebelumnya tidak sama dengan saldo awal hari sesudahnya.",
    status: "published",
    allowed_collections: ["th_barang_saldo"],
    filters: ["tanggal_sebelumnya", "tanggal_sesudahnya", "kode_toko", "kode_gudang", "max_rows"],
    group_by: ["kode_barcode", "kode_toko", "kode_gudang"],
    metrics: [
      { source: "th_barang_saldo", field: "stock_akhir", operation: "sum", alias: "previous_stock_akhir" },
      { source: "th_barang_saldo", field: "stock_awal", operation: "sum", alias: "current_stock_awal" },
      { source: "th_barang_saldo", field: "berat_akhir", operation: "sum", alias: "previous_berat_akhir" },
      { source: "th_barang_saldo", field: "berat_awal", operation: "sum", alias: "current_berat_awal" },
    ],
    relation: {
      left_collection: "th_barang_saldo",
      left_field: "kode_barcode",
      right_collection: "th_barang_saldo",
      right_field: "kode_barcode",
    },
    result_type: "summary_difference",
    executor: "builtin:stock.opening_vs_previous_closing",
    execution: {
      source_collection: "th_barang_saldo",
      pipeline: [{ $match: {} }, { $limit: 1 }],
      max_rows: 100,
    },
    linked_knowledge_ids: [],
  },
  {
    operation_id: "finance.sales_vs_cash",
    name: "Selisih Penjualan dan Keuangan",
    description: "Mencari faktur group yang tidak cocok antara pembayaran penjualan NAGAGOLD dan cash harian berdasarkan logic report EOD.",
    status: "published",
    allowed_collections: ["tt_jual_detail", "tt_cash_daily", "tt_jual_batal"],
    filters: ["tanggal_awal", "tanggal_akhir", "no_faktur_group", "jenis_pembayaran", "max_rows"],
    group_by: ["no_faktur_group", "no_faktur_jual", "pembayaran.jenis", "kategori"],
    metrics: [
      { source: "tt_jual_detail", field: "harga_total", operation: "sum", alias: "gross_sales" },
      { source: "tt_jual_detail", field: "pembayaran.jumlah_rp", operation: "sum", alias: "expected_payment" },
      { source: "tt_cash_daily", field: "jumlah_in", operation: "sum", alias: "cash_in" },
      { source: "tt_cash_daily", field: "jumlah_out", operation: "sum", alias: "cash_out" },
    ],
    relation: {
      left_collection: "tt_jual_detail",
      left_field: "no_faktur_group",
      right_collection: "tt_cash_daily",
      right_field: "deskripsi",
    },
    result_type: "unmatched_and_amount_difference",
    // Operation ini memakai handler yang mengikuti report NAGAGOLD, bukan
    // pipeline bebas dari form Admin. Pipeline placeholder hanya menjaga
    // kompatibilitas catalog generic dan tidak pernah dieksekusi untuk ID ini.
    executor: "builtin:finance.sales_vs_cash",
    execution: {
      source_collection: "tt_jual_detail",
      pipeline: [{ $match: {} }, { $limit: 1 }],
      max_rows: 200,
    },
    linked_knowledge_ids: ["INV-KB-FINANCE-SALES-CASH-NAGAGOLD"],
  },
  {
    operation_id: "finance.buyback_vs_cash",
    name: "Selisih Buyback Customer dan Keuangan",
    description: "Membandingkan transaksi pembelian kembali dari customer dengan arus cash pembelian NAGAGOLD.",
    status: "published",
    allowed_collections: ["tt_beli_detail", "tt_beli_batal", "tt_cash_daily"],
    filters: ["tanggal_awal", "tanggal_akhir", "no_faktur_group", "no_faktur_beli", "kode_barcode", "kode_gudang", "max_rows"],
    group_by: ["no_faktur_group", "no_faktur_beli", "kode_barcode", "kategori"],
    metrics: [
      { source: "tt_beli_detail", field: "harga", operation: "sum", alias: "buyback_total" },
      { source: "tt_beli_detail", field: "pembayaran.jumlah_rp", operation: "sum", alias: "expected_payment" },
      { source: "tt_cash_daily", field: "jumlah_out", operation: "sum", alias: "cash_out" },
      { source: "tt_beli_batal", field: "harga", operation: "sum", alias: "canceled_buyback" },
    ],
    relation: {
      left_collection: "tt_beli_detail",
      left_field: "no_faktur_group",
      right_collection: "tt_cash_daily",
      right_field: "deskripsi",
    },
    result_type: "unmatched_and_amount_difference",
    executor: "builtin:finance.buyback_vs_cash",
    execution: {
      source_collection: "tt_beli_detail",
      pipeline: [{ $match: {} }, { $limit: 1 }],
      max_rows: 200,
    },
    linked_knowledge_ids: ["INV-KB-FINANCE-BUYBACK-CASH-NAGAGOLD"],
  },
  {
    operation_id: "stock.buyback_vs_saldo",
    name: "Buyback Customer vs Saldo Barang",
    description: "Memastikan buyback customer yang sudah DONE tercermin pada stock_beli dan berat_beli di saldo barang.",
    status: "published",
    allowed_collections: ["tt_beli_detail", "tt_barang_saldo"],
    filters: ["tanggal_awal", "tanggal_akhir", "kode_barcode", "kode_gudang", "max_rows"],
    group_by: ["tgl_system", "kode_barcode", "kode_gudang"],
    metrics: [
      { source: "tt_beli_detail", field: "berat", operation: "sum", alias: "buyback_weight" },
      { source: "tt_barang_saldo", field: "stock_beli", operation: "sum", alias: "saldo_stock_beli" },
      { source: "tt_barang_saldo", field: "berat_beli", operation: "sum", alias: "saldo_berat_beli" },
    ],
    relation: {
      left_collection: "tt_beli_detail",
      left_field: "kode_barcode",
      right_collection: "tt_barang_saldo",
      right_field: "kode_barcode",
    },
    result_type: "summary_difference",
    executor: "builtin:stock.buyback_vs_saldo",
    execution: {
      source_collection: "tt_beli_detail",
      pipeline: [{ $match: {} }, { $limit: 1 }],
      max_rows: 200,
    },
    linked_knowledge_ids: ["INV-KB-STOCK-BUYBACK-SALDO-NAGAGOLD"],
  },
  {
    operation_id: "service.status_vs_cash",
    name: "Status Service dan Cash",
    description: "Membandingkan transaksi service dengan cash SERVICE, SERVICE AMBIL, dan BATAL SERVICE berdasarkan nomor service.",
    status: "published",
    allowed_collections: ["tt_service_detail", "tt_cash_daily"],
    filters: ["tanggal_awal", "tanggal_akhir", "no_faktur_service", "status_proses", "max_rows"],
    group_by: ["no_faktur_service", "status_proses", "kategori"],
    metrics: [
      { source: "tt_service_detail", field: "pembayaran.jumlah_rp", operation: "sum", alias: "expected_payment" },
      { source: "tt_cash_daily", field: "jumlah_in", operation: "sum", alias: "cash_in" },
      { source: "tt_cash_daily", field: "jumlah_out", operation: "sum", alias: "cash_out" },
    ],
    relation: {
      left_collection: "tt_service_detail",
      left_field: "no_faktur_service",
      right_collection: "tt_cash_daily",
      right_field: "deskripsi",
    },
    result_type: "unmatched_and_amount_difference",
    executor: "builtin:service.status_vs_cash",
    execution: {
      source_collection: "tt_service_detail",
      pipeline: [{ $match: {} }, { $limit: 1 }],
      max_rows: 200,
    },
    linked_knowledge_ids: ["INV-KB-SERVICE-CASH-STATUS-NAGAGOLD"],
  },
  {
    operation_id: "stock.opname_vs_saldo",
    name: "Stock Opname vs Saldo",
    description: "Membandingkan hasil stock opname dengan saldo akhir berdasarkan tanggal, barcode, gudang, dan kode baki.",
    status: "published",
    allowed_collections: ["tt_opname", "tt_barang_saldo"],
    filters: ["tanggal_awal", "tanggal_akhir", "kode_barcode", "kode_gudang", "kode_baki", "max_rows"],
    group_by: ["tgl_opname", "kode_barcode", "kode_gudang", "kode_toko"],
    metrics: [
      { source: "tt_opname", field: "stock_on_hand", operation: "sum", alias: "opname_stock" },
      { source: "tt_barang_saldo", field: "stock_akhir", operation: "sum", alias: "saldo_stock_akhir" },
      { source: "tt_opname", field: "berat", operation: "sum", alias: "opname_weight" },
      { source: "tt_barang_saldo", field: "berat_akhir", operation: "sum", alias: "saldo_weight_akhir" },
    ],
    relation: { left_collection: "tt_opname", left_field: "kode_barcode", right_collection: "tt_barang_saldo", right_field: "kode_barcode" },
    result_type: "summary_difference",
    executor: "builtin:stock.opname_vs_saldo",
    execution: { source_collection: "tt_opname", pipeline: [{ $match: {} }, { $limit: 1 }], max_rows: 200 },
    linked_knowledge_ids: ["INV-KB-STOCK-OPNAME-SALDO-NAGAGOLD"],
  },
  {
    operation_id: "stock.hancur_vs_saldo",
    name: "Hancur Barang vs Saldo Manual",
    description: "Memastikan transaksi hancur barang manual tercermin pada stock_hancur/berat_hancur dan mengosongkan saldo akhir.",
    status: "published",
    allowed_collections: ["tt_hancur_barang_manual", "tt_barang_saldo_manual"],
    filters: ["tanggal_awal", "tanggal_akhir", "no_hancur", "kode_barcode", "kode_gudang", "kode_baki", "max_rows"],
    group_by: ["tgl_system", "kode_dept", "kode_gudang", "kode_toko"],
    metrics: [
      { source: "tt_hancur_barang_manual", field: "stock", operation: "sum", alias: "hancur_stock" },
      { source: "tt_barang_saldo_manual", field: "stock_hancur", operation: "sum", alias: "saldo_stock_hancur" },
      { source: "tt_hancur_barang_manual", field: "berat", operation: "sum", alias: "hancur_weight" },
      { source: "tt_barang_saldo_manual", field: "berat_hancur", operation: "sum", alias: "saldo_weight_hancur" },
    ],
    relation: { left_collection: "tt_hancur_barang_manual", left_field: "kode_dept", right_collection: "tt_barang_saldo_manual", right_field: "kode_barcode" },
    result_type: "summary_difference",
    executor: "builtin:stock.hancur_vs_saldo",
    execution: { source_collection: "tt_hancur_barang_manual", pipeline: [{ $match: {} }, { $limit: 1 }], max_rows: 200 },
    linked_knowledge_ids: ["INV-KB-STOCK-HANCUR-SALDO-NAGAGOLD"],
  },
  {
    operation_id: "finance.debt_vs_cash",
    name: "Hutang/Cicilan vs Cash",
    description: "Membandingkan hutang dan cicilan dengan tt_cash_daily berdasarkan nomor faktur pada deskripsi dan kategori cash NAGAGOLD.",
    status: "published",
    allowed_collections: ["tt_hutang_detail", "tt_cicilan", "tt_cash_daily"],
    filters: ["tanggal_awal", "tanggal_akhir", "identifier", "jenis_transaksi", "max_rows"],
    group_by: ["no_faktur_hutang", "no_faktur_cicil", "kategori"],
    metrics: [
      { source: "tt_hutang_detail", field: "jumlah_hutang", operation: "sum", alias: "debt_principal" },
      { source: "tt_hutang_detail", field: "total_bayar", operation: "sum", alias: "debt_settlement" },
      { source: "tt_cicilan", field: "harga_jual_cicil", operation: "sum", alias: "installment_total" },
      { source: "tt_cash_daily", field: "jumlah_in", operation: "sum", alias: "cash_in" },
      { source: "tt_cash_daily", field: "jumlah_out", operation: "sum", alias: "cash_out" },
    ],
    relation: { left_collection: "tt_hutang_detail", left_field: "no_faktur_hutang/no_faktur_cicil", right_collection: "tt_cash_daily", right_field: "deskripsi" },
    result_type: "unmatched_and_amount_difference",
    executor: "builtin:finance.debt_vs_cash",
    execution: { source_collection: "tt_hutang_detail", pipeline: [{ $match: {} }, { $limit: 1 }], max_rows: 200 },
    linked_knowledge_ids: ["INV-KB-FINANCE-DEBT-CASH-NAGAGOLD"],
  },
  {
    operation_id: "stock.internal_transfer_vs_saldo",
    name: "Pindah Barang Internal vs Saldo",
    description: "Memastikan pindah barang antar-baki atau antar-gudang dalam cabang yang sama tercermin pada saldo manual asal dan tujuan.",
    status: "published",
    allowed_collections: ["tt_pindah_barang_manual", "tt_barang_saldo_manual"],
    filters: ["tanggal_awal", "tanggal_akhir", "no_pindah", "kode_dept", "kode_gudang_asal", "kode_baki_asal", "kode_gudang_tujuan", "kode_baki_tujuan", "max_rows"],
    group_by: ["no_pindah", "kode_dept", "kode_gudang_asal", "kode_toko_asal", "kode_gudang_tujuan", "kode_toko_tujuan"],
    metrics: [
      { source: "tt_pindah_barang_manual", field: "stock", operation: "sum", alias: "expected_stock" },
      { source: "tt_pindah_barang_manual", field: "berat", operation: "sum", alias: "expected_weight" },
      { source: "tt_barang_saldo_manual", field: "stock_out", operation: "sum", alias: "source_stock_out" },
      { source: "tt_barang_saldo_manual", field: "stock_tambah", operation: "sum", alias: "destination_stock_tambah" },
    ],
    relation: {
      left_collection: "tt_pindah_barang_manual",
      left_field: "kode_dept",
      right_collection: "tt_barang_saldo_manual",
      right_field: "kode_barcode",
    },
    result_type: "summary_difference",
    executor: "builtin:stock.internal_transfer_vs_saldo",
    execution: {
      source_collection: "tt_pindah_barang_manual",
      pipeline: [{ $match: {} }, { $limit: 1 }],
      max_rows: 200,
    },
    linked_knowledge_ids: ["INV-KB-STOCK-INTERNAL-TRANSFER-NAGAGOLD"],
  },
  {
    operation_id: "report.visibility_diagnostic",
    name: "Diagnosis Data Tidak Muncul di Report",
    description: "Memeriksa apakah data sumber report ada, terfilter status/tanggal, atau tidak memiliki relasi cash yang diharapkan.",
    status: "published",
    allowed_collections: ["tt_beli_detail", "tt_jual_detail", "tt_cash_daily", "tt_service_detail", "tt_hutang_detail", "th_barang_saldo"],
    filters: ["report_context", "tanggal_awal", "tanggal_akhir", "identifier", "kode_gudang", "max_rows"],
    group_by: ["report_context", "status_valid", "status_proses", "status_hutang"],
    metrics: [{ source: "tt_beli_detail", field: "_id", operation: "count", alias: "source_count" }],
    result_type: "relation_lookup",
    executor: "builtin:report.visibility_diagnostic",
    execution: {
      source_collection: "tt_beli_detail",
      pipeline: [{ $match: {} }, { $limit: 1 }],
      max_rows: 100,
    },
    linked_knowledge_ids: ["INV-KB-REPORT-VISIBILITY-NAGAGOLD"],
  },
];

export async function ensureBuiltInInvestigationDefinitions() {
  const db = await getDb();
  const timestamp = now();
  for (const input of BUILT_IN_DEFINITIONS) {
    const definition = normalizeInvestigationDefinitionInput(input, { status: "published" });
    await db.collection(env.investigationDefinitionCollection).updateOne(
      { operation_id: definition.operation_id },
      {
        $setOnInsert: {
          ...definition,
          created_at: timestamp,
          updated_at: timestamp,
          published_at: timestamp,
          created_by_helpdesk_id: "system",
          created_by_helpdesk_name: "NAVA system",
          updated_by_helpdesk_id: "system",
          updated_by_helpdesk_name: "NAVA system",
        },
      },
      { upsert: true },
    );
  }
}

export async function listInvestigationDefinitions({ status = "", limit = 100 } = {}) {
  const db = await getDb();
  const query = status && DEFINITION_STATUSES.has(status) ? { status } : {};
  const rows = await db.collection(env.investigationDefinitionCollection)
    .find(query, { projection: { _id: 0 } })
    .sort({ status: 1, updated_at: -1, operation_id: 1 })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 200))
    .toArray();
  return rows.map(serialize);
}

export async function listPublishedInvestigationDefinitions() {
  return listInvestigationDefinitions({ status: "published", limit: 100 });
}

export async function getInvestigationDefinition(operationId) {
  const db = await getDb();
  return serialize(await db.collection(env.investigationDefinitionCollection).findOne({ operation_id: clean(operationId, 100) }, { projection: { _id: 0 } }));
}

export async function createInvestigationDefinition(input, helpdeskUser) {
  const db = await getDb();
  const definition = normalizeInvestigationDefinitionInput(input, { status: "draft" });
  const timestamp = now();
  const doc = {
    ...definition,
    status: "draft",
    created_at: timestamp,
    updated_at: timestamp,
    created_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
    created_by_helpdesk_name: helpdeskUser?.name || null,
    updated_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
    updated_by_helpdesk_name: helpdeskUser?.name || null,
  };
  try {
    await db.collection(env.investigationDefinitionCollection).insertOne(doc);
  } catch (insertError) {
    if (insertError?.code === 11000) throw error("operation_id tersebut sudah digunakan.", "INVESTIGATION_DEFINITION_EXISTS", 409);
    throw insertError;
  }
  return serialize(doc);
}

export async function updateInvestigationDefinition(operationId, input, helpdeskUser) {
  const db = await getDb();
  const existing = await db.collection(env.investigationDefinitionCollection).findOne({ operation_id: clean(operationId, 100) });
  if (!existing) return null;
  const definition = normalizeInvestigationDefinitionInput({ ...existing, ...input, operation_id: existing.operation_id }, { status: existing.status || "draft" });
  if (existing.status === "published" && input.status !== "draft") definition.status = "published";
  const updatedAt = now();
  const result = await db.collection(env.investigationDefinitionCollection).findOneAndUpdate(
    { operation_id: existing.operation_id },
    {
      $set: {
        ...definition,
        updated_at: updatedAt,
        updated_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
        updated_by_helpdesk_name: helpdeskUser?.name || null,
      },
    },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return serialize(result);
}

export async function publishInvestigationDefinition(operationId, helpdeskUser) {
  const db = await getDb();
  const existing = await db.collection(env.investigationDefinitionCollection).findOne({ operation_id: clean(operationId, 100) });
  if (!existing) return null;
  const definition = normalizeInvestigationDefinitionInput(existing, { status: "draft" });
  validatePublishableInvestigationDefinition(definition);
  const updatedAt = now();
  const result = await db.collection(env.investigationDefinitionCollection).findOneAndUpdate(
    { operation_id: existing.operation_id },
    {
      $set: {
        ...definition,
        status: "published",
        published_at: updatedAt,
        published_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
        published_by_helpdesk_name: helpdeskUser?.name || null,
        updated_at: updatedAt,
      },
    },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return serialize(result);
}

export async function archiveInvestigationDefinition(operationId, helpdeskUser) {
  const db = await getDb();
  const updatedAt = now();
  const result = await db.collection(env.investigationDefinitionCollection).findOneAndUpdate(
    { operation_id: clean(operationId, 100) },
    {
      $set: {
        status: "archived",
        archived_at: updatedAt,
        archived_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
        archived_by_helpdesk_name: helpdeskUser?.name || null,
        updated_at: updatedAt,
      },
    },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return serialize(result);
}

function resolvePipelineParams(value, params, path = "pipeline") {
  if (Array.isArray(value)) return value.map((item, index) => resolvePipelineParams(item, params, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolvePipelineParams(child, params, `${path}.${key}`)]));
  }
  if (typeof value !== "string") return value;
  const match = value.match(/^\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}$/);
  if (!match) return value;
  if (!Object.hasOwn(params, match[1])) throw error(`Parameter '${match[1]}' belum diisi.`, "INVESTIGATION_PARAMETER_REQUIRED");
  return params[match[1]];
}

function normalizeExecutionParams(definition, input = {}) {
  const allowed = new Set(definition.filters || []);
  const result = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!allowed.has(key)) continue;
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw error(`Parameter '${key}' harus berupa nilai sederhana.`);
    }
    result[key] = typeof value === "string" ? value.slice(0, 200) : value;
  }
  return result;
}

export async function executeInvestigationDefinition({ definition, domain, params = {}, trainingId = "", helpdeskUser }) {
  if (!definition || definition.status !== "published") {
    throw error("Operation investigasi belum published.", "INVESTIGATION_DEFINITION_NOT_PUBLISHED", 409);
  }
  validatePublishableInvestigationDefinition(definition);
  const executionParams = normalizeExecutionParams(definition, params);
  const { db: targetDb, target } = await getInvestigationDatabase(domain, definition.connection_profile);
  const pipeline = resolvePipelineParams(definition.execution.pipeline, executionParams);
  const maxRows = Math.min(definition.execution.max_rows || env.investigationMaxRows, env.investigationMaxRows);
  const hasLimit = pipeline.some((stage) => Object.hasOwn(stage, "$limit"));
  const safePipeline = hasLimit ? pipeline : [...pipeline, { $limit: maxRows + 1 }];
  const rows = await targetDb.collection(definition.execution.source_collection)
    .aggregate(safePipeline, { maxTimeMS: Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000), allowDiskUse: true })
    .toArray();
  const truncated = rows.length > maxRows;
  const result = {
    read_only: true,
    status: "success",
    operation_id: definition.operation_id,
    operation_name: definition.name,
    target: { domain, database_name: target.database_name || "", connection_profile: target.connection_profile || "" },
    params: executionParams,
    collections_used: definition.allowed_collections,
    row_count: Math.min(rows.length, maxRows),
    truncated,
    rows: rows.slice(0, maxRows),
    instruction_to_agent: "Hasil ini berasal dari aggregation read-only yang disetujui. Jelaskan bukti yang ditemukan dan jangan mengubah database.",
  };
  try {
    const auditDb = await getDb();
    await auditDb.collection(env.investigationRunCollection).insertOne({
      training_id: trainingId || "",
      helpdesk_id: helpdeskUser?.helpdesk_id || "",
      helpdesk_name: helpdeskUser?.name || "",
      domain,
      operation_id: definition.operation_id,
      filters: executionParams,
      status: "completed",
      collections_used: definition.allowed_collections,
      summary: { row_count: result.row_count, truncated },
      query_hash: "declarative:" + definition.operation_id,
      duration_ms: null,
      created_at: now(),
    });
  } catch (auditError) {
    console.warn("Audit definition investigasi gagal disimpan: " + (auditError?.message || auditError));
  }
  return result;
}

export const __investigationDefinitionInternals = {
  collectionName,
  normalizeInvestigationDefinitionInput,
  validatePublishableInvestigationDefinition,
  resolvePipelineParams,
  BUILT_IN_DEFINITIONS,
};
