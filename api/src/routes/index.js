import { Router } from "express";
import path from "node:path";
import { env } from "../config/env.js";
import { helpdeskLoginHandler, helpdeskLogoutHandler, helpdeskMeHandler } from "../controllers/auth-controller.js";
import { chat, getSessionMessages, getCustomerContext, resetChatSession, searchKnowledge } from "../controllers/chat-controller.js";
import { dashboardSummary } from "../controllers/dashboard-controller.js";
import { eventStream } from "../controllers/event-controller.js";
import {
  createHelpdeskUserHandler,
  deleteHelpdeskUserHandler,
  getHelpdeskUserHandler,
  listHelpdeskUsersHandler,
  updateHelpdeskUserHandler,
  updateHelpdeskUserStatusHandler,
} from "../controllers/helpdesk-user-controller.js";
import {
  archiveKnowledgeArticleHandler,
  createKnowledgeArticleHandler,
  deleteKnowledgeArticleHandler,
  getKnowledgeArticleHandler,
  listKnowledgeCategoriesHandler,
  listKnowledgeArticlesHandler,
  publishKnowledgeArticleHandler,
  updateKnowledgeArticleHandler,
} from "../controllers/knowledge-article-controller.js";
import {
  acceptHandoverHandler,
  createTicketHandler,
  exportTicketsCsvHandler,
  handoverCountHandler,
  helpdeskReplyHandler,
  ticketAssigneesHandler,
  listTicketsHandler,
  resolveTicketHandler,
  ticketBySessionHandler,
  ticketDetailHandler,
} from "../controllers/ticket-controller.js";
import { requireHelpdeskAdmin, requireHelpdeskAuth } from "../middleware/helpdesk-auth.js";
import { filesToAttachments, UPLOAD_ROOT_DIR, uploadHelpdeskImages } from "../middleware/upload.js";
import { getVectorStoreStatus } from "../database/qdrant.js";
import { siteCheckHandler } from "../controllers/site-check-controller.js";
import {
  closeTrainingSessionHandler,
  createTrainingSessionHandler,
  generateTrainingKnowledgeHandler,
  getTrainingSessionHandler,
  listTrainingSessionsHandler,
  saveTrainingDraftHandler,
  sendTrainingCorrectionHandler,
  sendTrainingMessageHandler,
  trainingFeedbackHandler,
} from "../controllers/chat-training-controller.js";

export const apiRouter = Router();

apiRouter.get("/health", async (req, res) => {
  const vectorStatus = await getVectorStoreStatus();
  res.json({
    success: true,
    service: "nava-langchain-helpdesk-agent",
    version: "2.4.0",
    status: "ok",
    architecture: "llm-first-langchain-agent+langgraph-memory+hybrid-rag",
    agent: {
      enabled: true,
      recursion_limit: env.agentRecursionLimit,
      model_call_run_limit: env.modelCallRunLimit,
      search_tool_call_limit: env.searchToolCallLimit,
      identity: "NAVA - AI Helpdesk Nagatech (Nagatech Virtual Assistant)",
      agent_reuse: "singleton",
      checkpointer: {
        enabled: env.checkpointerEnabled,
        checkpoint_collection: env.checkpointCollection,
        writes_collection: env.checkpointWritesCollection,
      },
      summarization: {
        enabled: env.summarizationEnabled,
        trigger_messages: env.summarizationTriggerMessages,
        keep_messages: env.summarizationKeepMessages,
      },
      long_term_memory: {
        enabled: env.longTermMemoryEnabled,
        collection: env.longTermMemoryCollection,
        key: "customer_id",
        case_limit: env.longTermMemoryCaseLimit,
      },
      trace_collection: env.agentTraceCollection,
    },
    vector_search: {
      enabled: env.vectorSearchEnabled,
      index: env.qdrantCollection,
      qdrant: vectorStatus,
      model: env.embeddingModel,
      dimensions: env.embeddingDimensions,
      embedding_profile: env.embeddingProfile,
      problem_weight: env.hybridProblemWeight,
    },
    timestamp: new Date().toISOString(),
  });
});

apiRouter.post("/chat", chat);
apiRouter.post("/site-check", siteCheckHandler);
apiRouter.get("/chat/:session_id/messages", getSessionMessages);
apiRouter.post("/training/session", requireHelpdeskAuth, createTrainingSessionHandler);
apiRouter.get("/training/sessions", requireHelpdeskAuth, listTrainingSessionsHandler);
apiRouter.get("/training/:trainingId", requireHelpdeskAuth, getTrainingSessionHandler);
apiRouter.post("/training/:trainingId/message", requireHelpdeskAuth, sendTrainingMessageHandler);
apiRouter.post("/training/:trainingId/correction", requireHelpdeskAuth, sendTrainingCorrectionHandler);
apiRouter.post("/training/:trainingId/feedback", requireHelpdeskAuth, trainingFeedbackHandler);
apiRouter.post("/training/:trainingId/generate-knowledge", requireHelpdeskAuth, generateTrainingKnowledgeHandler);
apiRouter.post("/training/:trainingId/save-draft", requireHelpdeskAuth, saveTrainingDraftHandler);
apiRouter.post("/training/:trainingId/close", requireHelpdeskAuth, closeTrainingSessionHandler);
apiRouter.get("/customer/:customer_id/context", getCustomerContext);
apiRouter.delete("/chat/:session_id", resetChatSession);
apiRouter.post("/knowledge/search", searchKnowledge);
apiRouter.get("/knowledge/categories", requireHelpdeskAuth, listKnowledgeCategoriesHandler);
apiRouter.get("/knowledge/articles", requireHelpdeskAuth, listKnowledgeArticlesHandler);
apiRouter.post("/knowledge/articles", requireHelpdeskAuth, createKnowledgeArticleHandler);
apiRouter.get("/knowledge/articles/:articleId", requireHelpdeskAuth, getKnowledgeArticleHandler);
apiRouter.put("/knowledge/articles/:articleId", requireHelpdeskAuth, updateKnowledgeArticleHandler);
apiRouter.post("/knowledge/articles/:articleId/publish", requireHelpdeskAuth, publishKnowledgeArticleHandler);
apiRouter.post("/knowledge/articles/:articleId/archive", requireHelpdeskAuth, archiveKnowledgeArticleHandler);
apiRouter.delete("/knowledge/articles/:articleId", requireHelpdeskAuth, deleteKnowledgeArticleHandler);
apiRouter.post("/auth/helpdesk/login", helpdeskLoginHandler);
apiRouter.get("/auth/helpdesk/me", requireHelpdeskAuth, helpdeskMeHandler);
apiRouter.post("/auth/helpdesk/logout", requireHelpdeskAuth, helpdeskLogoutHandler);
apiRouter.get("/helpdesk/users", requireHelpdeskAuth, requireHelpdeskAdmin, listHelpdeskUsersHandler);
apiRouter.post("/helpdesk/users", requireHelpdeskAuth, requireHelpdeskAdmin, createHelpdeskUserHandler);
apiRouter.get("/helpdesk/users/:helpdeskId", requireHelpdeskAuth, requireHelpdeskAdmin, getHelpdeskUserHandler);
apiRouter.put("/helpdesk/users/:helpdeskId", requireHelpdeskAuth, requireHelpdeskAdmin, updateHelpdeskUserHandler);
apiRouter.patch("/helpdesk/users/:helpdeskId/status", requireHelpdeskAuth, requireHelpdeskAdmin, updateHelpdeskUserStatusHandler);
apiRouter.delete("/helpdesk/users/:helpdeskId", requireHelpdeskAuth, requireHelpdeskAdmin, deleteHelpdeskUserHandler);
apiRouter.get("/dashboard", requireHelpdeskAuth, dashboardSummary);
apiRouter.get("/dashboard/summary", requireHelpdeskAuth, dashboardSummary);
apiRouter.get("/events", eventStream);

apiRouter.post("/uploads/helpdesk", uploadHelpdeskImages, (req, res) => {
  res.status(201).json({ success: true, data: filesToAttachments(req.files || []) });
});

apiRouter.get("/uploads/helpdesk/:filename", (req, res) => {
  const filename = path.basename(req.params.filename || "");
  if (!filename) {
    return res.status(404).json({ success: false, message: "File gambar tidak ditemukan." });
  }
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  return res.sendFile(path.join(UPLOAD_ROOT_DIR, "helpdesk", filename), (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ success: false, message: "File gambar tidak ditemukan." });
    }
  });
});

apiRouter.get("/tickets", requireHelpdeskAuth, listTicketsHandler);
apiRouter.get("/helpdesk/handover/count", requireHelpdeskAuth, handoverCountHandler);
apiRouter.post("/tickets", createTicketHandler);
apiRouter.get("/tickets/export.csv", requireHelpdeskAuth, exportTicketsCsvHandler);
apiRouter.get("/tickets/assignees", requireHelpdeskAuth, ticketAssigneesHandler);
apiRouter.get("/tickets/session/:session_id", ticketBySessionHandler);
apiRouter.get("/tickets/:id", requireHelpdeskAuth, ticketDetailHandler);
apiRouter.post("/tickets/:id/accept", requireHelpdeskAuth, acceptHandoverHandler);
apiRouter.post("/tickets/:id/resolve", requireHelpdeskAuth, resolveTicketHandler);
apiRouter.post("/helpdesk/reply", requireHelpdeskAuth, helpdeskReplyHandler);
