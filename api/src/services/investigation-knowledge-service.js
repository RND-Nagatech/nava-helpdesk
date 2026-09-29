import crypto from "node:crypto";
import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";

const STATUSES = new Set(["draft", "published", "archived"]);

function now() {
  return new Date();
}

function clean(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function list(values, maxItems = 30, maxLength = 400) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => clean(value, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

function normalizeSteps(values = []) {
  return (Array.isArray(values) ? values : []).slice(0, 30).map((step, index) => ({
    order: index + 1,
    title: clean(step?.title || `Langkah ${index + 1}`, 120),
    instruction: clean(step?.instruction, 2000),
    expectedResult: clean(step?.expectedResult, 1000),
  })).filter((step) => step.instruction);
}

function normalizeInput(input = {}, { status = "draft" } = {}) {
  const articleId = clean(input.articleId || input.knowledge_id || `INV-KB-${crypto.randomUUID()}`, 200);
  const title = clean(input.title, 300);
  const steps = normalizeSteps(input.troubleshootingSteps);
  return {
    articleId,
    title,
    category: clean(input.category, 120),
    product: "nagagold",
    symptoms: list(input.symptoms, 30, 400),
    tags: list(input.tags, 50, 80),
    troubleshootingSteps: steps,
    userResponseTemplate: clean(input.userResponseTemplate, 4000),
    internalNotes: clean(input.internalNotes, 8000),
    linked_operation_ids: list(input.linked_operation_ids, 30, 100),
    status: STATUSES.has(input.status) ? input.status : status,
  };
}

function validatePublishable(article) {
  const errors = [];
  if (!article.title) errors.push("Judul panduan wajib diisi.");
  if (!article.symptoms?.length) errors.push("Minimal satu gejala/konteks wajib diisi.");
  if (!article.troubleshootingSteps?.length && !article.internalNotes) errors.push("Isi langkah atau internal notes wajib diisi.");
  if (errors.length) {
    const result = new Error(errors.join(" "));
    result.code = "INVESTIGATION_KNOWLEDGE_NOT_READY";
    result.statusCode = 400;
    throw result;
  }
}

function serialize(doc) {
  if (!doc) return null;
  return { ...doc, _id: doc._id ? String(doc._id) : undefined };
}

export async function listInvestigationKnowledge({ status = "", limit = 100 } = {}) {
  const db = await getDb();
  const query = status && STATUSES.has(status) ? { status } : {};
  const rows = await db.collection(env.investigationKnowledgeCollection)
    .find(query, { projection: { _id: 0 } })
    .sort({ status: 1, updated_at: -1, title: 1 })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 200))
    .toArray();
  return rows.map(serialize);
}

export async function getInvestigationKnowledge(articleId) {
  const db = await getDb();
  return serialize(await db.collection(env.investigationKnowledgeCollection).findOne({ articleId: clean(articleId, 200) }, { projection: { _id: 0 } }));
}

export async function createInvestigationKnowledge(input, helpdeskUser) {
  const db = await getDb();
  const article = normalizeInput(input, { status: "draft" });
  const timestamp = now();
  const doc = {
    ...article,
    status: "draft",
    created_at: timestamp,
    updated_at: timestamp,
    created_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
    created_by_helpdesk_name: helpdeskUser?.name || null,
    updated_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
    updated_by_helpdesk_name: helpdeskUser?.name || null,
  };
  try {
    await db.collection(env.investigationKnowledgeCollection).insertOne(doc);
  } catch (insertError) {
    if (insertError?.code === 11000) {
      const error = new Error("Knowledge investigasi tersebut sudah digunakan.");
      error.code = "INVESTIGATION_KNOWLEDGE_EXISTS";
      error.statusCode = 409;
      throw error;
    }
    throw insertError;
  }
  return serialize(doc);
}

export async function updateInvestigationKnowledge(articleId, input, helpdeskUser) {
  const db = await getDb();
  const existing = await db.collection(env.investigationKnowledgeCollection).findOne({ articleId: clean(articleId, 200) });
  if (!existing) return null;
  const article = normalizeInput({ ...existing, ...input, articleId: existing.articleId }, { status: existing.status || "draft" });
  const updatedAt = now();
  const result = await db.collection(env.investigationKnowledgeCollection).findOneAndUpdate(
    { articleId: existing.articleId },
    { $set: { ...article, updated_at: updatedAt, updated_by_helpdesk_id: helpdeskUser?.helpdesk_id || null, updated_by_helpdesk_name: helpdeskUser?.name || null } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return serialize(result);
}

export async function publishInvestigationKnowledge(articleId, helpdeskUser) {
  const db = await getDb();
  const existing = await db.collection(env.investigationKnowledgeCollection).findOne({ articleId: clean(articleId, 200) });
  if (!existing) return null;
  const article = normalizeInput(existing, { status: "draft" });
  validatePublishable(article);
  const updatedAt = now();
  const result = await db.collection(env.investigationKnowledgeCollection).findOneAndUpdate(
    { articleId: existing.articleId },
    { $set: { ...article, status: "published", published_at: updatedAt, published_by_helpdesk_id: helpdeskUser?.helpdesk_id || null, published_by_helpdesk_name: helpdeskUser?.name || null, updated_at: updatedAt } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return serialize(result);
}

export async function archiveInvestigationKnowledge(articleId, helpdeskUser) {
  const db = await getDb();
  const updatedAt = now();
  const result = await db.collection(env.investigationKnowledgeCollection).findOneAndUpdate(
    { articleId: clean(articleId, 200) },
    { $set: { status: "archived", archived_at: updatedAt, archived_by_helpdesk_id: helpdeskUser?.helpdesk_id || null, archived_by_helpdesk_name: helpdeskUser?.name || null, updated_at: updatedAt } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return serialize(result);
}

export const __investigationKnowledgeInternals = { normalizeInput, normalizeSteps, validatePublishable };
