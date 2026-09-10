import { MongoClient } from "mongodb";
import { env } from "../config/env.js";

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

function isAlreadyExistsError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("already exists") || message.includes("indexalreadyexists");
}

export async function ensureVectorSearchIndex() {
  if (!env.vectorSearchEnabled) {
    return { enabled: false, created: false, reason: "disabled" };
  }

  const db = await getDb();

  try {
    await db.command({
      createSearchIndexes: env.knowledgeCollection,
      indexes: [
        {
          name: env.vectorIndexName,
          type: "vectorSearch",
          definition: {
            fields: [
              {
                type: "vector",
                path: env.vectorField,
                numDimensions: env.embeddingDimensions,
                similarity: "cosine",
              },
            ],
          },
        },
      ],
    });

    return { enabled: true, created: true, name: env.vectorIndexName };
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return { enabled: true, created: false, name: env.vectorIndexName, reason: "already-exists" };
    }

    // Vector retrieval tetap memiliki fallback lexical. Jangan membuat API mati hanya
    // karena search index belum READY / user DB tidak punya hak membuat search index.
    console.warn(`Vector index belum bisa dibuat otomatis: ${error?.message || error}`);
    return {
      enabled: true,
      created: false,
      name: env.vectorIndexName,
      reason: "create-failed",
      error: error?.message || String(error),
    };
  }
}

export async function ensureIndexes() {
  const db = await getDb();
  const knowledge = db.collection(env.knowledgeCollection);
  const chat = db.collection(env.chatCollection);
  const trace = db.collection(env.agentTraceCollection);
  const longTermMemory = db.collection(env.longTermMemoryCollection);
  const tickets = db.collection(env.ticketCollection);
  const helpdeskUsers = db.collection(env.helpdeskUserCollection);

  await knowledge.createIndex({ articleId: 1 }, { unique: true, name: "article_id_unique" });
  await knowledge.createIndex({ status: 1, updated_at: -1 }, { name: "knowledge_status_updated" });
  await knowledge.createIndex({ category: 1, status: 1 }, { name: "knowledge_category_status" });

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
  await helpdeskUsers.createIndex({ helpdesk_id: 1 }, { unique: true, name: "helpdesk_user_id_unique" });

  if (env.longTermMemoryEnabled) {
    try {
      await longTermMemory.createIndex({ "namespace.0": 1, key: 1 }, { name: "nava_memory_namespace_key" });
    } catch {
      // MongoDBStore dapat mengelola collection-nya sendiri; index ini hanya optimasi tambahan.
    }
  }

  return ensureVectorSearchIndex();
}
