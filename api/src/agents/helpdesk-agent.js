import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ChatDeepSeek } from "@langchain/deepseek";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  createAgent,
  dynamicSystemPromptMiddleware,
  modelCallLimitMiddleware,
  summarizationMiddleware,
} from "langchain";
import { env } from "../config/env.js";
import { helpdeskTools } from "../tools/helpdesk-tools.js";
import { buildAgentPrompt } from "./agent-prompt.js";
import { agentRunContext } from "../services/agent-run-context.js";
import { getAgentCheckpointer, getLongTermStore } from "../services/agent-memory.js";
import { effectiveRecursionLimit, fallbackFromSearchState, isGraphRecursionError } from "../services/agent-limit-safety.js";
import { UPLOAD_ROOT_DIR } from "../middleware/upload.js";

let model;
let summaryModel;
let agent;

const runtimeContextSchema = z.object({
  isFirstTurn: z.boolean().default(false),
  customerId: z.string().nullable().optional(),
  longTermContext: z.string().default(""),
  trainingMode: z.boolean().default(false),
  customerDomain: z.string().nullable().optional(),
});

function getModel() {
  if (!model) {
    model = new ChatDeepSeek({
      apiKey: env.deepseekApiKey,
      model: env.deepseekModel,
      temperature: env.deepseekTemperature,
      maxRetries: 2,
      timeout: env.deepseekTimeoutMs,
    });
  }
  return model;
}

function getSummaryModel() {
  if (!summaryModel) {
    summaryModel = new ChatDeepSeek({
      apiKey: env.deepseekApiKey,
      model: env.deepseekSummaryModel || env.deepseekModel,
      temperature: 0,
      maxRetries: 1,
      timeout: env.deepseekSummaryTimeoutMs,
      // Summarization tidak membutuhkan reasoning panjang. Menonaktifkan thinking
      // hanya pada model ringkasan mengurangi latency tanpa menurunkan otak utama NAVA.
      modelKwargs: {
        thinking: { type: "disabled" },
      },
    });
  }
  return summaryModel;
}

function buildMiddleware() {
  const middleware = [
    dynamicSystemPromptMiddleware((state, runtime) =>
      buildAgentPrompt({
        isFirstTurn: Boolean(runtime.context?.isFirstTurn),
        longTermContext: runtime.context?.longTermContext || "",
        trainingMode: Boolean(runtime.context?.trainingMode),
        customerDomain: runtime.context?.customerDomain || "",
      })
    ),
    modelCallLimitMiddleware({
      runLimit: env.modelCallRunLimit,
      exitBehavior: "end",
    }),
  ];

  if (env.summarizationEnabled) {
    middleware.push(
      summarizationMiddleware({
        model: getSummaryModel(),
        trigger: [
          { messages: env.summarizationTriggerMessages },
          { tokens: env.summarizationTriggerTokens },
        ],
        keep: { messages: env.summarizationKeepMessages },
        trimTokensToSummarize: env.summarizationMaxTokens,
        summaryPrefix: "RINGKASAN KONTEKS HELPDESK SEBELUMNYA:",
        summaryPrompt: `Ringkas percakapan helpdesk berikut secara faktual dan singkat.\nPertahankan informasi yang penting agar troubleshooting dapat dilanjutkan tanpa mengulang langkah:\n- masalah/gejala utama customer;\n- konteks yang sudah diklarifikasi;\n- knowledge atau panduan yang sudah digunakan bila terlihat;\n- langkah yang sudah diberikan;\n- langkah yang sudah dicoba customer dan hasilnya;\n- status masalah: selesai/belum/eskalasi jika diketahui.\nJangan membuat diagnosis, fakta program, atau langkah baru yang tidak ada di percakapan.\n\n{messages}`,
      })
    );
  }

  return middleware;
}

function getAgent() {
  if (!agent) {
    agent = createAgent({
      model: getModel(),
      tools: helpdeskTools,
      contextSchema: runtimeContextSchema,
      checkpointer: env.checkpointerEnabled ? getAgentCheckpointer() : false,
      store: env.longTermMemoryEnabled ? getLongTermStore() : undefined,
      middleware: buildMiddleware(),
    });
  }
  return agent;
}

function messageType(message) {
  if (typeof message?._getType === "function") return message._getType();
  return message?.type || message?.role || "unknown";
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function safeJsonParse(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function findCurrentRunMessages(messages, markerId) {
  const index = messages.findIndex((message) => message?.id === markerId);
  return index >= 0 ? messages.slice(index) : messages;
}

function collectToolTrace(messages = []) {
  const calls = new Map();
  const trace = [];

  for (const message of messages) {
    const type = messageType(message);

    if (type === "ai" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        calls.set(call.id, {
          id: call.id,
          name: call.name,
          args: call.args || {},
        });
      }
    }

    if (type === "tool") {
      const callId = message.tool_call_id || message.toolCallId;
      const call = calls.get(callId) || {};
      trace.push({
        tool_call_id: callId || null,
        name: message.name || call.name || "unknown_tool",
        args: call.args || {},
        result: safeJsonParse(contentToText(message.content)),
      });
    }
  }

  return trace;
}

function lastAssistantText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messageType(messages[i]) === "ai") {
      const text = contentToText(messages[i].content).trim();
      if (text) return text;
    }
  }
  return "";
}

function summarizeSearches(toolTrace) {
  return toolTrace
    .filter((item) => item.name === "search_knowledge")
    .map((item) => ({
      query: item.args?.query || item.result?.query || "",
      found: Boolean(item.result?.found),
      confidence: Number(item.result?.confidence || 0),
      mode: item.result?.retrieval_mode || null,
      vector: item.result?.vector || null,
      timing: item.result?.timing || null,
      status: item.result?.status || null,
      evidence_strength: item.result?.evidence_strength || null,
      reused_primary: Boolean(item.result?.reused_primary),
      primary_article: item.result?.primary_article ? {
        article_id: item.result.primary_article.article_id,
        title: item.result.primary_article.title,
        category: item.result.primary_article.category,
        retrieval: item.result.primary_article.retrieval,
      } : null,
      sources: [
        ...(item.result?.primary_article ? [item.result.primary_article] : []),
        ...(item.result?.supporting_candidates || []),
      ].map((article) => ({
        article_id: article.article_id,
        title: article.title,
        category: article.category,
        retrieval: article.retrieval,
      })),
      fallback_candidates: (item.result?.candidates || []).map((article) => ({
        article_id: article.article_id,
        title: article.title,
        category: article.category,
        retrieval: article.retrieval,
      })),
    }));
}

function countModelMessages(messages = []) {
  return messages.filter((message) => messageType(message) === "ai").length;
}

async function imageAttachmentParts(attachments = []) {
  if (!env.visualAttachmentAnalysisEnabled) return [];

  const images = attachments
    .filter((attachment) => String(attachment.mime_type || "").startsWith("image/"))
    .slice(0, env.visualAttachmentMaxFiles);

  const parts = [];
  for (const attachment of images) {
    try {
      const safeFilename = path.basename(attachment.filename || "");
      if (!safeFilename) continue;
      const filePath = path.join(UPLOAD_ROOT_DIR, "helpdesk", safeFilename);
      const buffer = await fs.readFile(filePath);
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${attachment.mime_type};base64,${buffer.toString("base64")}`,
        },
      });
    } catch {
      parts.push({
        type: "text",
        text: `[Lampiran gambar "${attachment.original_name || attachment.filename}" tidak berhasil dibaca otomatis oleh sistem.]`,
      });
    }
  }

  return parts;
}

function buildRuntimeMeta({ toolTrace, searches, escalation, memoryContext, modelCallCount, siteCheck }) {
  const primary = searches.find((item) => item.primary_article)?.primary_article || null;
  const primarySearch = searches.find((item) => item.primary_article) || null;

  return {
    used_knowledge: searches.length > 0,
    primary_article_id: primary?.article_id || null,
    primary_article_title: primary?.title || null,
    evidence_strength: primarySearch?.evidence_strength || null,
    needs_escalation: Boolean(escalation),
    tool_call_count: toolTrace.length,
    model_call_count: modelCallCount,
    long_term_memory_used: Boolean(memoryContext?.text),
    long_term_memory_source: memoryContext?.source || "none",
    long_term_memory_items: memoryContext?.items || 0,
    site_check: siteCheck || null,
  };
}


export function initializeHelpdeskAgent() {
  getAgent();
  return true;
}

export async function runHelpdeskAgent({
  sessionId,
  customerId = null,
  question,
  attachments = [],
  isFirstTurn = false,
  memoryContext = { text: "", source: "none", items: 0 },
  trainingMode = false,
  customerDomain = "",
}) {
  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  const markerId = `nava-user-${runId}`;
  const imageParts = await imageAttachmentParts(attachments);
  const userMessage = new HumanMessage({
    id: markerId,
    content: imageParts.length
      ? [
          {
            type: "text",
            text: `${question}\n\nCustomer melampirkan ${imageParts.length} gambar. Baca teks/gejala yang tampak pada gambar sebelum menjawab. Jika gambar tidak jelas atau teks tidak terbaca, jangan menebak isi gambar; minta customer mengetik pesan error yang terlihat.`,
          },
          ...imageParts,
        ]
      : question,
  });

  const runState = {
    runId,
    currentQuestion: question,
    searchAttempts: 0,
    firstSearchResult: null,
    bestSearchResult: null,
    searchResults: [],
    customerDomain: String(customerDomain || "").trim(),
    siteCheck: null,
  };

  const config = {
    recursionLimit: effectiveRecursionLimit(env.agentRecursionLimit, env.modelCallRunLimit),
    configurable: { thread_id: sessionId },
    context: {
      isFirstTurn,
      customerId,
      longTermContext: memoryContext.text || "",
      trainingMode,
      customerDomain,
    },
  };

  let result;
  let recursionFallback = null;

  try {
    result = await agentRunContext.run(runState, async () =>
      getAgent().invoke({ messages: [userMessage] }, config)
    );
  } catch (error) {
    if (!isGraphRecursionError(error)) throw error;

    recursionFallback = fallbackFromSearchState(runState);
    result = { messages: [] };
  }

  const allMessages = result?.messages || [];
  const currentRunMessages = findCurrentRunMessages(allMessages, markerId);
  const toolTrace = collectToolTrace(currentRunMessages);
  const normalAnswer = lastAssistantText(currentRunMessages) || lastAssistantText(allMessages);
  const answer = recursionFallback?.answer || normalAnswer || "Maaf, NAVA belum menghasilkan jawaban yang dapat ditampilkan.";
  const searches = recursionFallback?.searches || summarizeSearches(toolTrace);
  const escalation = toolTrace.find((item) => item.name === "escalate_helpdesk")?.result || null;
  const modelCallCount = countModelMessages(currentRunMessages);
  const runtimeMeta = buildRuntimeMeta({
    toolTrace,
    searches,
    escalation,
    memoryContext,
    modelCallCount,
    siteCheck: runState.siteCheck,
  });
  runtimeMeta.recursion_fallback = Boolean(recursionFallback);
  runtimeMeta.recursion_fallback_mode = recursionFallback?.mode || null;
  runtimeMeta.configured_recursion_limit = env.agentRecursionLimit;
  runtimeMeta.effective_recursion_limit = effectiveRecursionLimit(env.agentRecursionLimit, env.modelCallRunLimit);
  runtimeMeta.visual_attachment_count = imageParts.filter((part) => part.type === "image_url").length;

  return {
    runId,
    answer,
    toolTrace,
    searches,
    escalation,
    runtimeMeta,
    groundingRetry: false,
    recursionFallback: recursionFallback?.mode || null,
    toolCallCount: toolTrace.length,
    modelCallCount,
    latencyMs: Date.now() - startedAt,
  };
}

export const __agentInternals = {
  contentToText,
  safeJsonParse,
  findCurrentRunMessages,
  collectToolTrace,
  lastAssistantText,
  summarizeSearches,
  countModelMessages,
  buildRuntimeMeta,
};
