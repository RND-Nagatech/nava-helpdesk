import { MongoDBSaver, MongoDBStore } from "@langchain/langgraph-checkpoint-mongodb";
import { env } from "../config/env.js";
import { getMongoClient, getDb } from "../database/mongodb.js";

let checkpointer;
let longTermStore;
let initialized = false;

export async function initializeAgentMemory() {
  if (initialized) return { checkpointer, store: longTermStore };

  const client = await getMongoClient();

  if (env.checkpointerEnabled) {
    checkpointer = new MongoDBSaver({
      client,
      dbName: env.mongodbDb,
      checkpointCollectionName: env.checkpointCollection,
      checkpointWritesCollectionName: env.checkpointWritesCollection,
      ...(env.checkpointTtlSeconds > 0 ? { ttl: env.checkpointTtlSeconds } : {}),
    });

    // setup() idempotent. Pada package terbaru ini terutama menyiapkan index yang dibutuhkan.
    if (typeof checkpointer.setup === "function") {
      try {
        await checkpointer.setup();
      } catch (error) {
        // Jangan membuat seluruh helpdesk mati hanya karena index opsional gagal dibuat.
        // Checkpoint write/read masih akan dicoba pada runtime dan error nyata tetap muncul.
        console.warn(`Checkpointer setup warning: ${error?.message || error}`);
      }
    }
  }

  if (env.longTermMemoryEnabled) {
    longTermStore = new MongoDBStore({
      client,
      dbName: env.mongodbDb,
      collectionName: env.longTermMemoryCollection,
    });
  }

  initialized = true;
  return { checkpointer, store: longTermStore };
}

export function getAgentCheckpointer() {
  return checkpointer;
}

export function getLongTermStore() {
  return longTermStore;
}

export async function deleteAgentThread(threadId) {
  if (!threadId) return;

  if (checkpointer && typeof checkpointer.deleteThread === "function") {
    await checkpointer.deleteThread(threadId);
    return;
  }

  // Fallback defensif bila versi package tidak mengekspos deleteThread.
  const db = await getDb();
  await Promise.all([
    db.collection(env.checkpointCollection).deleteMany({ thread_id: threadId }),
    db.collection(env.checkpointWritesCollection).deleteMany({ thread_id: threadId }),
  ]);
}
