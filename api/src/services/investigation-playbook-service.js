import crypto from "node:crypto";
import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";
import { getInvestigationDatabase } from "./investigation-service.js";

const STATUSES = new Set(["draft", "published", "archived"]);
const EXECUTOR_ID_PATTERN = /^[a-z][a-z0-9_.:-]{2,160}$/i;
const SAFE_PIPELINE_STAGES = new Set([
  "$match", "$project", "$group", "$lookup", "$unwind", "$addFields", "$set",
  "$unset", "$sort", "$limit", "$count", "$facet", "$replaceRoot", "$replaceWith",
]);
const FORBIDDEN_PIPELINE_TOKENS = new Set([
  "$out", "$merge", "$where", "$function", "$accumulator", "mapReduce", "insert",
  "update", "delete", "drop",
]);
const EXECUTION_STRATEGIES = new Set(["standard", "stock_summary_vs_detail"]);

function now() {
  return new Date();
}

function clean(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function list(values, maxItems = 30, maxLength = 400) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => clean(value, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

function collectionName(value) {
  const name = clean(value, 120);
  if (!/^(tm|tt|th|tr|tp)_[a-z0-9_]+$/i.test(name)) {
    const error = new Error(`Nama collection '${name || "-"}' tidak diizinkan untuk Playbook.`);
    error.code = "INVESTIGATION_PLAYBOOK_INVALID";
    error.statusCode = 400;
    throw error;
  }
  return name;
}

function normalizeCollections(values = []) {
  return (Array.isArray(values) ? values : []).slice(0, 30).map((item) => ({
    name: collectionName(item?.name),
    purpose: clean(item?.purpose, 600),
    fields: list(item?.fields, 40, 160),
  }));
}

function normalizeRelations(values = []) {
  return (Array.isArray(values) ? values : []).slice(0, 30).map((item) => ({
    from_collection: collectionName(item?.from_collection),
    from_field: clean(item?.from_field, 160),
    to_collection: collectionName(item?.to_collection),
    to_field: clean(item?.to_field, 160),
    explanation: clean(item?.explanation, 800),
  }));
}

function normalizeSteps(values = []) {
  return (Array.isArray(values) ? values : []).slice(0, 30).map((item, index) => ({
    order: index + 1,
    title: clean(item?.title || `Langkah ${index + 1}`, 160),
    instruction: clean(item?.instruction, 2400),
    expected_result: clean(item?.expected_result, 800),
  })).filter((step) => step.instruction);
}

function normalizeParameters(values = []) {
  return (Array.isArray(values) ? values : []).slice(0, 30).map((item) => ({
    key: clean(item?.key, 80).toLowerCase(),
    label: clean(item?.label || item?.key, 160),
    type: ["text", "date", "number", "boolean"].includes(item?.type) ? item.type : "text",
    // Parameter hanya wajib jika memang dinyatakan wajib. Filter lokasi seperti
    // kode_gudang/kode_toko boleh kosong agar pemeriksaan global tetap berjalan.
    required: item?.required === true,
    description: clean(item?.description, 600),
  })).filter((item) => /^[a-z][a-z0-9_]{0,79}$/.test(item.key));
}

function inferredParameterRequired(key) {
  return /^(tanggal|tanggal_awal|tanggal_akhir|tanggal_sebelumnya|tanggal_sesudahnya)$/.test(key);
}

function pipelineParameters(pipeline) {
  const found = new Set();
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") return Object.values(value).forEach(visit);
    if (typeof value !== "string") return;
    const matches = value.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g);
    for (const match of matches) found.add(match[1].toLowerCase());
  }
  visit(pipeline);
  return [...found].map((key) => ({
    key,
    label: key,
    type: key.includes("tanggal") ? "date" : "text",
    required: inferredParameterRequired(key),
    description: inferredParameterRequired(key)
      ? "Parameter tanggal yang diperlukan untuk menjalankan pemeriksaan."
      : "Filter opsional. Jika tidak disebutkan Helpdesk, pemeriksaan dilakukan untuk semua nilai yang tersedia.",
  }));
}

function lookupCollections(pipeline) {
  const found = new Set();
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (typeof value.from === "string") found.add(value.from);
    Object.values(value).forEach(visit);
  }
  visit(pipeline);
  return [...found];
}

function parseAggregationSource(value) {
  const source = clean(value, 30000);
  if (!source) return null;
  const shellMatch = source.match(/^\s*db\.([a-zA-Z][a-zA-Z0-9_]*)\.aggregate\s*\(([\s\S]*)\)\s*;?\s*$/);
  const pipelineText = shellMatch ? shellMatch[2].trim().slice(0, shellMatch[2].trim().lastIndexOf("]") + 1) : source;
  let pipeline;
  try {
    pipeline = JSON.parse(pipelineText);
  } catch {
    // Mongo shell sering menulis operator/field tanpa tanda kutip. Terima
    // bentuk sederhana tersebut tanpa pernah mengeksekusi JavaScript.
    const relaxedJson = pipelineText
      .replace(/\/\/[^\n\r]*/g, "")
      .replace(/([{,]\s*)(\$?[A-Za-z_][\w$]*)(\s*:)/g, '$1"$2"$3')
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
      .replace(/,\s*([}\]])/g, "$1");
    try {
      pipeline = JSON.parse(relaxedJson);
    } catch {
      const error = new Error("Aggregation harus berupa JSON array atau db.collection.aggregate([...]) dengan isi pipeline JSON yang valid.");
      error.code = "INVESTIGATION_PLAYBOOK_INVALID";
      error.statusCode = 400;
      throw error;
    }
  }
  if (!Array.isArray(pipeline)) {
    const error = new Error("Isi aggregation harus berupa array pipeline.");
    error.code = "INVESTIGATION_PLAYBOOK_INVALID";
    error.statusCode = 400;
    throw error;
  }
  return { source_collection: shellMatch?.[1] || "", pipeline, source };
}

function validatePipelineValue(value, allowedCollections, path = "execution.pipeline") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validatePipelineValue(item, allowedCollections, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PIPELINE_TOKENS.has(key) || FORBIDDEN_PIPELINE_TOKENS.has(String(child))) {
      const error = new Error(`Operator '${key}' tidak diizinkan dalam Playbook read-only.`);
      error.code = "INVESTIGATION_PLAYBOOK_INVALID";
      error.statusCode = 400;
      throw error;
    }
    if (key === "from" && typeof child === "string" && !allowedCollections.includes(child)) {
      const error = new Error(`Collection lookup '${child}' harus masuk daftar data yang diperiksa.`);
      error.code = "INVESTIGATION_PLAYBOOK_INVALID";
      error.statusCode = 400;
      throw error;
    }
    validatePipelineValue(child, allowedCollections, `${path}.${key}`);
  }
}

function normalizeExecution(value, collections = []) {
  if (!value || typeof value !== "object") return null;
  const allowedCollections = collections.map((item) => item.name);
  const sourceCollection = collectionName(value.source_collection || allowedCollections[0]);
  if (!allowedCollections.includes(sourceCollection)) {
    const error = new Error("Collection sumber harus ada di daftar data yang diperiksa.");
    error.code = "INVESTIGATION_PLAYBOOK_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const pipeline = Array.isArray(value.pipeline) ? value.pipeline.slice(0, 60) : [];
  for (const stage of pipeline) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      const error = new Error("Setiap langkah aggregation harus berupa object.");
      error.code = "INVESTIGATION_PLAYBOOK_INVALID";
      error.statusCode = 400;
      throw error;
    }
    const stageNames = Object.keys(stage);
    if (stageNames.length !== 1 || !SAFE_PIPELINE_STAGES.has(stageNames[0])) {
      const error = new Error(`Langkah aggregation hanya boleh memakai: ${[...SAFE_PIPELINE_STAGES].join(", ")}.`);
      error.code = "INVESTIGATION_PLAYBOOK_INVALID";
      error.statusCode = 400;
      throw error;
    }
  }
  validatePipelineValue(pipeline, allowedCollections);
  return {
    source_collection: sourceCollection,
    pipeline,
    max_rows: Math.min(Math.max(Number(value.max_rows) || 100, 1), 500),
    strategy: EXECUTION_STRATEGIES.has(value.strategy) ? value.strategy : "standard",
  };
}

export function normalizeInvestigationPlaybookInput(input = {}, { status = "draft" } = {}) {
  const playbookId = clean(input.playbook_id || `PB-${crypto.randomUUID()}`, 160).toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{2,159}$/.test(playbookId)) {
    const error = new Error("ID Playbook wajib berupa identifier seperti stock.summary_vs_detail.");
    error.code = "INVESTIGATION_PLAYBOOK_INVALID";
    error.statusCode = 400;
    throw error;
  }

  const executorId = clean(input.executor_id, 180);
  if (executorId && !EXECUTOR_ID_PATTERN.test(executorId)) {
    const error = new Error("Executor backend belum berupa identifier yang valid.");
    error.code = "INVESTIGATION_PLAYBOOK_INVALID";
    error.statusCode = 400;
    throw error;
  }

  const parsedAggregation = parseAggregationSource(input.aggregation_source || input.aggregation_script);
  const initialCollections = normalizeCollections(input.collections);
  const inferredCollections = parsedAggregation
    ? [parsedAggregation.source_collection, ...lookupCollections(parsedAggregation.pipeline)].filter(Boolean).map((name) => ({ name, purpose: name === parsedAggregation.source_collection ? "Sumber utama pemeriksaan" : "Collection relasi/lookup", fields: [] }))
    : [];
  const mergedCollections = [...new Map([...initialCollections, ...inferredCollections].map((item) => [item.name, item])).values()];
  const executionInput = parsedAggregation
    ? { ...(input.execution || {}), source_collection: parsedAggregation.source_collection || input.execution?.source_collection, pipeline: parsedAggregation.pipeline }
    : input.execution;
  const execution = normalizeExecution(executionInput, mergedCollections);
  const parameters = normalizeParameters(input.parameters?.length ? input.parameters : pipelineParameters(execution?.pipeline || []));

  return {
    playbook_id: playbookId,
    name: clean(input.name, 240),
    description: clean(input.description, 2400),
    status: STATUSES.has(input.status) ? input.status : status,
    trigger_examples: list(input.trigger_examples, 30, 600),
    parameters,
    executor_id: executorId,
    executor_operation_id: clean(input.executor_operation_id, 120),
    collections: mergedCollections,
    relations: normalizeRelations(input.relations),
    steps: normalizeSteps(input.steps),
    response_template: clean(input.response_template, 6000),
    safety_notes: clean(input.safety_notes, 3000),
    finding_rules: clean(input.finding_rules, 5000),
    correction_guidance: clean(input.correction_guidance, 5000),
    execution,
    aggregation_source: parsedAggregation?.source || clean(input.aggregation_source || input.aggregation_script, 30000),
  };
}

function validatePublishable(playbook) {
  const errors = [];
  if (!playbook.name) errors.push("Nama Playbook wajib diisi.");
  if (!playbook.description) errors.push("Konteks masalah wajib diisi.");
  const hasGenericExecution = Boolean(playbook.execution?.source_collection && playbook.execution?.pipeline?.length);
  const hasLegacyExecutor = Boolean(playbook.executor_id);
  if (!hasGenericExecution && !hasLegacyExecutor) {
    errors.push("Aggregation read-only dan collection sumber wajib diisi.");
  }
  if (errors.length) {
    const error = new Error(errors.join(" "));
    error.code = "INVESTIGATION_PLAYBOOK_NOT_READY";
    error.statusCode = 400;
    throw error;
  }
}

function serialize(doc) {
  if (!doc) return null;
  return { ...doc, _id: doc._id ? String(doc._id) : undefined };
}

export async function listInvestigationPlaybooks({ status = "", limit = 100 } = {}) {
  const db = await getDb();
  const query = status && STATUSES.has(status) ? { status } : {};
  const rows = await db.collection(env.investigationPlaybookCollection)
    .find(query, { projection: { _id: 0 } })
    .sort({ status: 1, updated_at: -1, name: 1 })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 200))
    .toArray();
  return rows.map(serialize);
}

export async function listPublishedInvestigationPlaybooks({ executableOnly = true } = {}) {
  const rows = await listInvestigationPlaybooks({ status: "published", limit: 100 });
  return executableOnly ? rows.filter((row) => row.execution?.source_collection && row.execution?.pipeline?.length) : rows;
}

export async function findInvestigationPlaybooks(query, { limit = 5 } = {}) {
  const db = await getDb();
  const text = clean(query, 600);
  const terms = text.toLowerCase().split(/[^a-z0-9_]+/i).filter((term) => term.length >= 2).slice(0, 12);
  const rows = await db.collection(env.investigationPlaybookCollection)
    .find({ status: "published" }, { projection: { _id: 0 } })
    .limit(200)
    .toArray();
  const ranked = rows.map((item) => {
    const haystack = [item.name, item.description, ...(item.trigger_examples || []), ...(item.collections || []).map((collection) => collection.name)].join(" ").toLowerCase();
    const matched = terms.filter((term) => haystack.includes(term));
    return { item, score: matched.length, matched };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || String(a.item.name).localeCompare(String(b.item.name)));
  return ranked.slice(0, Math.min(Math.max(Number(limit) || 5, 1), 10)).map(({ item, matched }) => ({
    playbook_id: item.playbook_id,
    name: item.name,
    description: item.description,
    trigger_examples: item.trigger_examples || [],
    parameters: item.parameters || [],
    matched_terms: matched,
  }));
}

export async function getInvestigationPlaybook(playbookId) {
  const db = await getDb();
  return serialize(await db.collection(env.investigationPlaybookCollection)
    .findOne({ playbook_id: clean(playbookId, 160) }, { projection: { _id: 0 } }));
}

export async function createInvestigationPlaybook(input, helpdeskUser) {
  const db = await getDb();
  const playbook = normalizeInvestigationPlaybookInput(input, { status: "draft" });
  const timestamp = now();
  const doc = {
    ...playbook,
    status: "draft",
    created_at: timestamp,
    updated_at: timestamp,
    created_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
    created_by_helpdesk_name: helpdeskUser?.name || null,
    updated_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
    updated_by_helpdesk_name: helpdeskUser?.name || null,
  };
  try {
    await db.collection(env.investigationPlaybookCollection).insertOne(doc);
  } catch (insertError) {
    if (insertError?.code === 11000) {
      const error = new Error("ID Playbook tersebut sudah digunakan.");
      error.code = "INVESTIGATION_PLAYBOOK_EXISTS";
      error.statusCode = 409;
      throw error;
    }
    throw insertError;
  }
  return serialize(doc);
}

export async function updateInvestigationPlaybook(playbookId, input, helpdeskUser) {
  const db = await getDb();
  const existing = await db.collection(env.investigationPlaybookCollection)
    .findOne({ playbook_id: clean(playbookId, 160) });
  if (!existing) return null;
  const playbook = normalizeInvestigationPlaybookInput({ ...existing, ...input, playbook_id: existing.playbook_id }, { status: existing.status || "draft" });
  const updatedAt = now();
  const result = await db.collection(env.investigationPlaybookCollection).findOneAndUpdate(
    { playbook_id: existing.playbook_id },
    { $set: { ...playbook, updated_at: updatedAt, updated_by_helpdesk_id: helpdeskUser?.helpdesk_id || null, updated_by_helpdesk_name: helpdeskUser?.name || null } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return serialize(result);
}

export async function publishInvestigationPlaybook(playbookId, helpdeskUser) {
  const db = await getDb();
  const existing = await db.collection(env.investigationPlaybookCollection)
    .findOne({ playbook_id: clean(playbookId, 160) });
  if (!existing) return null;
  const playbook = normalizeInvestigationPlaybookInput(existing, { status: "draft" });
  validatePublishable(playbook);
  const updatedAt = now();
  const result = await db.collection(env.investigationPlaybookCollection).findOneAndUpdate(
    { playbook_id: existing.playbook_id },
    { $set: { ...playbook, status: "published", published_at: updatedAt, published_by_helpdesk_id: helpdeskUser?.helpdesk_id || null, published_by_helpdesk_name: helpdeskUser?.name || null, updated_at: updatedAt } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return serialize(result);
}

export async function archiveInvestigationPlaybook(playbookId, helpdeskUser) {
  const db = await getDb();
  const updatedAt = now();
  const result = await db.collection(env.investigationPlaybookCollection).findOneAndUpdate(
    { playbook_id: clean(playbookId, 160) },
    { $set: { status: "archived", archived_at: updatedAt, archived_by_helpdesk_id: helpdeskUser?.helpdesk_id || null, archived_by_helpdesk_name: helpdeskUser?.name || null, updated_at: updatedAt } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return serialize(result);
}

function resolvePipelineParams(value, params, optionalKeys = new Set()) {
  if (Array.isArray(value)) return value.map((item) => resolvePipelineParams(item, params, optionalKeys));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolvePipelineParams(child, params, optionalKeys)]));
  }
  if (typeof value !== "string") return value;
  const match = value.match(/^\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}$/);
  if (!match) return value;
  if (!Object.hasOwn(params, match[1])) {
    if (optionalKeys.has(match[1].toLowerCase())) return null;
    const error = new Error(`Parameter '${match[1]}' belum diisi.`);
    error.code = "INVESTIGATION_PARAMETER_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  return params[match[1]];
}

function normalizeExecutionParams(playbook, input = {}) {
  const allowed = new Set((playbook.parameters || []).map((parameter) => parameter.key));
  const result = {};
  for (const parameter of playbook.parameters || []) {
    const value = input[parameter.key];
    if ((value === undefined || value === null || value === "") && parameter.required) {
      const error = new Error(`Parameter '${parameter.label || parameter.key}' wajib diisi.`);
      error.code = "INVESTIGATION_PARAMETER_REQUIRED";
      error.statusCode = 400;
      throw error;
    }
  }
  for (const [key, value] of Object.entries(input || {})) {
    if (!allowed.has(key)) continue;
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      const error = new Error(`Parameter '${key}' harus berupa nilai sederhana.`);
      error.code = "INVESTIGATION_PARAMETER_INVALID";
      error.statusCode = 400;
      throw error;
    }
    result[key] = typeof value === "string" ? value.slice(0, 200) : value;
  }
  return result;
}

function stockScopeFilter(params, { includeDate = false } = {}) {
  const filter = {};
  if (includeDate && params.tanggal) filter.tanggal = params.tanggal;
  for (const key of ["kode_barcode", "kode_toko", "kode_gudang"]) {
    if (params[key] !== undefined && params[key] !== null && String(params[key]).trim()) {
      filter[key] = String(params[key]).trim();
    }
  }
  return filter;
}

function stockRowKey(row = {}) {
  return [row.kode_barcode, row.kode_toko, row.kode_gudang].map((value) => String(value ?? "")).join("\u001f");
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function addStockRow(map, row, stockField, weightField) {
  const key = stockRowKey(row);
  const current = map.get(key) || {
    kode_barcode: row.kode_barcode || "",
    kode_toko: row.kode_toko || "",
    kode_gudang: row.kode_gudang || "",
    stock: 0,
    berat: 0,
  };
  current.stock += numeric(row[stockField]);
  current.berat += numeric(row[weightField]);
  map.set(key, current);
}

async function executeStockSummaryVsDetail({ targetDb, playbook, domain, executionParams, maxRows }) {
  const queryTimeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
  const summaryFilter = stockScopeFilter(executionParams, { includeDate: true });
  const detailFilter = stockScopeFilter(executionParams);
  const summaryProjection = { _id: 0, tanggal: 1, kode_barcode: 1, kode_toko: 1, kode_gudang: 1, stock_akhir: 1, berat_akhir: 1 };
  const detailProjection = { _id: 0, kode_barcode: 1, kode_toko: 1, kode_gudang: 1, stock_on_hand: 1, berat: 1 };

  // Fase 1 sengaja hanya membaca baris Summary untuk tanggal aktif. Jika kosong,
  // tidak perlu melakukan group + lookup terhadap ratusan ribu baris tm_barang.
  const summaryRows = await targetDb.collection("tt_barang_saldo")
    .find(summaryFilter, { projection: summaryProjection, maxTimeMS: queryTimeout })
    .limit(maxRows + 1)
    .toArray();

  if (!summaryRows.length) {
    const detailRows = await targetDb.collection("tm_barang")
      .find(detailFilter, { projection: detailProjection, maxTimeMS: queryTimeout })
      .limit(maxRows + 1)
      .toArray();
    const rows = detailRows.slice(0, maxRows).map((row) => ({
      kode_barcode: row.kode_barcode || "",
      kode_toko: row.kode_toko || "",
      kode_gudang: row.kode_gudang || "",
      detail_stock: numeric(row.stock_on_hand),
      detail_berat: numeric(row.berat),
      summary_stock: 0,
      summary_berat: 0,
      summary_count: 0,
      stock_difference: numeric(row.stock_on_hand),
      berat_difference: numeric(row.berat),
      mismatch_type: "summary_missing",
    }));
    return {
      rows,
      truncated: detailRows.length > maxRows,
      diagnostic: "summary_empty",
      summary_rows_examined: 0,
      detail_rows_examined: detailRows.length,
    };
  }

  // Fase 2 dibatasi pada baris Summary pertama yang relevan. Karena tm_barang
  // memiliki index kode_barcode, lookup dilakukan lewat $in berukuran kecil,
  // bukan nested $lookup untuk seluruh collection.
  const summaryMap = new Map();
  for (const row of summaryRows.slice(0, maxRows)) addStockRow(summaryMap, row, "stock_akhir", "berat_akhir");
  const barcodes = [...new Set([...summaryMap.values()].map((row) => row.kode_barcode).filter(Boolean))];
  const detailQuery = { ...detailFilter, ...(barcodes.length ? { kode_barcode: { $in: barcodes } } : {}) };
  const detailRows = await targetDb.collection("tm_barang")
    .find(detailQuery, { projection: detailProjection, maxTimeMS: queryTimeout })
    .limit(Math.max(maxRows * 20, maxRows) + 1)
    .toArray();
  const detailMap = new Map();
  for (const row of detailRows) addStockRow(detailMap, row, "stock_on_hand", "berat");

  const rows = [];
  for (const [key, summary] of summaryMap.entries()) {
    const detail = detailMap.get(key) || { stock: 0, berat: 0 };
    const stockDifference = detail.stock - summary.stock;
    const beratDifference = detail.berat - summary.berat;
    if (!detailMap.has(key) || stockDifference !== 0 || Math.abs(beratDifference) > 0.01) {
      rows.push({
        kode_barcode: summary.kode_barcode,
        kode_toko: summary.kode_toko,
        kode_gudang: summary.kode_gudang,
        detail_stock: detail.stock,
        detail_berat: detail.berat,
        summary_stock: summary.stock,
        summary_berat: summary.berat,
        summary_count: 1,
        stock_difference: stockDifference,
        berat_difference: beratDifference,
        mismatch_type: detailMap.has(key) ? "value_mismatch" : "detail_missing",
      });
      if (rows.length >= maxRows) break;
    }
  }
  return {
    rows,
    truncated: summaryRows.length > maxRows || detailRows.length > maxRows * 20,
    diagnostic: "summary_compared",
    summary_rows_examined: summaryMap.size,
    detail_rows_examined: detailRows.length,
  };
}

export async function executeInvestigationPlaybook({ playbook, domain, params = {}, trainingId = "", helpdeskUser }) {
  if (!playbook || playbook.status !== "published") {
    const error = new Error("Playbook investigasi belum published.");
    error.code = "INVESTIGATION_PLAYBOOK_NOT_PUBLISHED";
    error.statusCode = 409;
    throw error;
  }
  const execution = normalizeExecution(playbook.execution, playbook.collections || []);
  if (!execution?.pipeline?.length) {
    const error = new Error("Playbook belum memiliki aggregation read-only.");
    error.code = "INVESTIGATION_PLAYBOOK_NOT_EXECUTABLE";
    error.statusCode = 409;
    throw error;
  }
  const executionParams = normalizeExecutionParams(playbook, params);
  const { db: targetDb, target } = await getInvestigationDatabase(domain, playbook.connection_profile);
  const optionalParameterKeys = new Set((playbook.parameters || [])
    .filter((parameter) => !parameter.required)
    .map((parameter) => parameter.key));
  const pipeline = resolvePipelineParams(execution.pipeline, executionParams, optionalParameterKeys);
  const maxRows = Math.min(execution.max_rows || env.investigationMaxRows, env.investigationMaxRows);
  let rows;
  let truncated = false;
  let diagnostic = "aggregation";
  let summaryRowsExamined = null;
  let detailRowsExamined = null;
  if (execution.strategy === "stock_summary_vs_detail") {
    const optimized = await executeStockSummaryVsDetail({ targetDb, playbook, domain, executionParams, maxRows });
    rows = optimized.rows;
    truncated = optimized.truncated;
    diagnostic = optimized.diagnostic;
    summaryRowsExamined = optimized.summary_rows_examined;
    detailRowsExamined = optimized.detail_rows_examined;
  } else {
    const hasLimit = pipeline.some((stage) => Object.hasOwn(stage, "$limit"));
    const safePipeline = hasLimit ? pipeline : [...pipeline, { $limit: maxRows + 1 }];
    rows = await targetDb.collection(execution.source_collection).aggregate(safePipeline, {
      maxTimeMS: Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000),
      allowDiskUse: true,
    }).toArray();
    truncated = rows.length > maxRows;
  }
  const result = {
    read_only: true,
    status: "success",
    playbook_id: playbook.playbook_id,
    playbook_name: playbook.name,
    target: { domain, database_name: target.database_name || "", connection_profile: target.connection_profile || "" },
    params: executionParams,
    collections_used: (playbook.collections || []).map((collection) => collection.name),
    row_count: Math.min(rows.length, maxRows),
    truncated,
    diagnostic,
    summary_rows_examined: summaryRowsExamined,
    detail_rows_examined: detailRowsExamined,
    rows: rows.slice(0, maxRows),
    finding_rules: playbook.finding_rules || "",
    correction_guidance: playbook.correction_guidance || "",
    response_template: playbook.response_template || "",
    safety_notes: playbook.safety_notes || "",
    instruction_to_agent: "Hasil ini berasal dari aggregation read-only pada Playbook published. Gunakan finding_rules dan correction_guidance untuk menjelaskan evidence. Jangan mengubah database.",
  };
  try {
    const auditDb = await getDb();
    await auditDb.collection(env.investigationRunCollection).insertOne({
      training_id: trainingId || "",
      helpdesk_id: helpdeskUser?.helpdesk_id || "",
      helpdesk_name: helpdeskUser?.name || "",
      domain,
      playbook_id: playbook.playbook_id,
      filters: executionParams,
      status: "completed",
      collections_used: result.collections_used,
      summary: { row_count: result.row_count, truncated },
      query_hash: "playbook:" + playbook.playbook_id,
      duration_ms: null,
      created_at: now(),
    });
  } catch (auditError) {
    console.warn("Audit Playbook investigasi gagal disimpan: " + (auditError?.message || auditError));
  }
  return result;
}

export const __investigationPlaybookInternals = { normalizeInvestigationPlaybookInput, normalizeCollections, normalizeRelations, normalizeSteps, normalizeParameters, normalizeExecution, parseAggregationSource, validatePublishable, resolvePipelineParams, stockScopeFilter, stockRowKey };
