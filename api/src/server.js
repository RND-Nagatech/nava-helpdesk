import express from "express";
import cors from "cors";
import helmet from "helmet";
import { ZodError } from "zod";
import { env, validateRuntimeEnv } from "./config/env.js";
import { connectMongo, ensureIndexes, closeMongo, reconcileKnowledgeVectors } from "./database/mongodb.js";
import { apiRouter } from "./routes/index.js";
import { warmupEmbeddingModel } from "./services/embedding-service.js";
import { initializeHelpdeskAgent } from "./agents/helpdesk-agent.js";
import { initializeAgentMemory } from "./services/agent-memory.js";
import { UPLOAD_ROOT_DIR } from "./middleware/upload.js";

const app = express();
const configuredCorsOrigins = env.corsOrigin
  ? String(env.corsOrigin).split(",").map((origin) => origin.trim()).filter(Boolean)
  : [];

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (configuredCorsOrigins.includes(origin)) return true;
  return env.nodeEnv !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedCorsOrigin(origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(UPLOAD_ROOT_DIR));

app.get("/", (req, res) => {
  res.json({
    service: "NAVA LangChain Helpdesk Agent",
    version: "2.4.0",
    endpoints: ["GET /api/health", "POST /api/chat", "GET /api/customer/:customer_id/context", "POST /api/knowledge/search", "GET /api/tickets", "GET /api/dashboard", "GET /api/events"],
  });
});

app.use("/api", apiRouter);

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." });
});

app.use((error, req, res, next) => {
  if (error instanceof ZodError) {
    const firstIssue = error.issues?.[0];
    const fieldLabels = {
      helpdesk_id: "Helpdesk ID",
      name: "Nama",
      password: "Password",
      role: "Role",
      tier: "Tier",
      is_active: "Status aktif",
    };
    const field = fieldLabels[firstIssue?.path?.[0]];
    let message = "Data yang dikirim belum lengkap atau formatnya belum sesuai.";
    if (field && firstIssue?.code === "too_small") message = `${field} wajib diisi.`;
    else if (field && firstIssue?.code === "invalid_type") message = `${field} belum diisi atau formatnya tidak sesuai.`;
    else if (field && firstIssue?.code === "invalid_value") message = `${field} tidak valid.`;
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message,
      errors: error.issues,
    });
  }

  if (error?.name === "MongoServerSelectionError" || error?.name === "MongoNetworkError") {
    console.warn(`MongoDB belum stabil: ${error.message}`);
    return res.status(503).json({
      success: false,
      code: "DATABASE_UNAVAILABLE",
      message: "Koneksi MongoDB sedang tidak stabil. Coba refresh beberapa saat lagi.",
    });
  }

  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code || "REQUEST_ERROR",
      message: error.message,
    });
  }

  console.error(error);
  return res.status(500).json({
    success: false,
    code: error?.code || "INTERNAL_SERVER_ERROR",
    message: env.nodeEnv === "production" ? "Terjadi kesalahan pada server." : error?.message,
  });
});

async function start() {
  validateRuntimeEnv();
  await connectMongo();
  await ensureIndexes();
  await initializeAgentMemory();
  initializeHelpdeskAgent();

  app.listen(env.port, () => {
    console.log(`NAVA Agent API berjalan di http://localhost:${env.port}`);
    console.log(`Architecture: LLM-first LangChain Agent + LangGraph Memory + Hybrid RAG`);
    console.log(`DeepSeek model: ${env.deepseekModel}`);
    console.log(`MongoDB database: ${env.mongodbDb}`);
    console.log(`Checkpointer: ${env.checkpointerEnabled ? "enabled" : "disabled"}`);
    console.log(`Long-term memory: ${env.longTermMemoryEnabled ? "enabled" : "disabled"}`);
    console.log(`Adaptive summarization: ${env.summarizationEnabled ? `enabled @ ${env.summarizationTriggerMessages} messages` : "disabled"}`);

    if (env.embeddingWarmupOnStart) {
      warmupEmbeddingModel()
        .then(() => console.log("Embedding model warmup selesai."))
        .catch((error) => console.warn(`Embedding model warmup gagal; retrieval akan memakai fallback: ${error?.message || error}`));
    }

    if (env.qdrantReconcileOnStart) {
      reconcileKnowledgeVectors()
        .then((result) => console.log(`Qdrant reconcile selesai: upserted=${result.upserted}, deleted=${result.deleted}`))
        .catch((error) => console.warn(`Qdrant reconcile gagal; jalankan knowledge:embed lalu knowledge:vector-index: ${error?.message || error}`));
    }
  });
}

async function shutdown(signal) {
  console.log(`\n${signal} diterima. Menutup koneksi...`);
  await closeMongo();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch(async (error) => {
  console.error("Gagal menjalankan server:", error);
  await closeMongo();
  process.exit(1);
});
