import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";

export async function hasSessionMessages(sessionId) {
  const db = await getDb();
  const row = await db.collection(env.chatCollection).findOne(
    { session_id: sessionId },
    { projection: { _id: 1 }, maxTimeMS: 5000 }
  );
  return Boolean(row);
}

function compactGroundedAnswer(row) {
  const runtime = row?.metadata?.runtime_meta || {};
  if (!runtime.primary_article_id) return null;

  const text = String(row.content || "").replace(/\s+/g, " ").trim();
  return {
    answer: text.slice(0, env.crossSessionAnswerMaxChars),
    primary_article_id: runtime.primary_article_id,
    primary_article_title: runtime.primary_article_title || null,
    evidence_strength: runtime.evidence_strength || null,
  };
}

export async function getCrossSessionContext({ customerId, currentSessionId }) {
  if (!env.crossSessionContextEnabled || !customerId) return [];

  const db = await getDb();
  const rows = await db
    .collection(env.chatCollection)
    .find({
      customer_id: customerId,
      session_id: { $ne: currentSessionId },
    }, { maxTimeMS: 5000 })
    .sort({ created_at: -1 })
    .limit(env.crossSessionHistoryLimit * 3)
    .toArray();

  const items = [];
  for (const row of rows) {
    if (items.length >= env.crossSessionHistoryLimit) break;

    if (row.role === "user") {
      const text = String(row.content || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      items.push({
        session_id: row.session_id,
        role: "user",
        content: text.slice(0, env.crossSessionMessageMaxChars),
        created_at: row.created_at,
      });
      continue;
    }

    if (row.role === "assistant") {
      const grounded = compactGroundedAnswer(row);
      if (!grounded) continue;
      items.push({
        session_id: row.session_id,
        role: "assistant_grounded",
        content: grounded.answer,
        primary_article_id: grounded.primary_article_id,
        primary_article_title: grounded.primary_article_title,
        evidence_strength: grounded.evidence_strength,
        created_at: row.created_at,
      });
    }
  }

  return items.reverse();
}

export async function saveChatMessage({ sessionId, customerId = null, role, content, metadata = {} }) {
  const db = await getDb();
  const doc = {
    session_id: sessionId,
    customer_id: customerId || null,
    role,
    content,
    metadata,
    created_at: new Date(),
  };
  const result = await db.collection(env.chatCollection).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function getChatMessages(sessionId, { limit = 50 } = {}) {
  const db = await getDb();
  const rows = await db
    .collection(env.chatCollection)
    .find({ session_id: sessionId }, { maxTimeMS: 5000 })
    .sort({ created_at: -1 })
    .limit(Math.min(Math.max(Number(limit || 50), 1), 100))
    .toArray();
  return rows.reverse();
}

export async function getSessionMessagePage(sessionId, { limit = 50, before = "" } = {}) {
  const pageSize = Math.min(Math.max(Number(limit || 50), 1), 100);
  const query = { session_id: sessionId };
  if (before) {
    const beforeDate = new Date(before);
    if (!Number.isNaN(beforeDate.getTime())) query.created_at = { $lt: beforeDate };
  }

  const db = await getDb();
  const rows = await db
    .collection(env.chatCollection)
    .find(query, {
      projection: {
        _id: 1,
        session_id: 1,
        customer_id: 1,
        role: 1,
        content: 1,
        "metadata.attachments": 1,
        "metadata.helpdesk_name": 1,
        created_at: 1,
      },
      maxTimeMS: 5000,
    })
    .sort({ created_at: -1 })
    .limit(pageSize + 1)
    .toArray();

  const hasMore = rows.length > pageSize;
  const items = rows.slice(0, pageSize).reverse();
  return {
    items,
    has_more: hasMore,
    next_cursor: items.length ? items[0].created_at.toISOString() : null,
  };
}

export async function getLastChatMessage(sessionId) {
  const db = await getDb();
  return db
    .collection(env.chatCollection)
    .find({ session_id: sessionId }, { maxTimeMS: 5000 })
    .sort({ created_at: -1 })
    .limit(1)
    .next();
}

export async function getLastChatMessagesBySession(sessionIds) {
  const ids = [...new Set((sessionIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const db = await getDb();
  const rows = await db.collection(env.chatCollection).aggregate([
    { $match: { session_id: { $in: ids } } },
    { $sort: { created_at: -1 } },
    { $group: { _id: "$session_id", message: { $first: "$content" } } },
    { $project: { _id: 0, session_id: "$_id", content: "$message" } },
  ], { maxTimeMS: 5000 }).toArray();

  return new Map(rows.filter(Boolean).map((row) => [row.session_id, row]));
}

export async function deleteChatSession(sessionId) {
  const db = await getDb();
  return db.collection(env.chatCollection).deleteMany({ session_id: sessionId });
}
