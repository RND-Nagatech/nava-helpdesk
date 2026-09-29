import crypto from "node:crypto";
import { HindsightClient } from "@vectorize-io/hindsight-client";
import { env } from "../config/env.js";

let client;
const configuredBanks = new Set();
const bankSetupPromises = new Map();

function isEnabled() {
  return Boolean(env.hindsightEnabled && env.hindsightUrl);
}

function getClient() {
  if (!isEnabled()) return null;
  if (!client) {
    client = new HindsightClient({
      baseUrl: env.hindsightUrl,
      ...(env.hindsightApiKey ? { apiKey: env.hindsightApiKey } : {}),
      userAgent: "nava-helpdesk-hindsight/1.0",
      maxAttempts: 1,
    });
  }
  return client;
}

export function hindsightBankId(customerId = "") {
  const digest = crypto.createHash("sha256").update(String(customerId)).digest("hex").slice(0, 32);
  return `nava-customer-${digest}`;
}

function withTimeout(operation, timeoutMs = env.hindsightTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
  return Promise.resolve()
    .then(() => operation(controller.signal))
    .finally(() => clearTimeout(timer));
}

async function ensureBank(bankId) {
  if (configuredBanks.has(bankId)) return;
  const existing = bankSetupPromises.get(bankId);
  if (existing) return existing;

  const setup = withTimeout((signal) => getClient().createBank(bankId, {
    signal,
    name: bankId,
    retainMission: [
      "Retain only durable customer-support facts: the customer's issue, attempted steps, outcomes, preferences, versions, and escalation status.",
      "Ignore greetings, filler, credentials, API keys, passwords, payment secrets, and unsupported guesses.",
    ].join(" "),
    retainExtractionMode: "concise",
    enableObservations: true,
    observationsMission: "Consolidate repeated support history into reliable patterns, while preserving newer facts that may change the current situation.",
    enableTextSearch: true,
    enableTemporalRetrieval: true,
    enableGraphRetrieval: true,
    enableReranking: true,
  })).then(() => {
    configuredBanks.add(bankId);
    bankSetupPromises.delete(bankId);
  }).catch((error) => {
    bankSetupPromises.delete(bankId);
    throw error;
  });

  bankSetupPromises.set(bankId, setup);
  return setup;
}

function cleanText(value, maxChars) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

export function redactSensitiveText(value, maxChars) {
  return cleanText(value, maxChars)
    .replace(/\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret)\s*[:=]\s*[^\s,;]+/gi, "$1: [REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|hsk_[A-Za-z0-9_-]{12,})\b/g, "[REDACTED_TOKEN]");
}

export function buildHindsightCaseContent({ question, answer, runtimeMeta = {}, escalation = null }) {
  const primaryId = runtimeMeta.primary_article_id || "none";
  const primaryTitle = runtimeMeta.primary_article_title || "none";
  const status = escalation ? "escalated" : "grounded_answer";
  const lines = [
    `NAVA customer support case (${status}).`,
    `Customer question: ${redactSensitiveText(question, 700)}`,
    `NAVA answer: ${redactSensitiveText(answer, 1100)}`,
    `Official knowledge ID: ${cleanText(primaryId, 120)}`,
    `Official knowledge title: ${cleanText(primaryTitle, 240)}`,
    `Evidence strength: ${cleanText(runtimeMeta.evidence_strength || "unknown", 80)}`,
  ];
  if (escalation) {
    lines.push(`Escalation reason: ${redactSensitiveText(escalation.reason || escalation.issue_summary || "helpdesk follow-up", 500)}`);
  }
  return lines.join("\n");
}

export function formatHindsightRecall(response) {
  const results = Array.isArray(response?.results) ? response.results : [];
  if (!results.length) {
    return { text: "", items: 0, factIds: [] };
  }

  const lines = [
    "MEMORI HINDSIGHT CUSTOMER YANG RELEVAN:",
    "Gunakan ini hanya sebagai konteks historis. Untuk prosedur, status program, dan fakta realtime tetap prioritaskan knowledge resmi NAVA atau hasil tool.",
  ];

  for (const result of results.slice(0, 6)) {
    const when = result.occurred_start || result.mentioned_at;
    const date = when ? ` [${when.slice(0, 10)}]` : "";
    const type = result.type ? ` (${result.type})` : "";
    lines.push(`- ${cleanText(result.text, 500)}${date}${type}`);
  }

  return {
    text: lines.join("\n"),
    items: results.length,
    factIds: results.map((result) => result.id).filter(Boolean).slice(0, 10),
  };
}

export async function recallCustomerMemory({ customerId, query }) {
  if (!isEnabled() || !customerId || !query) {
    return { enabled: false, source: "none", text: "", items: 0, factIds: [] };
  }

  const hindsight = getClient();
  const bankId = hindsightBankId(customerId);
  try {
    // Recall pertama untuk customer baru harus membuat bank terlebih dahulu.
    // Tanpa ini Hindsight mengembalikan "Bank ... not found" dan memory
    // terlihat unavailable padahal service-nya sehat.
    await ensureBank(bankId);
    const response = await withTimeout((signal) => hindsight.recall(bankId, cleanText(query, 1200), {
      signal,
      budget: env.hindsightRecallBudget,
      maxTokens: env.hindsightRecallMaxTokens,
      includeEntities: true,
      preferObservations: true,
    }));
    const formatted = formatHindsightRecall(response);
    return {
      enabled: true,
      source: formatted.items ? "hindsight" : "none",
      bankId,
      ...formatted,
    };
  } catch (error) {
    console.warn(`Hindsight recall warning: ${error?.message || error}`);
    return { enabled: true, source: "hindsight_unavailable", bankId, text: "", items: 0, factIds: [] };
  }
}

export async function retainCustomerCase({
  customerId,
  runId,
  question,
  answer,
  runtimeMeta,
  escalation = null,
}) {
  if (!isEnabled() || !customerId) return { enabled: false, retained: false };
  if (!runtimeMeta?.primary_article_id && !escalation) return { enabled: true, retained: false };

  const hindsight = getClient();
  const bankId = hindsightBankId(customerId);
  const operationId = runId || crypto.randomUUID();
  try {
    await ensureBank(bankId);
    const response = await withTimeout((signal) => hindsight.retain(
      bankId,
      buildHindsightCaseContent({ question, answer, runtimeMeta, escalation }),
      {
        signal,
        async: env.hindsightRetainAsync,
        ...(env.hindsightRetainAsync ? { operationId } : {}),
        timestamp: new Date().toISOString(),
        context: "NAVA customer support case",
        documentId: `nava-case-${operationId}`,
        tags: ["source:nava", escalation ? "status:escalated" : "status:grounded"],
        metadata: {
          source: "nava",
          run_id: operationId,
          article_id: String(runtimeMeta?.primary_article_id || ""),
        },
      }
    ));
    return {
      enabled: true,
      retained: Boolean(response?.success),
      bankId,
      operationId: response?.operation_id || operationId,
    };
  } catch (error) {
    console.warn(`Hindsight retain warning: ${error?.message || error}`);
    return { enabled: true, retained: false, bankId, operationId };
  }
}

export const __hindsightInternals = {
  cleanText,
  redactSensitiveText,
  isEnabled,
  formatHindsightRecall,
  buildHindsightCaseContent,
};
