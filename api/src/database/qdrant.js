import crypto from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../config/env.js";

let client;

function getClient() {
  if (!client) {
    client = new QdrantClient({
      url: env.qdrantUrl,
      ...(env.qdrantApiKey ? { apiKey: env.qdrantApiKey } : {}),
      timeout: env.qdrantTimeoutMs,
      checkCompatibility: false,
    });
  }
  return client;
}

function errorMessage(error) {
  return error?.message || String(error);
}

function isNotFoundError(error) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("404") || message.includes("not found") || message.includes("doesn't exist");
}

function isAlreadyExistsError(error) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("already exists") || message.includes("409");
}

async function ensureStatusPayloadIndex(qdrant) {
  try {
    await qdrant.createPayloadIndex(env.qdrantCollection, {
      field_name: "status",
      field_schema: "keyword",
      wait: true,
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }
}

export function qdrantPointId(articleId) {
  const hash = crypto.createHash("sha256").update(String(articleId)).digest("hex").slice(0, 32).split("");
  hash[12] = "5";
  hash[16] = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8).join("")}-${hash.slice(8, 12).join("")}-${hash.slice(12, 16).join("")}-${hash.slice(16, 20).join("")}-${hash.slice(20).join("")}`;
}

export async function ensureVectorCollection() {
  if (!env.vectorSearchEnabled) {
    return { enabled: false, created: false, reason: "disabled" };
  }

  try {
    const qdrant = getClient();
    let exists = false;
    try {
      const existence = await qdrant.collectionExists(env.qdrantCollection);
      exists = Boolean(existence?.exists);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    if (exists) {
      const info = await qdrant.getCollection(env.qdrantCollection);
      const configured = info?.config?.params?.vectors;
      const size = configured?.size;
      const distance = String(configured?.distance || "").toLowerCase();
      if (size !== env.embeddingDimensions || distance !== "cosine") {
        throw new Error(
          `Konfigurasi collection Qdrant tidak sesuai: size=${size}, distance=${configured?.distance}. ` +
          `Diharapkan size=${env.embeddingDimensions}, distance=Cosine.`
        );
      }
      await ensureStatusPayloadIndex(qdrant);
      return { enabled: true, created: false, name: env.qdrantCollection, reason: "already-exists" };
    }

    await qdrant.createCollection(env.qdrantCollection, {
      vectors: {
        size: env.embeddingDimensions,
        distance: "Cosine",
      },
    });

    await ensureStatusPayloadIndex(qdrant);

    return { enabled: true, created: true, name: env.qdrantCollection };
  } catch (error) {
    console.warn(`Qdrant belum siap: ${errorMessage(error)}`);
    return {
      enabled: true,
      created: false,
      name: env.qdrantCollection,
      reason: "create-failed",
      error: errorMessage(error),
    };
  }
}

export async function getVectorStoreStatus() {
  if (!env.vectorSearchEnabled) {
    return {
      enabled: false,
      ok: false,
      collection: env.qdrantCollection,
      reason: "disabled",
    };
  }

  try {
    const info = await getClient().getCollection(env.qdrantCollection);
    const configured = info?.config?.params?.vectors;
    return {
      enabled: true,
      ok: true,
      collection: env.qdrantCollection,
      points: info?.points_count ?? null,
      size: configured?.size ?? null,
      distance: configured?.distance ?? null,
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      collection: env.qdrantCollection,
      reason: errorMessage(error),
    };
  }
}

function toPoint(doc) {
  if (!doc?.articleId || !Array.isArray(doc[env.vectorField])) return null;
  if (doc[env.vectorField].length !== env.embeddingDimensions) {
    throw new Error(`Embedding artikel ${doc.articleId} bukan ${env.embeddingDimensions} dimensi.`);
  }

  return {
    id: qdrantPointId(doc.articleId),
    vector: doc[env.vectorField],
    payload: {
      articleId: doc.articleId,
      status: doc.status || "published",
      embeddingModel: doc.embedding_model || env.embeddingModel,
      embeddingProfile: doc.embedding_profile || env.embeddingProfile,
    },
  };
}

async function scrollPointIds(qdrant) {
  const ids = [];
  let offset;
  do {
    const page = await qdrant.scroll(env.qdrantCollection, {
      limit: 1000,
      ...(offset !== undefined ? { offset } : {}),
      with_payload: false,
      with_vector: false,
    });
    ids.push(...(page.points || []).map((point) => point.id));
    offset = page.next_page_offset;
  } while (offset !== undefined && offset !== null);
  return ids;
}

export async function syncKnowledgeVectors(docs) {
  if (!env.vectorSearchEnabled) {
    return { enabled: false, upserted: 0, deleted: 0, reason: "disabled" };
  }

  const collectionResult = await ensureVectorCollection();
  if (collectionResult.reason === "create-failed") {
    throw new Error(collectionResult.error || "Collection Qdrant gagal dibuat.");
  }

  const points = docs
    .filter((doc) => !doc?.status || doc.status === "published")
    .map(toPoint)
    .filter(Boolean);

  const qdrant = getClient();
  const batchSize = 64;
  for (let index = 0; index < points.length; index += batchSize) {
    await qdrant.upsert(env.qdrantCollection, {
      wait: true,
      points: points.slice(index, index + batchSize),
    });
  }

  const currentIds = new Set(points.map((point) => point.id));
  const existingIds = await scrollPointIds(qdrant);
  const staleIds = existingIds.filter((id) => !currentIds.has(id));
  for (let index = 0; index < staleIds.length; index += batchSize) {
    await qdrant.delete(env.qdrantCollection, {
      wait: true,
      points: staleIds.slice(index, index + batchSize),
    });
  }

  return {
    enabled: true,
    collection: env.qdrantCollection,
    upserted: points.length,
    deleted: staleIds.length,
  };
}

export async function upsertKnowledgeVector(doc) {
  if (!env.vectorSearchEnabled) {
    return { enabled: false, upserted: 0, reason: "disabled" };
  }

  const collectionResult = await ensureVectorCollection();
  if (collectionResult.reason === "create-failed") {
    throw new Error(collectionResult.error || "Collection Qdrant gagal dibuat.");
  }

  const point = toPoint(doc);
  if (!point) throw new Error("Knowledge tidak memiliki articleId dan embedding yang valid.");

  await getClient().upsert(env.qdrantCollection, {
    wait: true,
    points: [point],
  });

  return { enabled: true, collection: env.qdrantCollection, upserted: 1, articleId: doc.articleId };
}

export async function removeKnowledgeVector(articleId) {
  if (!env.vectorSearchEnabled || !articleId) {
    return { enabled: false, deleted: 0, reason: "disabled-or-missing-id" };
  }

  const collectionResult = await ensureVectorCollection();
  if (collectionResult.reason === "create-failed") {
    throw new Error(collectionResult.error || "Collection Qdrant gagal diakses.");
  }

  await getClient().delete(env.qdrantCollection, {
    wait: true,
    points: [qdrantPointId(articleId)],
  });

  return { enabled: true, collection: env.qdrantCollection, deleted: 1, articleId };
}

function publishedFilter() {
  return {
    should: [
      { key: "status", match: { value: "published" } },
      { is_empty: { key: "status" } },
    ],
  };
}

export async function searchKnowledgeVectors(vector, limit) {
  const qdrant = getClient();
  return qdrant.search(env.qdrantCollection, {
    vector,
    limit,
    filter: publishedFilter(),
    with_payload: true,
    with_vector: false,
  });
}

export function isQdrantNotFoundError(error) {
  return isNotFoundError(error);
}
