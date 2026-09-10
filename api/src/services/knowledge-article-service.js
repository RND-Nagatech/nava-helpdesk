import crypto from "node:crypto";
import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";
import { embedDocuments } from "./embedding-service.js";
import { articleEmbeddingText, articleSearchText, tokenize } from "../utils/text.js";

const ARTICLE_STATUSES = new Set(["draft", "published", "archived"]);

function now() {
  return new Date();
}

function normalizeList(items = []) {
  return [...new Set((items || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeProduct(product) {
  const value = String(product || "nagagold").trim();
  return value.toLowerCase() === "navacare" ? "nagagold" : value;
}

function normalizeSteps(steps = []) {
  return (steps || [])
    .map((step, index) => ({
      order: Number(step.order || index + 1),
      title: String(step.title || `Langkah ${index + 1}`).trim(),
      instruction: String(step.instruction || "").trim(),
      expectedResult: String(step.expectedResult || "").trim(),
    }))
    .filter((step) => step.instruction)
    .map((step, index) => ({ ...step, order: index + 1, title: step.title || `Langkah ${index + 1}` }));
}

function deriveTags(article) {
  const source = [
    article.title,
    article.category,
    ...(article.symptoms || []),
  ].filter(Boolean).join(" ");
  return tokenize(source, { removeStopWords: true, expand: true }).slice(0, 12);
}

function normalizeArticleSteps(steps = [], userResponseTemplate = "") {
  const normalized = normalizeSteps(steps);
  if (normalized.length) return normalized;
  if (!userResponseTemplate) return [];
  return [{
    order: 1,
    title: "Solusi",
    instruction: userResponseTemplate,
    expectedResult: "Kendala teratasi.",
  }];
}

export function normalizeKnowledgeArticleInput(input = {}, { status = "draft" } = {}) {
  const article = {
    articleId: String(input.articleId || crypto.randomUUID()).trim(),
    title: String(input.title || "").trim(),
    category: String(input.category || "").trim(),
    product: normalizeProduct(input.product),
    clientScope: normalizeList(input.clientScope?.length ? input.clientScope : ["all"]),
    symptoms: normalizeList(input.symptoms),
    tags: normalizeList(input.tags),
    userResponseTemplate: String(input.userResponseTemplate || "").trim(),
    troubleshootingSteps: [],
    escalationRules: normalizeList(input.escalationRules),
    internalNotes: String(input.internalNotes || "").trim(),
    status: ARTICLE_STATUSES.has(input.status) ? input.status : status,
  };
  if (!article.symptoms.length && article.title) article.symptoms = [article.title];
  if (!article.tags.length) article.tags = deriveTags(article);
  article.troubleshootingSteps = normalizeArticleSteps(input.troubleshootingSteps, article.userResponseTemplate);
  article.search_text = articleSearchText(article);
  return article;
}

export function validatePublishableArticle(article) {
  const errors = [];
  if (!article.title) errors.push("Judul artikel wajib diisi.");
  if (!article.symptoms?.length) errors.push("Minimal isi 1 gejala customer.");
  if (!article.userResponseTemplate) errors.push("Template jawaban wajib diisi.");
  if (!article.troubleshootingSteps?.length) errors.push("Minimal isi 1 langkah troubleshooting.");
  if (errors.length) {
    const error = new Error(errors.join(" "));
    error.code = "ARTICLE_NOT_READY";
    error.statusCode = 400;
    throw error;
  }
}

function projection() {
  return {
    embedding: 0,
  };
}

export function serializeKnowledgeArticle(doc) {
  if (!doc) return null;
  const { _embedding_length: embeddingLength, ...publicDoc } = doc;
  const vector = doc[env.vectorField];
  const vectorLength = Array.isArray(vector) ? vector.length : Number(embeddingLength || 0);
  const modelMatches = !doc.embedding_model || doc.embedding_model === env.embeddingModel;
  const profileMatches = !doc.embedding_profile || doc.embedding_profile === env.embeddingProfile;
  const dimensionsMatch = !doc.embedding_dimensions || Number(doc.embedding_dimensions) === env.embeddingDimensions;
  const embeddingReady = (
    vectorLength === env.embeddingDimensions &&
    modelMatches &&
    profileMatches &&
    dimensionsMatch
  );
  return {
    ...publicDoc,
    _id: doc._id ? String(doc._id) : undefined,
    status: doc.status || "published",
    embedding_status: embeddingReady ? "ready" : "stale",
  };
}

function listQuery({ search = "", status = "", category = "" } = {}) {
  const query = {};
  if (status === "published") query.$or = [{ status: "published" }, { status: { $exists: false } }];
  else if (status) query.status = status;
  if (category) query.category = category;
  if (search) {
    const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(safe, "i");
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { articleId: regex },
          { title: regex },
          { category: regex },
          { product: regex },
          { symptoms: regex },
          { tags: regex },
          { userResponseTemplate: regex },
        ],
      },
    ];
  }
  return query;
}

export async function listKnowledgeArticles(filters = {}) {
  const db = await getDb();
  const limit = Math.min(Math.max(Number(filters.limit || 80), 1), 100);
  const rows = await db
    .collection(env.knowledgeCollection)
    .aggregate([
      { $match: listQuery(filters) },
      { $sort: { updated_at: -1, created_at: -1, title: 1 } },
      { $limit: limit },
      {
        $addFields: {
          _embedding_length: {
            $cond: [
              { $isArray: `$${env.vectorField}` },
              { $size: `$${env.vectorField}` },
              0,
            ],
          },
        },
      },
      { $project: projection() },
    ])
    .toArray();
  return rows.map(serializeKnowledgeArticle);
}

export async function listKnowledgeCategories() {
  const db = await getDb();
  const rows = await db.collection(env.knowledgeCollection).distinct("category", {
    category: { $exists: true, $nin: [null, ""] },
  });
  return rows
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "id"));
}

export async function getKnowledgeArticle(articleId) {
  const db = await getDb();
  const [doc] = await db
    .collection(env.knowledgeCollection)
    .aggregate([
      { $match: { articleId } },
      { $limit: 1 },
      {
        $addFields: {
          _embedding_length: {
            $cond: [
              { $isArray: `$${env.vectorField}` },
              { $size: `$${env.vectorField}` },
              0,
            ],
          },
        },
      },
      { $project: projection() },
    ])
    .toArray();
  return serializeKnowledgeArticle(doc);
}

export async function createKnowledgeArticle(input, helpdeskUser) {
  const db = await getDb();
  const createdAt = now();
  const article = normalizeKnowledgeArticleInput(input, { status: "draft" });
  const doc = {
    ...article,
    status: "draft",
    created_at: createdAt,
    updated_at: createdAt,
    created_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
    created_by_helpdesk_name: helpdeskUser?.name || null,
    updated_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
    updated_by_helpdesk_name: helpdeskUser?.name || null,
  };
  await db.collection(env.knowledgeCollection).insertOne(doc);
  return serializeKnowledgeArticle(doc);
}

export async function updateKnowledgeArticle(articleId, input, helpdeskUser, { status = null } = {}) {
  const db = await getDb();
  const existing = await db.collection(env.knowledgeCollection).findOne({ articleId });
  if (!existing) return null;

  const nextStatus = status || existing.status || "published";
  const article = normalizeKnowledgeArticleInput({ ...existing, ...input, articleId, status: nextStatus }, { status: nextStatus });
  const updatedAt = now();
  const update = {
    $set: {
      ...article,
      status: nextStatus,
      updated_at: updatedAt,
      updated_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
      updated_by_helpdesk_name: helpdeskUser?.name || null,
    },
    $unset: {
      [env.vectorField]: "",
      embedding_model: "",
      embedding_profile: "",
      embedding_dimensions: "",
      embedding_updated_at: "",
    },
  };

  const result = await db.collection(env.knowledgeCollection).findOneAndUpdate(
    { articleId },
    update,
    { returnDocument: "after", projection: projection() }
  );
  return serializeKnowledgeArticle({ ...result, _embedding_length: embedding.length });
}

export async function publishKnowledgeArticle(articleId, helpdeskUser) {
  const db = await getDb();
  const collection = db.collection(env.knowledgeCollection);
  const existing = await collection.findOne({ articleId });
  if (!existing) return null;

  const article = normalizeKnowledgeArticleInput(existing, { status: existing.status || "draft" });
  validatePublishableArticle(article);

  const [embedding] = await embedDocuments([articleEmbeddingText(article)]);
  const updatedAt = now();
  const result = await collection.findOneAndUpdate(
    { articleId },
    {
      $set: {
        ...article,
        status: "published",
        [env.vectorField]: embedding,
        embedding_model: env.embeddingModel,
        embedding_profile: env.embeddingProfile,
        embedding_dimensions: env.embeddingDimensions,
        embedding_updated_at: updatedAt,
        published_at: updatedAt,
        published_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
        published_by_helpdesk_name: helpdeskUser?.name || null,
        updated_at: updatedAt,
      },
    },
    { returnDocument: "after", projection: projection() }
  );
  return serializeKnowledgeArticle(result);
}

export async function archiveKnowledgeArticle(articleId, helpdeskUser) {
  const db = await getDb();
  const updatedAt = now();
  const result = await db.collection(env.knowledgeCollection).findOneAndUpdate(
    { articleId },
    {
      $set: {
        status: "archived",
        archived_at: updatedAt,
        archived_by_helpdesk_id: helpdeskUser?.helpdesk_id || null,
        archived_by_helpdesk_name: helpdeskUser?.name || null,
        updated_at: updatedAt,
      },
    },
    { returnDocument: "after", projection: projection() }
  );
  return serializeKnowledgeArticle(result);
}
