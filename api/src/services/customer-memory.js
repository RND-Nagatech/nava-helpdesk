import { env } from "../config/env.js";
import { getLongTermStore } from "./agent-memory.js";
import { getCrossSessionContext } from "./chat-history.js";
import { formatCrossSessionContext } from "./cross-session-context.js";
import { problemMatchScore } from "../utils/text.js";

function cleanText(value = "", maxChars = 600) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function memoryNamespace(customerId) {
  return ["nava", "customer", customerId];
}

function emptyMemory() {
  return {
    version: 1,
    recent_cases: [],
    updated_at: null,
  };
}

export async function getCustomerLongTermMemory(customerId) {
  if (!env.longTermMemoryEnabled || !customerId) return emptyMemory();
  const store = getLongTermStore();
  if (!store) return emptyMemory();

  try {
    const record = await store.get(memoryNamespace(customerId), "memory");
    return record?.value && typeof record.value === "object"
      ? { ...emptyMemory(), ...record.value }
      : emptyMemory();
  } catch (error) {
    console.warn(`Long-term memory read warning: ${error?.message || error}`);
    return emptyMemory();
  }
}

function memoryPseudoArticle(item = {}) {
  return {
    title: item.primary_article_title || item.question || "",
    symptoms: [item.question || ""],
    tags: [],
    category: "",
  };
}

export function selectRelevantLongTermCases(memory, currentQuestion = "") {
  const cases = Array.isArray(memory?.recent_cases) ? memory.recent_cases : [];
  const question = cleanText(currentQuestion, 1000);
  if (!cases.length) return [];
  if (!question) return cases.slice(-env.longTermMemoryCaseLimit);

  const ranked = cases
    .map((item, index) => ({
      item,
      index,
      relevance: problemMatchScore(question, memoryPseudoArticle(item)),
    }))
    .filter(({ relevance }) =>
      relevance.distinctiveCoverage >= 0.34 ||
      relevance.coverage >= 0.4
    )
    .sort((a, b) =>
      b.relevance.distinctiveCoverage - a.relevance.distinctiveCoverage ||
      b.relevance.coverage - a.relevance.coverage ||
      b.relevance.score - a.relevance.score ||
      b.index - a.index
    )
    .slice(0, Math.min(3, env.longTermMemoryCaseLimit))
    .map(({ item }) => item);

  if (ranked.length) return ranked;

  // Referensi eksplisit ke masa lalu butuh minimal satu memory terakhir walaupun kata
  // masalah tidak diulang. Ini hanya fallback konteks, bukan sumber fakta program.
  if (isPastReference(question)) {
    return cases.slice(-Math.min(2, env.longTermMemoryCaseLimit));
  }

  return [];
}


function isPastReference(question = "") {
  return /(kemarin|sebelumnya|sebelum ini|yang lalu|pernah|masih sama|error lagi|kendala lagi)/i.test(String(question || ""));
}

function selectRelevantLegacyItems(items = [], currentQuestion = "") {
  const question = cleanText(currentQuestion, 1000);
  if (!question) return items;

  const relevant = items.filter((item) => {
    const relevance = problemMatchScore(question, {
      title: item.primary_article_title || item.content || "",
      symptoms: [item.content || ""],
      tags: [],
      category: "",
    });
    return relevance.distinctiveCoverage >= 0.34 || relevance.coverage >= 0.4;
  });

  if (relevant.length) return relevant.slice(-env.crossSessionHistoryLimit);
  if (isPastReference(question)) return items.slice(-Math.min(4, env.crossSessionHistoryLimit));
  return [];
}

export function formatCustomerLongTermMemory(memory, casesOverride = null) {
  const cases = Array.isArray(casesOverride)
    ? casesOverride
    : Array.isArray(memory?.recent_cases)
      ? memory.recent_cases
      : [];
  if (!cases.length) return "";

  const lines = [
    "MEMORI JANGKA PANJANG CUSTOMER YANG RELEVAN:",
    "Gunakan hanya untuk memahami konteks/masalah yang pernah terjadi bila benar-benar berkaitan dengan pesan sekarang. Jangan menyebut kasus lama yang tidak ditanyakan customer. Ini bukan pengganti knowledge resmi dan bukan sumber fakta program realtime.",
  ];

  for (const item of cases.slice(-env.longTermMemoryCaseLimit)) {
    const article = item.primary_article_title ? ` → knowledge: ${item.primary_article_title}` : "";
    const status = item.status ? ` [${item.status}]` : "";
    lines.push(`- ${cleanText(item.question, 350)}${article}${status}`);
    if (item.answer_excerpt) lines.push(`  Respons grounded sebelumnya: ${cleanText(item.answer_excerpt, 450)}`);
  }

  return lines.join("\n");
}

export async function loadCustomerMemoryContext({ customerId, currentSessionId, currentQuestion = "" }) {
  if (!customerId) {
    return { text: "", source: "none", items: 0, memory: emptyMemory() };
  }

  const memory = await getCustomerLongTermMemory(customerId);
  const relevantCases = selectRelevantLongTermCases(memory, currentQuestion);
  const longTermText = formatCustomerLongTermMemory(memory, relevantCases);
  if (longTermText) {
    return {
      text: longTermText,
      source: "mongodb_store",
      items: relevantCases.length,
      memory,
    };
  }

  // Jika customer sudah punya long-term memory tetapi tidak ada yang relevan, jangan
  // menggantinya dengan dump chat lama karena itu justru dapat mengotori konteks aktif.
  const hasStoredCases = Array.isArray(memory?.recent_cases) && memory.recent_cases.length > 0;
  if (hasStoredCases) {
    return { text: "", source: "none", items: 0, memory };
  }

  // Migration/fallback ringan untuk customer yang belum punya memory v2.4.
  if (env.crossSessionContextEnabled) {
    const legacy = await getCrossSessionContext({ customerId, currentSessionId });
    const relevantLegacy = selectRelevantLegacyItems(legacy, currentQuestion);
    const legacyText = formatCrossSessionContext(relevantLegacy);
    if (legacyText) {
      return {
        text: legacyText,
        source: "chat_history_fallback",
        items: relevantLegacy.length,
        memory,
      };
    }
  }

  return { text: "", source: "none", items: 0, memory };
}

export async function rememberGroundedCase({
  customerId,
  sessionId,
  runId,
  question,
  answer,
  runtimeMeta,
  escalation = null,
}) {
  if (!env.longTermMemoryEnabled || !customerId) return false;
  if (!runtimeMeta?.primary_article_id && !escalation) return false;

  const store = getLongTermStore();
  if (!store) return false;

  try {
    const current = await getCustomerLongTermMemory(customerId);
    const recent = Array.isArray(current.recent_cases) ? [...current.recent_cases] : [];

    const item = {
      run_id: runId,
      session_id: sessionId,
      question: cleanText(question, 500),
      answer_excerpt: cleanText(answer, env.longTermMemoryAnswerMaxChars),
      primary_article_id: runtimeMeta?.primary_article_id || null,
      primary_article_title: runtimeMeta?.primary_article_title || null,
      evidence_strength: runtimeMeta?.evidence_strength || null,
      status: escalation ? "escalated" : "grounded_answer",
      created_at: new Date().toISOString(),
    };

    // Hindari duplikasi yang identik dari retry/test berulang.
    const deduped = recent.filter((old) => old.run_id !== runId);
    deduped.push(item);

    const value = {
      version: 1,
      recent_cases: deduped.slice(-env.longTermMemoryCaseLimit),
      updated_at: new Date().toISOString(),
    };

    await store.put(memoryNamespace(customerId), "memory", value);
    return true;
  } catch (error) {
    console.warn(`Long-term memory write warning: ${error?.message || error}`);
    return false;
  }
}
