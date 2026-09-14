import "dotenv/config";

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export const env = {
  port: numberFromEnv("PORT", 3000),
  corsOrigin: process.env.CORS_ORIGIN || false,
  nodeEnv: process.env.NODE_ENV || "development",
  mongodbUri: process.env.MONGODB_URI || "",
  mongodbDb: process.env.MONGODB_DB || "db_agent_helpdesk",
  knowledgeCollection: process.env.KNOWLEDGE_COLLECTION || "tm_knowledge_helpdesk",
  chatCollection: process.env.CHAT_COLLECTION || "tt_chat_helpdesk",
  trainingSessionCollection: process.env.TRAINING_SESSION_COLLECTION || "tt_chat_training",
  trainingMessageCollection: process.env.TRAINING_MESSAGE_COLLECTION || "tt_chat_training_message",
  agentTraceCollection: process.env.AGENT_TRACE_COLLECTION || "tt_agent_trace",
  ticketCollection: process.env.TICKET_COLLECTION || "tt_ticket_helpdesk",
  helpdeskUserCollection: process.env.HELPDESK_USER_COLLECTION || "tm_helpdesk_user",
  uploadBaseUrl: process.env.UPLOAD_BASE_URL || "/uploads",
  siteCheckTimeoutMs: numberFromEnv("SITE_CHECK_TIMEOUT_MS", 8000),
  siteCheckCacheTtlMs: numberFromEnv("SITE_CHECK_CACHE_TTL_MS", 60000),
  siteCheckApiKey: process.env.SITE_CHECK_API_KEY || "nagagold-api-key",
  siteCheckSigningSecret: process.env.SITE_CHECK_SIGNING_SECRET || "",
  siteCheckBackendToken: process.env.SITE_CHECK_BACKEND_TOKEN || "",

  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  deepseekSummaryModel: process.env.DEEPSEEK_SUMMARY_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  deepseekTemperature: numberFromEnv("DEEPSEEK_TEMPERATURE", 0.1),
  deepseekTimeoutMs: numberFromEnv("DEEPSEEK_TIMEOUT_MS", 60000),
  deepseekSummaryTimeoutMs: numberFromEnv("DEEPSEEK_SUMMARY_TIMEOUT_MS", 30000),
  visualAttachmentAnalysisEnabled: boolFromEnv("VISUAL_ATTACHMENT_ANALYSIS_ENABLED", true),
  visualAttachmentMaxFiles: numberFromEnv("VISUAL_ATTACHMENT_MAX_FILES", 3),
  helpdeskAuthSecret: process.env.HELPDESK_AUTH_SECRET || "",
  helpdeskDefaultPassword: process.env.HELPDESK_DEFAULT_PASSWORD || "",

  knowledgeTopK: numberFromEnv("KNOWLEDGE_TOP_K", 5),
  minRetrievalCoverage: numberFromEnv("MIN_RETRIEVAL_COVERAGE", 0.2),
  debugRetrieval: boolFromEnv("DEBUG_RETRIEVAL", true),
  debugAgent: boolFromEnv("DEBUG_AGENT", true),
  agentRecursionLimit: numberFromEnv("AGENT_RECURSION_LIMIT", 20),
  searchToolCallLimit: numberFromEnv("SEARCH_TOOL_CALL_LIMIT", 2),
  modelCallRunLimit: numberFromEnv("MODEL_CALL_RUN_LIMIT", 4),

  // LangGraph short-term memory / state persistence.
  checkpointerEnabled: boolFromEnv("CHECKPOINTER_ENABLED", true),
  checkpointCollection: process.env.CHECKPOINT_COLLECTION || "tt_agent_checkpoint",
  checkpointWritesCollection: process.env.CHECKPOINT_WRITES_COLLECTION || "tt_agent_checkpoint_write",
  checkpointTtlSeconds: numberFromEnv("CHECKPOINT_TTL_SECONDS", 0),

  // Adaptive conversation summarization. Hanya trigger pada chat panjang.
  summarizationEnabled: boolFromEnv("SUMMARIZATION_ENABLED", true),
  summarizationTriggerMessages: numberFromEnv("SUMMARIZATION_TRIGGER_MESSAGES", 30),
  summarizationTriggerTokens: numberFromEnv("SUMMARIZATION_TRIGGER_TOKENS", 8000),
  summarizationKeepMessages: numberFromEnv("SUMMARIZATION_KEEP_MESSAGES", 10),
  summarizationMaxTokens: numberFromEnv("SUMMARIZATION_MAX_TOKENS", 6000),

  // Full long-term memory backed by MongoDBStore.
  longTermMemoryEnabled: boolFromEnv("LONG_TERM_MEMORY_ENABLED", true),
  longTermMemoryCollection: process.env.LONG_TERM_MEMORY_COLLECTION || "tm_nava_customer_memory",
  longTermMemoryCaseLimit: numberFromEnv("LONG_TERM_MEMORY_CASE_LIMIT", 8),
  longTermMemoryAnswerMaxChars: numberFromEnv("LONG_TERM_MEMORY_ANSWER_MAX_CHARS", 500),

  // Legacy lightweight cross-session fallback/migration only.
  crossSessionContextEnabled: boolFromEnv("CROSS_SESSION_CONTEXT_ENABLED", true),
  crossSessionHistoryLimit: numberFromEnv("CROSS_SESSION_HISTORY_LIMIT", 6),
  crossSessionMessageMaxChars: numberFromEnv("CROSS_SESSION_MESSAGE_MAX_CHARS", 500),
  crossSessionAnswerMaxChars: numberFromEnv("CROSS_SESSION_ANSWER_MAX_CHARS", 500),

  vectorSearchEnabled: boolFromEnv("VECTOR_SEARCH_ENABLED", true),
  vectorIndexName: process.env.VECTOR_INDEX_NAME || "knowledge_vector_index",
  vectorField: process.env.VECTOR_FIELD || "embedding",
  qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
  qdrantApiKey: process.env.QDRANT_API_KEY || "",
  qdrantCollection: process.env.QDRANT_COLLECTION || process.env.VECTOR_INDEX_NAME || "knowledge_vector_index",
  qdrantTimeoutMs: numberFromEnv("QDRANT_TIMEOUT_MS", 10000),
  qdrantReconcileOnStart: boolFromEnv("QDRANT_RECONCILE_ON_START", true),
  vectorCandidateLimit: numberFromEnv("VECTOR_CANDIDATE_LIMIT", 20),
  minVectorScore: numberFromEnv("MIN_VECTOR_SCORE", 0.89),
  hybridKeywordWeight: numberFromEnv("HYBRID_KEYWORD_WEIGHT", 1.0),
  hybridVectorWeight: numberFromEnv("HYBRID_VECTOR_WEIGHT", 1.25),
  hybridProblemWeight: numberFromEnv("HYBRID_PROBLEM_WEIGHT", 3.0),

  embeddingModel: process.env.EMBEDDING_MODEL || "Xenova/multilingual-e5-small",
  embeddingProfile: process.env.EMBEDDING_PROFILE || "problem-v2",
  embeddingDimensions: numberFromEnv("EMBEDDING_DIMENSIONS", 384),
  embeddingDtype: process.env.EMBEDDING_DTYPE || "q8",
  embeddingBatchSize: numberFromEnv("EMBEDDING_BATCH_SIZE", 8),
  embeddingMaxChars: numberFromEnv("EMBEDDING_MAX_CHARS", 1800),
  embeddingWarmupOnStart: boolFromEnv("EMBEDDING_WARMUP_ON_START", false),
};

export function validateRuntimeEnv() {
  const missing = [];
  if (!env.mongodbUri) missing.push("MONGODB_URI");
  if (!env.deepseekApiKey) missing.push("DEEPSEEK_API_KEY");
  if (!env.helpdeskAuthSecret) missing.push("HELPDESK_AUTH_SECRET");

  if (missing.length) {
    const error = new Error(`Environment variable belum diisi: ${missing.join(", ")}`);
    error.code = "ENV_MISSING";
    throw error;
  }

  if (env.vectorSearchEnabled && env.embeddingDimensions <= 0) {
    const error = new Error("EMBEDDING_DIMENSIONS harus lebih dari 0.");
    error.code = "ENV_INVALID";
    throw error;
  }

  if (env.summarizationEnabled && env.summarizationKeepMessages >= env.summarizationTriggerMessages) {
    const error = new Error("SUMMARIZATION_KEEP_MESSAGES harus lebih kecil dari SUMMARIZATION_TRIGGER_MESSAGES.");
    error.code = "ENV_INVALID";
    throw error;
  }

  if (env.searchToolCallLimit < 1 || env.modelCallRunLimit < 2 || env.agentRecursionLimit < 4) {
    const error = new Error("Agent limit terlalu kecil. Gunakan SEARCH_TOOL_CALL_LIMIT >= 1, MODEL_CALL_RUN_LIMIT >= 2, dan AGENT_RECURSION_LIMIT >= 4.");
    error.code = "ENV_INVALID";
    throw error;
  }
}
