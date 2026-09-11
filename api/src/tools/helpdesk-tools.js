import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { retrieveKnowledge } from "../services/knowledge-retriever.js";
import { env } from "../config/env.js";
import { agentRunContext } from "../services/agent-run-context.js";
import { isLowInformationToken, mergeSearchQuery, normalizeText, tokenize } from "../utils/text.js";

function hasCurrentTopic(question = "") {
  const tokens = tokenize(question, { removeStopWords: true, expand: false });
  const distinctive = tokens.filter((token) => !isLowInformationToken(token));
  return distinctive.length >= 2;
}

function prefersCurrentQuestion(question = "") {
  // Pertanyaan yang sudah menyebut objek + tindakan harus menjadi anchor utama.
  // History tetap dipakai untuk follow-up pendek seperti "yang kedua bagaimana?".
  return hasCurrentTopic(question);
}

function compactPrimaryArticle(doc) {
  return {
    article_id: doc.articleId,
    title: doc.title,
    category: doc.category,
    symptoms: doc.symptoms || [],
    troubleshooting_steps: (doc.troubleshootingSteps || []).map((step) => ({
      order: step.order,
      title: step.title,
      instruction: step.instruction,
      expected_result: step.expectedResult,
    })),
    escalation_rules: doc.escalationRules || [],
    user_response_template: doc.userResponseTemplate || "",
    retrieval: buildRetrievalMeta(doc),
  };
}

function buildRetrievalMeta(doc) {
  return {
    lexical_score: doc.retrieval?.lexicalScore || 0,
    lexical_coverage: doc.retrieval?.coverage || 0,
    lexical_distinctive_coverage: doc.retrieval?.lexicalDistinctiveCoverage || 0,
    problem_score: doc.retrieval?.problemScore || 0,
    problem_coverage: doc.retrieval?.problemCoverage || 0,
    problem_matched_tokens: doc.retrieval?.problemMatchedTokens || [],
    problem_distinctive_coverage: doc.retrieval?.problemDistinctiveCoverage || 0,
    problem_distinctive_matched_tokens: doc.retrieval?.problemDistinctiveMatchedTokens || [],
    title_distinctive_coverage: doc.retrieval?.titleDistinctiveCoverage || 0,
    domain_coverage: doc.retrieval?.domainCoverage || 0,
    vector_score: doc.retrieval?.vectorScore || 0,
    hybrid_score: doc.retrieval?.hybridScore || 0,
    evidence_strength: doc.retrieval?.evidenceStrength || "weak",
    keyword_rank: doc.retrieval?.keywordRank ?? null,
    vector_rank: doc.retrieval?.vectorRank ?? null,
  };
}

function compactSupportingArticle(doc) {
  return {
    article_id: doc.articleId,
    title: doc.title,
    category: doc.category,
    symptoms: (doc.symptoms || []).slice(0, 4),
    retrieval: buildRetrievalMeta(doc),
  };
}

function buildSearchPayload(result, { status, requestedQuery = "", reusedPrimary = false } = {}) {
  const primaryDoc = result.documents[0] || null;
  const evidenceStrength = result.primaryEvidence?.strength || primaryDoc?.retrieval?.evidenceStrength || "none";
  const isStrongEvidence = evidenceStrength === "strong";
  const primaryArticle = primaryDoc ? compactPrimaryArticle(primaryDoc) : null;

  // Strong evidence cukup membawa primary article agar konteks LLM tidak tercampur kandidat lemah.
  // Jika primary tidak menjawab kebutuhan aktual, agent masih boleh memakai search kedua.
  const supportingCandidates = isStrongEvidence
    ? []
    : result.documents.slice(1, 3).map(compactSupportingArticle);

  return {
    status: status || (result.found ? "success" : "not_found"),
    found: result.found,
    requested_query: requestedQuery || result.query,
    query: result.query,
    retrieval_mode: result.retrievalMode,
    confidence: result.confidence,
    evidence_strength: evidenceStrength,
    primary_article: primaryArticle,
    supporting_candidates: supportingCandidates,
    reused_primary: reusedPrimary,
    vector: {
      enabled: result.vector.enabled,
      ok: result.vector.ok,
      error: result.vector.error || null,
    },
    timing: result.timing || null,
    candidates: result.found ? undefined : result.candidates.slice(0, 3).map(compactSupportingArticle),
    instruction_to_agent: result.found
      ? evidenceStrength === "strong"
        ? "PRIMARY_ARTICLE adalah kandidat kuat. Jawab langsung jika judul/objek dan kebutuhan customer memang cocok. Jika customer secara eksplisit menyebut fitur/objek yang berbeda, atau PRIMARY_ARTICLE tidak menjawab kebutuhan saat ini, Anda boleh memakai satu pencarian tersisa dengan query yang lebih spesifik; jangan terikat pada hasil pertama."
        : "Gunakan PRIMARY_ARTICLE sebagai evidence utama bila memang menjawab kebutuhan customer. Jika belum tepat, lakukan maksimal satu pencarian lagi dengan mempertahankan istilah pembeda dari customer. Jika tetap ambigu, buat sendiri satu pertanyaan klarifikasi yang spesifik dari konteks; jangan menebak."
      : "Knowledge belum cukup kuat. Boleh coba satu query alternatif yang tetap mempertahankan istilah inti customer dan hanya memperjelas kebutuhan. Jika tetap tidak ada, buat satu klarifikasi spesifik atau eskalasi bila memang diperlukan. Jangan menebak.",
  };
}

function strengthRank(value) {
  return { none: 0, weak: 1, semantic: 2, medium: 3, strong: 4 }[value] || 0;
}

function resultQuality(result) {
  const primary = result?.documents?.[0];
  if (!primary) return -1;
  return (
    strengthRank(result.primaryEvidence?.strength || primary.retrieval?.evidenceStrength) * 1000 +
    Number(primary.retrieval?.problemDistinctiveCoverage || 0) * 300 +
    Number(primary.retrieval?.titleDistinctiveCoverage || 0) * 200 +
    Number(primary.retrieval?.problemCoverage || 0) * 100 +
    Number(primary.retrieval?.hybridScore || 0)
  );
}

function rememberSearchResult(state, result) {
  if (!state) return;
  if (!state.firstSearchResult) state.firstSearchResult = result;
  if (!state.bestSearchResult || resultQuality(result) > resultQuality(state.bestSearchResult)) {
    state.bestSearchResult = result;
  }
  state.searchResults = [...(state.searchResults || []), result].slice(-env.searchToolCallLimit);
}

const searchKnowledgeTool = tool(
  async ({ query, top_k }) => {
    const state = agentRunContext.getStore();
    if (state) {
      state.searchAttempts = (state.searchAttempts || 0) + 1;

      if (state.searchAttempts > env.searchToolCallLimit) {
        const best = state.bestSearchResult || state.firstSearchResult;
        return JSON.stringify({
          status: "search_limit_reached",
          found: Boolean(best?.found),
          query,
          instruction_to_agent: "Batas pencarian knowledge untuk satu turn sudah tercapai. Gunakan evidence terbaik dari pencarian yang sudah dilakukan; jika belum cukup, buat klarifikasi spesifik atau eskalasi. Jangan menebak dan jangan panggil search_knowledge lagi pada turn ini.",
        });
      }
    }

    const originalQuestion = state?.currentQuestion || "";
    const effectiveQuery = mergeSearchQuery(query, originalQuestion);

    // Hanya reuse bila query kedua benar-benar identik setelah normalisasi. Query yang
    // lebih spesifik harus benar-benar dieksekusi agar agent dapat memperbaiki hasil pertama.
    const normalizedEffective = normalizeText(effectiveQuery);
    const samePrevious = state?.searchResults?.find((item) => normalizeText(item?.query || "") === normalizedEffective);
    if (samePrevious) {
      return JSON.stringify(buildSearchPayload(samePrevious, {
        status: "reused_same_query",
        requestedQuery: query,
        reusedPrimary: true,
      }));
    }

    const currentQuestionIsSpecific = prefersCurrentQuestion(originalQuestion);
    const primaryQuery = currentQuestionIsSpecific ? originalQuestion : effectiveQuery;
    const alternateQuery = currentQuestionIsSpecific ? effectiveQuery : originalQuestion;
    let result = await retrieveKnowledge(primaryQuery, { topK: top_k });

    // Bila pertanyaan terbaru terlalu pendek/ambigu atau anchor utama benar-benar
    // tidak menemukan apa-apa, baru gunakan query hasil rewrite + history.
    if (
      normalizeText(alternateQuery) !== normalizeText(primaryQuery) &&
      !result.found
    ) {
      const alternateResult = await retrieveKnowledge(alternateQuery, { topK: top_k });
      if (alternateResult.found || !result.candidates?.length) result = alternateResult;
    }
    rememberSearchResult(state, result);
    return JSON.stringify(buildSearchPayload(result, { requestedQuery: query }));
  },
  {
    name: "search_knowledge",
    description: `Cari knowledge resmi Nagatech untuk menjawab pertanyaan, penggunaan fitur, atau troubleshooting pada program yang sedang digunakan customer.
Untuk deployment saat ini jangan gunakan tool ini untuk menebak atau menanyakan nama program; anggap knowledge yang tersedia memang relevan untuk program yang sedang digunakan customer.
Tool menggunakan hybrid keyword + vector semantic retrieval dan problem/symptom reranking.
Buat query yang dapat berdiri sendiri dari current question + konteks percakapan, tetapi PERTAHANKAN frasa/istilah pembeda yang customer sebutkan. Boleh menambahkan bentuk formal atau sinonim; jangan mengganti istilah inti hingga hilang.
Contoh: customer mengatakan "batal titipan"; query boleh diperjelas, tetapi frasa/konsep batal + titipan harus tetap terwakili. Jangan menambahkan dugaan penyebab atau solusi.
Pada follow-up, jika kebutuhan berubah dari "apa" menjadi "di mana", "cara", "langkah berikutnya", atau detail lain, lakukan retrieval baru bila knowledge baru diperlukan walaupun topiknya sama.
Gunakan sebelum menjawab fakta atau prosedur program/produk Nagatech.
Jika hasil belum cukup dan perlu klarifikasi, pertanyaan klarifikasi harus dibuat oleh model dari konteks percakapan; knowledge tidak menyediakan canned clarification question.`,
    schema: z.object({
      query: z.string().trim().min(2).max(1200).describe("Query knowledge yang lengkap. Pertahankan istilah pembeda customer dan tambahkan bentuk formal/sinonim jika perlu; jangan menambahkan diagnosis atau solusi yang belum didukung evidence."),
      top_k: z.number().int().min(1).max(8).optional().describe("Jumlah artikel terbaik yang dibutuhkan. Default mengikuti konfigurasi server."),
    }),
  }
);

const escalateHelpdeskTool = tool(
  async ({ issue_summary, reason, attempted_steps }) => {
    return JSON.stringify({
      status: "escalation_confirmation_required",
      issue_summary,
      reason,
      attempted_steps: attempted_steps || [],
      instruction_to_agent: "Jangan mengatakan ticket sudah dibuat. Tawarkan secara natural apakah customer ingin kendala ini diteruskan ke helpdesk manusia. Ticket baru dibuat setelah customer menyetujui.",
    });
  },
  {
    name: "escalate_helpdesk",
    description: "Tandai kendala untuk eskalasi ke helpdesk manusia ketika customer meminta bantuan manusia dengan masalah yang jelas, knowledge menyatakan perlu eskalasi, atau troubleshooting relevan sudah dicoba tetapi gagal. Jangan gunakan tool ini hanya untuk pertanyaan informasi/cara pakai seperti apa fungsi fitur, di mana menu, cara melihat laporan, atau pilihan laporan; jika belum yakin, gunakan retrieval/clarification dulu.",
    schema: z.object({
      issue_summary: z.string().trim().min(3).max(1000),
      reason: z.string().trim().min(3).max(1000),
      attempted_steps: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
    }),
  }
);

export const helpdeskTools = [searchKnowledgeTool, escalateHelpdeskTool];

export const __toolInternals = {
  resultQuality,
  rememberSearchResult,
};
