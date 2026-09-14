import crypto from "node:crypto";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ObjectId } from "mongodb";
import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";
import { runHelpdeskAgent } from "../agents/helpdesk-agent.js";
import { createKnowledgeArticle, getKnowledgeArticle } from "./knowledge-article-service.js";
import { retrieveKnowledge } from "./knowledge-retriever.js";
import { normalizeGoldstoreDomain } from "./site-check-service.js";

const TRAINING_ROLES = new Set(["helpdesk", "assistant", "correction"]);
const MAX_TRAINING_MESSAGES_FOR_DRAFT = 80;
let draftModel;

function now() {
  return new Date();
}

function createTrainingId(date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `TRN-${ymd}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function trainingThreadId(trainingId) {
  return `training:${trainingId}`;
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text") return part.text || "";
    return typeof part?.text === "string" ? part.text : "";
  }).filter(Boolean).join("\n");
}

function parseJsonObject(value) {
  const raw = textContent(value).trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("NAVA tidak menghasilkan format draft yang dapat diproses.");
    return JSON.parse(raw.slice(start, end + 1));
  }
}

function cleanText(value, max = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function extractTrainingDomain(value) {
  const source = String(value || "");
  const candidates = source.match(/(?:https?:\/\/)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.goldstore\.id\b/gi) || [];
  for (const candidate of candidates) {
    try {
      return normalizeGoldstoreDomain(candidate).hostname;
    } catch {
      // Abaikan domain yang tidak lolos validasi checker.
    }
  }
  return "";
}

function stringList(value, maxItems = 30, maxChars = 500) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => cleanText(item, maxChars)).filter(Boolean))].slice(0, maxItems);
}

function normalizeDraft(raw = {}) {
  const steps = (Array.isArray(raw.troubleshootingSteps) ? raw.troubleshootingSteps : [])
    .map((step, index) => ({
      order: index + 1,
      title: cleanText(step?.title || `Langkah ${index + 1}`, 120),
      instruction: cleanText(step?.instruction, 2000),
      expectedResult: cleanText(step?.expectedResult, 1000),
    }))
    .filter((step) => step.instruction);

  return {
    title: cleanText(raw.title, 300),
    category: cleanText(raw.category, 120),
    product: cleanText(raw.product || "nagagold", 120),
    clientScope: stringList(raw.clientScope?.length ? raw.clientScope : ["all"], 20, 100),
    symptoms: stringList(raw.symptoms, 30, 400),
    tags: stringList(raw.tags, 50, 80),
    userResponseTemplate: cleanText(raw.userResponseTemplate, 4000),
    troubleshootingSteps: steps,
    escalationRules: stringList(raw.escalationRules, 20, 500),
    internalNotes: cleanText(raw.internalNotes, 4000),
  };
}

function serializeSession(doc, messages = []) {
  if (!doc) return null;
  return {
    training_id: doc.training_id,
    helpdesk_id: doc.helpdesk_id,
    helpdesk_name: doc.helpdesk_name,
    title: doc.title,
    status: doc.status,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    knowledge_draft_id: doc.knowledge_draft_id || null,
    customer_domain: doc.customer_domain || "",
    messages,
  };
}

function serializeMessage(doc) {
  return {
    _id: doc._id ? String(doc._id) : undefined,
    training_id: doc.training_id,
    role: doc.role,
    content: doc.content,
    metadata: doc.metadata || {},
    created_at: doc.created_at,
  };
}

function notFound(message = "Training session tidak ditemukan.") {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = "TRAINING_NOT_FOUND";
  return error;
}

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "TRAINING_INVALID";
  return error;
}

async function getOwnedSession(trainingId, helpdeskId) {
  const db = await getDb();
  const session = await db.collection(env.trainingSessionCollection).findOne({
    training_id: trainingId,
    helpdesk_id: helpdeskId,
  }, { maxTimeMS: 5000 });
  if (!session) throw notFound();
  return { db, session };
}

async function closeActiveTrainingSessions(db, helpdeskId, exceptTrainingId = "") {
  const filter = {
    helpdesk_id: helpdeskId,
    status: "active",
    ...(exceptTrainingId ? { training_id: { $ne: exceptTrainingId } } : {}),
  };
  await db.collection(env.trainingSessionCollection).updateMany(
    filter,
    { $set: { status: "closed", updated_at: now() } },
  );
}

async function readMessages(db, trainingId) {
  const rows = await db.collection(env.trainingMessageCollection)
    .find({ training_id: trainingId }, { maxTimeMS: 5000 })
    .sort({ created_at: 1, _id: 1 })
    .toArray();
  return rows.map(serializeMessage);
}

async function appendMessage(db, { trainingId, role, content, metadata = {} }) {
  if (!TRAINING_ROLES.has(role)) throw invalid("Role message training tidak valid.");
  const doc = {
    training_id: trainingId,
    role,
    content: cleanText(content, 12000),
    metadata,
    created_at: now(),
  };
  const result = await db.collection(env.trainingMessageCollection).insertOne(doc);
  return serializeMessage({ ...doc, _id: result.insertedId });
}

export async function createTrainingSession(helpdeskUser, title = "Training baru") {
  const db = await getDb();
  await closeActiveTrainingSessions(db, helpdeskUser.helpdesk_id);
  const createdAt = now();
  const doc = {
    training_id: createTrainingId(createdAt),
    helpdesk_id: helpdeskUser.helpdesk_id,
    helpdesk_name: helpdeskUser.name,
    title: cleanText(title || "Training baru", 200),
    status: "active",
    created_at: createdAt,
    updated_at: createdAt,
    knowledge_draft_id: null,
    customer_domain: "",
  };
  await db.collection(env.trainingSessionCollection).insertOne(doc);
  return serializeSession(doc, []);
}

export async function getTrainingSession(trainingId, helpdeskUser) {
  const { db, session } = await getOwnedSession(trainingId, helpdeskUser.helpdesk_id);
  return serializeSession(session, await readMessages(db, trainingId));
}

export async function listTrainingSessions(helpdeskUser, limit = 50) {
  const db = await getDb();
  const activeSessions = await db.collection(env.trainingSessionCollection)
    .find({ helpdesk_id: helpdeskUser.helpdesk_id, status: "active" }, { maxTimeMS: 5000 })
    .sort({ updated_at: -1, _id: -1 })
    .toArray();
  const currentSession = activeSessions[0];
  if (currentSession && activeSessions.length > 1) {
    await closeActiveTrainingSessions(db, helpdeskUser.helpdesk_id, currentSession.training_id);
  }

  const sessions = await db.collection(env.trainingSessionCollection)
    .find({ helpdesk_id: helpdeskUser.helpdesk_id }, { maxTimeMS: 5000 })
    .sort({ status: 1, updated_at: -1, _id: -1 })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))
    .toArray();
  return sessions.map((session) => serializeSession(session, []));
}

function knowledgeMetadata(result) {
  return (result?.searches || []).map((search) => ({
    query: search.query,
    evidence_strength: search.evidence_strength,
    primary_article: search.primary_article ? {
      article_id: search.primary_article.article_id,
      title: search.primary_article.title,
      category: search.primary_article.category,
    } : null,
  }));
}

async function runTrainingAgent(trainingId, question, isFirstTurn, customerDomain = "") {
  return runHelpdeskAgent({
    sessionId: trainingThreadId(trainingId),
    customerId: null,
    question,
    attachments: [],
    isFirstTurn,
    memoryContext: { text: "", source: "none", items: 0 },
    trainingMode: true,
    customerDomain,
  });
}

async function touchSession(db, trainingId) {
  await db.collection(env.trainingSessionCollection).updateOne(
    { training_id: trainingId },
    { $set: { updated_at: now() } }
  );
}

export async function sendTrainingMessage({ trainingId, helpdeskUser, question }) {
  const { db, session } = await getOwnedSession(trainingId, helpdeskUser.helpdesk_id);
  if (session.status !== "active") throw invalid("Training session sudah ditutup.");
  const existingMessages = await readMessages(db, trainingId);
  const customerDomain = extractTrainingDomain(question) || session.customer_domain || "";
  if (customerDomain !== (session.customer_domain || "")) {
    await db.collection(env.trainingSessionCollection).updateOne(
      { training_id: trainingId },
      { $set: { customer_domain: customerDomain } },
    );
  }
  const helpdeskMessage = await appendMessage(db, {
    trainingId,
    role: "helpdesk",
    content: question,
  });
  const result = await runTrainingAgent(trainingId, cleanText(question, 4000), existingMessages.length === 0, customerDomain);
  const assistantMessage = await appendMessage(db, {
    trainingId,
    role: "assistant",
    content: result.answer,
    metadata: {
      knowledge_used: knowledgeMetadata(result),
      runtime_meta: result.runtimeMeta,
      site_check: result.runtimeMeta?.site_check || null,
    },
  });
  await touchSession(db, trainingId);
  return {
    session: serializeSession({ ...session, customer_domain: customerDomain, updated_at: assistantMessage.created_at }, [...existingMessages, helpdeskMessage, assistantMessage]),
    assistant: assistantMessage,
  };
}

export async function sendTrainingCorrection({ trainingId, helpdeskUser, correction, messageId = "" }) {
  const { db, session } = await getOwnedSession(trainingId, helpdeskUser.helpdesk_id);
  if (session.status !== "active") throw invalid("Training session sudah ditutup.");
  const existingMessages = await readMessages(db, trainingId);
  const customerDomain = session.customer_domain || "";
  const targetMessage = messageId
    ? existingMessages.find((message) => message._id === messageId && message.role === "assistant")
    : [...existingMessages].reverse().find((message) => message.role === "assistant");
  if (!targetMessage) throw invalid("Jawaban NAVA yang akan dikoreksi tidak ditemukan.");
  const correctionText = cleanText(correction, 4000);
  const evaluatedAt = now();
  if (ObjectId.isValid(targetMessage._id)) {
    await db.collection(env.trainingMessageCollection).updateOne(
      { _id: new ObjectId(targetMessage._id), training_id: trainingId, role: "assistant" },
      { $set: { "metadata.evaluation": "needs_correction", "metadata.evaluated_at": evaluatedAt } },
    );
  }
  const correctionMessage = await appendMessage(db, {
    trainingId,
    role: "correction",
    content: correctionText,
    metadata: { corrects_message_id: targetMessage._id },
  });
  const agentPrompt = [
    "KOREKSI HELPDESK — jadikan isi berikut sebagai ground truth untuk training ini.",
    correctionText,
    `Koreksi ini ditujukan untuk jawaban NAVA: "${cleanText(targetMessage.content, 3000)}".`,
    "Gunakan koreksi tersebut bersama history training. Jawab ulang pertanyaan terkait secara ringkas dan tepat. Jangan mempertahankan jawaban lama jika bertentangan dengan koreksi.",
  ].join("\n\n");
  const result = await runTrainingAgent(trainingId, agentPrompt, false, customerDomain);
  const assistantMessage = await appendMessage(db, {
    trainingId,
    role: "assistant",
    content: result.answer,
    metadata: {
      knowledge_used: knowledgeMetadata(result),
      runtime_meta: result.runtimeMeta,
      site_check: result.runtimeMeta?.site_check || null,
      corrected_from_helpdesk: true,
    },
  });
  await touchSession(db, trainingId);
  const evaluatedMessages = existingMessages.map((message) => message._id === targetMessage._id
    ? { ...message, metadata: { ...message.metadata, evaluation: "needs_correction", evaluated_at: evaluatedAt } }
    : message);
  return {
    session: serializeSession({ ...session, customer_domain: customerDomain, updated_at: assistantMessage.created_at }, [...evaluatedMessages, correctionMessage, assistantMessage]),
    assistant: assistantMessage,
  };
}

export async function markTrainingMessage({ trainingId, helpdeskUser, messageId, verdict }) {
  const { db } = await getOwnedSession(trainingId, helpdeskUser.helpdesk_id);
  if (!ObjectId.isValid(messageId)) throw invalid("Message training tidak valid.");
  if (!["correct", "needs_correction"].includes(verdict)) throw invalid("Penilaian training tidak valid.");
  const result = await db.collection(env.trainingMessageCollection).findOneAndUpdate(
    { _id: new ObjectId(messageId), training_id: trainingId, role: "assistant" },
    { $set: { "metadata.evaluation": verdict, "metadata.evaluated_at": now() } },
    { returnDocument: "after", maxTimeMS: 5000 }
  );
  if (!result) throw notFound("Jawaban NAVA yang akan dinilai tidak ditemukan.");
  return serializeMessage(result);
}

function trainingConversationForPrompt(messages) {
  return messages.slice(-MAX_TRAINING_MESSAGES_FOR_DRAFT).map((message) => ({
    role: message.role,
    content: cleanText(message.content, 3000),
  }));
}

function knowledgeReferenceIds(messages) {
  const references = new Map();
  for (const message of messages) {
    for (const item of message.metadata?.knowledge_used || []) {
      const article = item.primary_article;
      if (article?.article_id) references.set(article.article_id, true);
    }
  }
  return [...references.keys()];
}

async function loadKnowledgeReferences(db, messages) {
  const articleIds = knowledgeReferenceIds(messages);
  if (!articleIds.length) return [];
  return db.collection(env.knowledgeCollection)
    .find({
      articleId: { $in: articleIds },
      $or: [{ status: "published" }, { status: { $exists: false } }],
    }, { projection: { embedding: 0 }, maxTimeMS: 5000 })
    .toArray();
}

function getDraftModel() {
  if (!draftModel) {
    draftModel = new ChatDeepSeek({
      apiKey: env.deepseekApiKey,
      model: env.deepseekModel,
      temperature: 0,
      maxRetries: 1,
      timeout: env.deepseekTimeoutMs,
    });
  }
  return draftModel;
}

function draftPrompt(messages, references) {
  return [
    "Anda membantu Helpdesk mengekstrak kandidat knowledge dari Chat Training internal NAVA.",
    "Koreksi Helpdesk adalah ground truth tertinggi. Jangan membuat nama menu, prosedur, penyebab, atau fakta baru yang tidak dikonfirmasi.",
    "Published knowledge hanya referensi tambahan, bukan alasan untuk mengabaikan koreksi Helpdesk.",
    "Tentukan dahulu apakah percakapan ini memiliki pola atau prosedur reusable untuk customer. Jika tidak cukup kuat, set should_create_draft=false dan draft=null.",
    "Jika informasi masih kontradiktif atau belum dikonfirmasi, set should_create_draft=false dan isi missing_confirmation.",
    "Jika cukup kuat, hasilkan JSON valid saja dengan bentuk berikut:",
    JSON.stringify({
      should_create_draft: true,
      missing_confirmation: [],
      summary: {
        context: "",
        customer_question: "",
        previous_answer_issue: "",
        helpdesk_corrections: [],
        confirmed_conclusion: "",
        solution_steps: [],
        reusable_knowledge: "",
      },
      draft: {
        title: "",
        category: "",
        product: "nagagold",
        clientScope: ["all"],
        symptoms: [],
        troubleshootingSteps: [{ order: 1, title: "", instruction: "", expectedResult: "" }],
        userResponseTemplate: "",
        tags: [],
        internalNotes: "",
        escalationRules: [],
      },
    }),
    "Jangan mengisi clarificationQuestions. Isi internalNotes dengan catatan validasi jika diperlukan.",
    `PUBLISHED KNOWLEDGE YANG TERPAKAI:\n${JSON.stringify(references)}`,
    `TRAINING CONVERSATION:\n${JSON.stringify(trainingConversationForPrompt(messages))}`,
  ].join("\n\n");
}

function normalizeSummary(raw = {}) {
  return {
    context: cleanText(raw.context, 3000),
    customer_question: cleanText(raw.customer_question, 3000),
    previous_answer_issue: cleanText(raw.previous_answer_issue, 3000),
    helpdesk_corrections: stringList(raw.helpdesk_corrections, 20, 1500),
    confirmed_conclusion: cleanText(raw.confirmed_conclusion, 3000),
    solution_steps: stringList(raw.solution_steps, 30, 1500),
    reusable_knowledge: cleanText(raw.reusable_knowledge, 3000),
  };
}

export async function generateTrainingKnowledge({ trainingId, helpdeskUser }) {
  const { db, session } = await getOwnedSession(trainingId, helpdeskUser.helpdesk_id);
  const messages = await readMessages(db, trainingId);
  if (messages.length < 2) throw invalid("Percakapan training belum cukup untuk membuat kandidat knowledge.");
  const references = await loadKnowledgeReferences(db, messages);

  const raw = parseJsonObject((await getDraftModel().invoke([
    {
      role: "system",
      content: "Jawab hanya dengan JSON valid. Gunakan bahasa Indonesia.",
    },
    { role: "user", content: draftPrompt(messages, references) },
  ])).content);
  const summary = normalizeSummary(raw.summary);
  const draft = raw.should_create_draft === true ? normalizeDraft(raw.draft) : null;
  const missingConfirmation = stringList(raw.missing_confirmation, 20, 1000);

  if (!draft || !draft.title || !draft.userResponseTemplate || !draft.troubleshootingSteps.length || missingConfirmation.length) {
    return {
      can_save: false,
      summary,
      missing_confirmation: missingConfirmation.length ? missingConfirmation : ["Kesimpulan atau langkah solusi belum cukup kuat untuk dijadikan knowledge."],
      draft: null,
      duplicate_candidates: [],
      training_id: session.training_id,
    };
  }

  const duplicateQuery = [draft.title, draft.category, ...draft.symptoms, ...draft.tags].filter(Boolean).join(" ");
  const duplicateSearch = await retrieveKnowledge(duplicateQuery, { topK: 5 });
  const duplicateCandidates = (duplicateSearch.found ? duplicateSearch.documents : [])
    .slice(0, 3)
    .map((article) => ({
      article_id: article.articleId,
      title: article.title,
      category: article.category,
      product: article.product,
      confidence: duplicateSearch.confidence,
      evidence_strength: article.retrieval?.evidenceStrength || "weak",
    }));

  return {
    can_save: true,
    summary,
    missing_confirmation: [],
    draft,
    duplicate_candidates: duplicateCandidates,
    training_id: session.training_id,
  };
}

export async function saveTrainingDraft({ trainingId, helpdeskUser, draft, action = "new", existingArticleId = "" }) {
  const { db, session } = await getOwnedSession(trainingId, helpdeskUser.helpdesk_id);
  if (session.knowledge_draft_id) {
    const existingDraft = await getKnowledgeArticle(session.knowledge_draft_id);
    if (existingDraft) return existingDraft;
  }
  if (!draft || !cleanText(draft.title, 300) || !cleanText(draft.userResponseTemplate, 4000)) {
    throw invalid("Draft knowledge belum lengkap untuk disimpan.");
  }
  if (!["new", "update_existing"].includes(action)) throw invalid("Pilihan draft knowledge tidak valid.");

  if (action === "update_existing") {
    if (!existingArticleId) throw invalid("Artikel existing untuk draft update belum dipilih.");
    const existing = await getKnowledgeArticle(existingArticleId);
    if (!existing) throw notFound("Knowledge existing yang dipilih tidak ditemukan.");
  }

  const source = {
    type: "chat_training",
    training_id: trainingId,
    created_by_helpdesk_id: helpdeskUser.helpdesk_id,
    created_by_helpdesk_name: helpdeskUser.name,
    ...(action === "update_existing" && existingArticleId ? { supersedes_article_id: existingArticleId } : {}),
  };
  const article = await createKnowledgeArticle({ ...normalizeDraft(draft), source }, helpdeskUser);
  await db.collection(env.trainingSessionCollection).updateOne(
    { training_id: trainingId },
    { $set: { knowledge_draft_id: article.articleId, updated_at: now() } }
  );
  return article;
}

export async function closeTrainingSession({ trainingId, helpdeskUser }) {
  const { db, session } = await getOwnedSession(trainingId, helpdeskUser.helpdesk_id);
  await db.collection(env.trainingSessionCollection).updateOne(
    { training_id: trainingId },
    { $set: { status: "closed", updated_at: now() } }
  );
  return serializeSession({ ...session, status: "closed", updated_at: now() }, await readMessages(db, trainingId));
}

export const __trainingInternals = {
  extractTrainingDomain,
};
