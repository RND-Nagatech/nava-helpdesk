import crypto from "node:crypto";
import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";
import { runHelpdeskAgent } from "../agents/helpdesk-agent.js";
import { normalizeInvestigationDomain } from "./investigation-service.js";

const ROLES = new Set(["helpdesk", "assistant"]);

function now() {
  return new Date();
}

function clean(value, max = 12000) {
  return String(value || "").trim().slice(0, max);
}

function invalid(message) {
  const error = new Error(message);
  error.code = "INVESTIGATION_INVALID";
  error.statusCode = 400;
  return error;
}

function notFound() {
  const error = new Error("Session investigasi tidak ditemukan.");
  error.code = "INVESTIGATION_NOT_FOUND";
  error.statusCode = 404;
  return error;
}

function createInvestigationId(date = new Date()) {
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
  return "INV-" + stamp + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
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

function serializeSession(doc, messages = []) {
  return {
    training_id: doc.training_id,
    helpdesk_id: doc.helpdesk_id,
    helpdesk_name: doc.helpdesk_name,
    title: doc.title,
    status: doc.status,
    room_type: "investigation",
    customer_domain: doc.customer_domain || "",
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    messages,
  };
}

async function readMessages(db, trainingId) {
  const rows = await db.collection(env.trainingMessageCollection)
    .find({ training_id: trainingId, room_type: "investigation" }, { maxTimeMS: 5000 })
    .sort({ created_at: 1, _id: 1 })
    .toArray();
  return rows.map(serializeMessage);
}

async function getOwnedSession(trainingId, helpdeskId) {
  const db = await getDb();
  const session = await db.collection(env.trainingSessionCollection).findOne({
    training_id: trainingId,
    helpdesk_id: helpdeskId,
    room_type: "investigation",
  }, { maxTimeMS: 5000 });
  if (!session) throw notFound();
  return { db, session };
}

async function appendMessage(db, { trainingId, role, content, metadata = {} }) {
  if (!ROLES.has(role)) throw invalid("Role message investigasi tidak valid.");
  const doc = {
    training_id: trainingId,
    room_type: "investigation",
    role,
    content: clean(content),
    metadata,
    created_at: now(),
  };
  const result = await db.collection(env.trainingMessageCollection).insertOne(doc);
  return serializeMessage({ ...doc, _id: result.insertedId });
}

async function closeActiveSessions(db, helpdeskId, exceptId = "") {
  await db.collection(env.trainingSessionCollection).updateMany(
    {
      helpdesk_id: helpdeskId,
      room_type: "investigation",
      status: "active",
      ...(exceptId ? { training_id: { $ne: exceptId } } : {}),
    },
    { $set: { status: "closed", updated_at: now() } },
  );
}

function domainFromText(value) {
  const match = String(value || "").match(/(?:https?:\/\/)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.goldstore\.id\b/i);
  if (!match) return "";
  try {
    return normalizeInvestigationDomain(match[0]);
  } catch {
    return "";
  }
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

export async function createInvestigationSession(helpdeskUser) {
  const db = await getDb();
  await closeActiveSessions(db, helpdeskUser.helpdesk_id);
  const createdAt = now();
  const doc = {
    training_id: createInvestigationId(createdAt),
    helpdesk_id: helpdeskUser.helpdesk_id,
    helpdesk_name: helpdeskUser.name,
    title: "Investigasi Helpdesk baru",
    room_type: "investigation",
    status: "active",
    customer_domain: "",
    created_at: createdAt,
    updated_at: createdAt,
  };
  await db.collection(env.trainingSessionCollection).insertOne(doc);
  return serializeSession(doc, []);
}

export async function getInvestigationSession(trainingId, helpdeskUser) {
  const { db, session } = await getOwnedSession(trainingId, helpdeskUser.helpdesk_id);
  return serializeSession(session, await readMessages(db, trainingId));
}

export async function listInvestigationSessions(helpdeskUser, limit = 20) {
  const db = await getDb();
  const rows = await db.collection(env.trainingSessionCollection)
    .find({ helpdesk_id: helpdeskUser.helpdesk_id, room_type: "investigation" }, { maxTimeMS: 5000 })
    .sort({ status: 1, updated_at: -1, _id: -1 })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 50))
    .toArray();
  return rows.map((row) => serializeSession(row, []));
}

export async function sendInvestigationMessage({ trainingId, helpdeskUser, question, domain = "" }) {
  const { db, session } = await getOwnedSession(trainingId, helpdeskUser.helpdesk_id);
  if (session.status !== "active") throw invalid("Session investigasi sudah ditutup.");

  const existingMessages = await readMessages(db, trainingId);
  let customerDomain = session.customer_domain || "";
  if (domain) customerDomain = normalizeInvestigationDomain(domain);
  if (!customerDomain) customerDomain = domainFromText(question);

  if (customerDomain !== (session.customer_domain || "")) {
    await db.collection(env.trainingSessionCollection).updateOne(
      { training_id: trainingId, room_type: "investigation" },
      { $set: { customer_domain: customerDomain, updated_at: now() } },
    );
  }

  const helpdeskMessage = await appendMessage(db, {
    trainingId,
    role: "helpdesk",
    content: question,
    metadata: { domain: customerDomain || null },
  });

  const result = await runHelpdeskAgent({
    sessionId: "investigation:" + trainingId,
    customerId: null,
    question: clean(question, 4000),
    attachments: [],
    isFirstTurn: existingMessages.length === 0,
    memoryContext: { text: "", source: "none", items: 0 },
    trainingMode: false,
    investigationMode: true,
    customerDomain,
    helpdeskId: helpdeskUser.helpdesk_id,
  });

  const assistantMessage = await appendMessage(db, {
    trainingId,
    role: "assistant",
    content: result.answer,
    metadata: {
      knowledge_used: knowledgeMetadata(result),
      runtime_meta: result.runtimeMeta,
      database_checks: (result.toolTrace || []).filter((item) => item.name === "inspect_customer_database").map((item) => item.result),
    },
  });

  await db.collection(env.trainingSessionCollection).updateOne(
    { training_id: trainingId, room_type: "investigation" },
    { $set: { updated_at: assistantMessage.created_at } },
  );

  return {
    session: serializeSession(
      { ...session, customer_domain: customerDomain, updated_at: assistantMessage.created_at },
      [...existingMessages, helpdeskMessage, assistantMessage],
    ),
    assistant: assistantMessage,
  };
}

export async function closeInvestigationSession({ trainingId, helpdeskUser }) {
  const { db, session } = await getOwnedSession(trainingId, helpdeskUser.helpdesk_id);
  await db.collection(env.trainingSessionCollection).updateOne(
    { training_id: trainingId, helpdesk_id: helpdeskUser.helpdesk_id, room_type: "investigation" },
    { $set: { status: "closed", updated_at: now() } },
  );
  return serializeSession({ ...session, status: "closed", updated_at: now() }, await readMessages(db, trainingId));
}
