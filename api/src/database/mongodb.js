import { MongoClient } from "mongodb";
import { env } from "../config/env.js";
import { ensureVectorCollection, syncKnowledgeVectors } from "./qdrant.js";

let client;
let database;

export async function connectMongo() {
  if (database) return database;
  if (!env.mongodbUri) {
    throw new Error("MONGODB_URI belum diisi.");
  }

  client = new MongoClient(env.mongodbUri, {
    maxPoolSize: 20,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10000,
  });

  await client.connect();
  database = client.db(env.mongodbDb);
  return database;
}

export async function getDb() {
  return database || connectMongo();
}

export async function getMongoClient() {
  if (!client) await connectMongo();
  return client;
}

export async function closeMongo() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
}

export async function ensureVectorSearchIndex() {
  return ensureVectorCollection();
}

export async function reconcileKnowledgeVectors() {
  if (!env.vectorSearchEnabled) {
    return { enabled: false, upserted: 0, deleted: 0, reason: "disabled" };
  }

  const db = await getDb();
  const docs = await db.collection(env.knowledgeCollection).find({}, {
    projection: {
      articleId: 1,
      status: 1,
      embedding: 1,
      embedding_model: 1,
      embedding_profile: 1,
      siteScope: 1,
    },
  }).toArray();
  return syncKnowledgeVectors(docs);
}

export async function ensureIndexes() {
  const db = await getDb();
  const knowledge = db.collection(env.knowledgeCollection);
  const chat = db.collection(env.chatCollection);
  const trainingSessions = db.collection(env.trainingSessionCollection);
  const trainingMessages = db.collection(env.trainingMessageCollection);
  const trace = db.collection(env.agentTraceCollection);
  const longTermMemory = db.collection(env.longTermMemoryCollection);
  const tickets = db.collection(env.ticketCollection);
  const helpdeskUsers = db.collection(env.helpdeskUserCollection);

  await knowledge.createIndex({ articleId: 1 }, { unique: true, name: "article_id_unique" });
  await knowledge.createIndex({ status: 1, updated_at: -1 }, { name: "knowledge_status_updated" });
  await knowledge.createIndex({ category: 1, status: 1 }, { name: "knowledge_category_status" });
  await knowledge.createIndex({ "siteScope.domain": 1, "siteScope.frontendVersion": 1, "siteScope.backendVersion": 1 }, { name: "knowledge_site_scope" });

  // Lexical retrieval tetap dipertahankan sebagai bagian dari hybrid search dan fallback.
  try {
    await knowledge.createIndex(
      {
        title: "text",
        symptoms: "text",
        tags: "text",
        userResponseTemplate: "text",
        "troubleshootingSteps.instruction": "text",
        category: "text",
      },
      {
        name: "knowledge_text_search",
        default_language: "none",
        weights: {
          title: 10,
          symptoms: 8,
          tags: 6,
          userResponseTemplate: 5,
          "troubleshootingSteps.instruction": 4,
          category: 2,
        },
      }
    );
  } catch (error) {
    if (!String(error?.message || "").toLowerCase().includes("text index")) throw error;
  }

  await chat.createIndex(
    { session_id: 1, created_at: 1 },
    { name: "chat_session_created_at" }
  );
  await chat.createIndex(
    { session_id: 1, created_at: -1 },
    { name: "chat_session_created_at_desc" }
  );

  await chat.createIndex(
    { customer_id: 1, created_at: -1 },
    { name: "chat_customer_created_at" }
  );
  await chat.createIndex({ role: 1, created_at: -1 }, { name: "chat_role_created_at" });

  await trainingSessions.createIndex({ training_id: 1 }, { unique: true, name: "training_id_unique" });
  await trainingSessions.createIndex({ helpdesk_id: 1, updated_at: -1 }, { name: "training_helpdesk_updated" });
  await trainingMessages.createIndex({ training_id: 1, created_at: 1 }, { name: "training_messages_created_at" });
  await trainingMessages.createIndex({ training_id: 1, role: 1, created_at: 1 }, { name: "training_messages_role_created_at" });

  await trace.createIndex(
    { session_id: 1, created_at: -1 },
    { name: "agent_trace_session_created_at" }
  );
  await trace.createIndex(
    { created_at: -1 },
    { name: "agent_trace_created_at" }
  );
  await trace.createIndex(
    { run_id: 1 },
    { unique: true, name: "agent_trace_run_id_unique" }
  );

  await tickets.createIndex({ ticket_code: 1 }, { unique: true, name: "ticket_code_unique" });
  await tickets.createIndex({ session_id: 1, status: 1 }, { name: "ticket_session_status" });
  await tickets.createIndex({ status: 1, handover_status: 1, created_at: -1 }, { name: "ticket_status_handover_created" });
  await tickets.createIndex({ created_at: -1 }, { name: "ticket_created_at" });
  await tickets.createIndex({ created_at: -1, status: 1 }, { name: "ticket_created_status" });
  await tickets.createIndex({ created_at: -1, assigned_helpdesk_id: 1 }, { name: "ticket_created_assignee" });
  await tickets.createIndex({ status: 1, last_message_at: -1 }, { name: "ticket_status_last_message" });
  await tickets.createIndex({ assigned_helpdesk_id: 1, status: 1, last_message_at: -1 }, { name: "ticket_assignment_status_last_message" });
  await tickets.createIndex(
    { handover_status: 1, status: 1, assigned_helpdesk_id: 1 },
    { name: "ticket_handover_count" }
  );
  await helpdeskUsers.createIndex({ helpdesk_id: 1 }, { unique: true, name: "helpdesk_user_id_unique" });

  if (env.longTermMemoryEnabled) {
    try {
      await longTermMemory.createIndex({ "namespace.0": 1, key: 1 }, { name: "nava_memory_namespace_key" });
    } catch {
      // MongoDBStore dapat mengelola collection-nya sendiri; index ini hanya optimasi tambahan.
    }
  }

  return ensureVectorCollection();
}
