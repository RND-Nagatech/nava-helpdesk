import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";
import { searchKnowledgeVectors } from "../database/qdrant.js";
import { embedQuery } from "./embedding-service.js";
import {
  importantQueryTokens,
  articleDomainMatch,
  lexicalScore,
  problemMatchScore,
} from "../utils/text.js";
import { fuseHybridResults } from "../utils/hybrid.js";

const PROJECTION = {
  _id: 0,
  articleId: 1,
  title: 1,
  category: 1,
  product: 1,
  clientScope: 1,
  symptoms: 1,
  troubleshootingSteps: 1,
  escalationRules: 1,
  userResponseTemplate: 1,
  tags: 1,
  status: 1,
};

function dedupeDocuments(documents = []) {
  const byKey = new Map();
  for (const doc of documents) {
    const key = doc.articleId || `${doc.title || ""}|${doc.category || ""}`;
    if (!key || byKey.has(key)) continue;
    byKey.set(key, doc);
  }
  return [...byKey.values()];
}

function constrainToExplicitDomain(query, documents = []) {
  const scoped = documents.filter((doc) => articleDomainMatch(query, doc).coverage === 1);
  return scoped.length ? scoped : documents;
}

export function rankLexicalCandidates(query, docs, limit) {
  return docs
    .map((doc) => ({
      ...doc,
      lexical: lexicalScore(query, doc),
      problem: problemMatchScore(query, doc),
    }))
    .filter((doc) => doc.lexical.score > 0 || doc.problem.score > 0)
    .sort((a, b) => {
      if (b.problem.distinctiveCoverage !== a.problem.distinctiveCoverage) {
        return b.problem.distinctiveCoverage - a.problem.distinctiveCoverage;
      }
      if (b.problem.titleDistinctiveCoverage !== a.problem.titleDistinctiveCoverage) {
        return b.problem.titleDistinctiveCoverage - a.problem.titleDistinctiveCoverage;
      }
      if (b.problem.coverage !== a.problem.coverage) return b.problem.coverage - a.problem.coverage;
      if (b.lexical.coverage !== a.lexical.coverage) return b.lexical.coverage - a.lexical.coverage;
      if (b.problem.score !== a.problem.score) return b.problem.score - a.problem.score;
      return b.lexical.score - a.lexical.score;
    })
    .slice(0, limit);
}

async function textSearch(collection, query, limit) {
  return collection
    .find(
      { ...publishedKnowledgeQuery(), $text: { $search: query } },
      { projection: { ...PROJECTION, mongoTextScore: { $meta: "textScore" } } }
    )
    .sort({ mongoTextScore: { $meta: "textScore" } })
    .limit(limit)
    .toArray();
}

function tokenRegex(token) {
  const safe = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(safe, "i");
}

async function regexCandidateSearch(collection, query, limit, { broad = false } = {}) {
  const tokens = importantQueryTokens(query);
  if (!tokens.length) return [];

  const fields = broad
    ? ["title", "symptoms", "tags", "category", "userResponseTemplate", "troubleshootingSteps.instruction"]
    : ["title", "symptoms", "tags", "category"];

  const ors = [];
  for (const token of tokens) {
    const regex = tokenRegex(token);
    for (const field of fields) ors.push({ [field]: regex });
  }

  return collection
    .find(
      { $and: [publishedKnowledgeQuery(), { $or: ors }] },
      { projection: PROJECTION }
    )
    .limit(limit)
    .toArray();
}

async function retrieveLexical(collection, query, limit) {
  // MongoDB text search tetap dipakai, tetapi selalu disupplement dengan pencarian
  // token pembeda di title/symptoms/tags. Ini mencegah artikel exact terlempar dari
  // candidate pool hanya karena query hasil LLM memakai bentuk kata yang berbeda.
  const regexLimit = Math.max(limit * 2, 60);
  const [textSettled, targetedRegexSettled] = await Promise.allSettled([
    textSearch(collection, query, limit),
    regexCandidateSearch(collection, query, regexLimit),
  ]);

  const textDocuments = textSettled.status === "fulfilled" ? textSettled.value : [];
  let regexDocuments = targetedRegexSettled.status === "fulfilled" ? targetedRegexSettled.value : [];

  if (!textDocuments.length && !regexDocuments.length) {
    try {
      regexDocuments = await regexCandidateSearch(collection, query, regexLimit, { broad: true });
    } catch {
      regexDocuments = [];
    }
  }

  const candidates = constrainToExplicitDomain(query, dedupeDocuments([...textDocuments, ...regexDocuments]));
  const mode = textDocuments.length
    ? regexDocuments.length
      ? "mongodb-text+targeted-regex"
      : "mongodb-text"
    : "mongodb-regex-fallback";

  return {
    mode,
    documents: rankLexicalCandidates(query, candidates, limit),
  };
}

async function retrieveVector(collection, query, limit) {
  if (!env.vectorSearchEnabled) {
    return { enabled: false, ok: false, documents: [] };
  }

  try {
    const queryVector = await embedQuery(query);
    const points = await searchKnowledgeVectors(queryVector, limit);
    const articleIds = points
      .map((point) => point.payload?.articleId)
      .filter(Boolean);
    const documents = await collection
      .find(
        { ...publishedKnowledgeQuery(), articleId: { $in: articleIds } },
        { projection: PROJECTION }
      )
      .toArray();
    const byArticleId = new Map(documents.map((doc) => [doc.articleId, doc]));
    const scopedPoints = points.filter((point) => {
      const doc = byArticleId.get(point.payload?.articleId);
      return doc && articleDomainMatch(query, doc).coverage === 1;
    });
    const selectedPoints = scopedPoints.length ? scopedPoints : points;
    const rankedDocuments = selectedPoints
      .map((point) => {
        const articleId = point.payload?.articleId;
        const doc = byArticleId.get(articleId);
        return doc
          ? { ...doc, vectorScore: Number(point.score || 0), problem: problemMatchScore(query, doc) }
          : null;
      })
      .filter(Boolean);
    return { enabled: true, ok: true, documents: rankedDocuments };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      documents: [],
      error: error?.message || String(error),
    };
  }
}

function publishedKnowledgeQuery() {
  return { $or: [{ status: "published" }, { status: { $exists: false } }] };
}

function retrievalMode({ lexicalMode, vectorResult, lexicalDocs }) {
  if (!vectorResult.enabled) return lexicalMode;
  if (!vectorResult.ok) return `${lexicalMode}+vector-fallback`;
  if (!lexicalDocs.length) return "vector-only";
  return "hybrid-vector+lexical";
}

export async function retrieveKnowledge(query, options = {}) {
  const topK = Math.max(1, Number(options.topK || env.knowledgeTopK));
  const lexicalLimit = Math.max(topK * 8, 30);
  const vectorLimit = Math.max(topK * 4, env.vectorCandidateLimit);
  const db = await getDb();
  const collection = db.collection(env.knowledgeCollection);

  const startedAt = Date.now();
  const [lexicalTimed, vectorTimed] = await Promise.all([
    (async () => {
      const started = Date.now();
      const result = await retrieveLexical(collection, query, lexicalLimit);
      return { result, ms: Date.now() - started };
    })(),
    (async () => {
      const started = Date.now();
      const result = await retrieveVector(collection, query, vectorLimit);
      return { result, ms: Date.now() - started };
    })(),
  ]);
  const lexicalResult = lexicalTimed.result;
  const vectorResult = vectorTimed.result;

  const ranked = fuseHybridResults(
    lexicalResult.documents,
    vectorResult.documents,
    topK,
    {
      keywordWeight: env.hybridKeywordWeight,
      vectorWeight: env.hybridVectorWeight,
      problemWeight: env.hybridProblemWeight,
    }
  );

  const best = ranked[0];
  const primaryEvidence = best
    ? {
        articleId: best.articleId,
        title: best.title,
        category: best.category,
        strength: best.retrieval.evidenceStrength,
        problemCoverage: best.retrieval.problemCoverage,
        problemDistinctiveCoverage: best.retrieval.problemDistinctiveCoverage,
        problemScore: best.retrieval.problemScore,
      }
    : null;

  const hasDistinctiveSignal = !best ||
    Number(best.retrieval.problemDistinctiveTokenCount || 0) === 0 ||
    Number(best.retrieval.problemDistinctiveCoverage || 0) >= 0.34;
  const lexicalFound = Boolean(
    best &&
      best.retrieval.coverage >= env.minRetrievalCoverage &&
      hasDistinctiveSignal
  );
  const vectorFound = Boolean(
    best &&
      best.retrieval.vectorRank !== null &&
      best.retrieval.vectorScore >= env.minVectorScore
  );
  const found = lexicalFound || vectorFound;

  const confidence = best
    ? Number(Math.max(
        best.retrieval.coverage || 0,
        best.retrieval.problemDistinctiveCoverage || 0,
        best.retrieval.vectorScore || 0
      ).toFixed(4))
    : 0;

  return {
    found,
    retrievalMode: retrievalMode({
      lexicalMode: lexicalResult.mode,
      vectorResult,
      lexicalDocs: lexicalResult.documents,
    }),
    query,
    confidence,
    documents: found ? ranked : [],
    candidates: ranked,
    primaryEvidence,
    vector: {
      enabled: vectorResult.enabled,
      ok: vectorResult.ok,
      error: vectorResult.error,
      index: env.qdrantCollection,
      model: env.embeddingModel,
    },
    timing: {
      lexical_ms: lexicalTimed.ms,
      vector_ms: vectorTimed.ms,
      total_ms: Date.now() - startedAt,
    },
  };
}

export function formatKnowledgeContext(documents) {
  if (!documents?.length) return "TIDAK ADA KNOWLEDGE YANG RELEVAN.";

  return documents.map((doc, index) => {
    const steps = (doc.troubleshootingSteps || [])
      .map((step) => `${step.order ?? "-"}. ${step.instruction}${step.expectedResult ? ` [Hasil: ${step.expectedResult}]` : ""}`)
      .join("\n");

    return [
      `=== KNOWLEDGE ${index + 1} ===`,
      `Article ID: ${doc.articleId}`,
      `Judul: ${doc.title}`,
      `Kategori: ${doc.category || "-"}`,
      `Produk: ${doc.product || "-"}`,
      `Gejala: ${(doc.symptoms || []).join("; ") || "-"}`,
      `Langkah troubleshooting:\n${steps || "-"}`,
      `Template jawaban user: ${doc.userResponseTemplate || "-"}`,
      `Aturan eskalasi: ${(doc.escalationRules || []).join(" | ") || "-"}`,
    ].join("\n");
  }).join("\n\n");
}
