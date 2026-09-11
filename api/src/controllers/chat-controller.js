import crypto from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { runHelpdeskAgent } from "../agents/helpdesk-agent.js";
import {
  deleteChatSession,
  getChatMessages,
  getLastChatMessage,
  getSessionMessagePage,
  hasSessionMessages,
  saveChatMessage,
} from "../services/chat-history.js";
import { deleteAgentTraceSession, saveAgentTrace } from "../services/agent-trace.js";
import { retrieveKnowledge } from "../services/knowledge-retriever.js";
import {
  getCustomerLongTermMemory,
  loadCustomerMemoryContext,
  rememberGroundedCase,
} from "../services/customer-memory.js";
import { deleteAgentThread } from "../services/agent-memory.js";
import { createTicket, findActiveTicketBySession, markCustomerMessageOnTicket } from "../services/ticket-service.js";
import { publishEvent } from "../services/event-bus.js";

const chatSchema = z.object({
  question: z.string().trim().min(2).max(4000),
  session_id: z.string().trim().min(3).max(200).optional(),
  customer_id: z.string().trim().min(2).max(200).optional(),
  customer_name: z.string().trim().max(200).optional(),
  customer_domain: z.string().trim().max(200).optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    original_name: z.string(),
    mime_type: z.string(),
    size: z.number(),
    url: z.string(),
  })).max(5).optional(),
});

const searchSchema = z.object({
  query: z.string().trim().min(2).max(1200),
  top_k: z.number().int().min(1).max(20).optional(),
});

export function isGenericHumanHandoverRequest(question) {
  const text = String(question || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  const asksHuman = /(petugas|admin|helpdesk|manusia|operator|cs|customer service)/i.test(text);
  const describesProblem = /(tidak|gak|nggak|ga |error|eror|gagal|lupa|login|password|struk|printer|transaksi|barcode|selisih|muncul|keluar|bisa|kendala|masalah)/i.test(text);
  return asksHuman && !describesProblem;
}

export function isExplicitHumanHandoverRequest(question) {
  const text = String(question || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;

  const mentionsHuman = /(petugas|admin|helpdesk|manusia|operator|customer service|\bcs\b)/i.test(text);
  const handoverAction = /(mau|ingin|minta|tolong|bantu|dibantu|hubung|hubungi|hubungkan|sambung|sambungkan|teruskan|lanjutkan|eskalasi|langsung|ke petugas|ke helpdesk|ke admin)/i.test(text);
  const ticketRequest = /(buat|buatkan|bikin|bikinin|bikinkan|create|terbitkan).{0,30}(tiket|ticket)|(tiket|ticket).{0,30}(buat|buatkan|bikin|bikinin|bikinkan|create|terbitkan)/i.test(text);

  return (mentionsHuman && handoverAction) || ticketRequest;
}

function isShortAcknowledgement(question) {
  const text = String(question || "").toLowerCase().replace(/\s+/g, " ").trim();
  return /^(iya|ya|y|ok|oke|boleh|siap|lanjut|lanjutkan|teruskan|iya boleh|ya boleh|boleh lanjut|boleh teruskan)(\b|[.!?])/i.test(text);
}

function isMeaningfulIssueMessage(message) {
  if (!message || message.role !== "user") return false;
  const text = String(message.content || "").replace(/\s+/g, " ").trim();
  if (text.length < 4) return false;
  // Abaikan permintaan helpdesk yang hanya meminta petugas, tetapi tetap
  // simpan konteks masalah jika user menyebutkan kendalanya dalam kalimat yang sama.
  if (isExplicitHumanHandoverRequest(text) && isGenericHumanHandoverRequest(text)) return false;
  if (isShortAcknowledgement(text)) return false;
  return true;
}

export function deriveHandoverIssue(messages = []) {
  const recent = [...messages].reverse();
  const row = recent.find(isMeaningfulIssueMessage);
  if (!row) {
    return {
      subject: "Permintaan bantuan helpdesk",
      reason: "Customer meminta bantuan petugas manusia melalui chat.",
    };
  }

  const issue = String(row.content || "").replace(/\s+/g, " ").trim();
  return {
    subject: issue.slice(0, 220),
    reason: `Customer meminta bantuan petugas manusia melalui chat. Konteks terakhir: ${issue}`.slice(0, 1000),
  };
}

export function isInformationalProgramQuestion(question) {
  const text = String(question || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  const asksHowOrWhere = /(apa|fungsi|buat apa|cara|gimana|bagaimana|dimana|di mana|letak|menu|lihat|liat|buka|cari|rekap|laporan|report)/i.test(text);
  const hasFailureSignal = /(tidak bisa|gak bisa|nggak bisa|ga bisa|tak bisa|error|eror|gagal|crash|hang|macet|lupa|password salah|struk.*tidak|struk.*gak|printer.*tidak|printer.*gak|selisih|hilang|rusak|kendala|masalah)/i.test(text);
  const asksHuman = /(petugas|admin|helpdesk|manusia|operator|cs|customer service)/i.test(text);
  return asksHowOrWhere && !hasFailureSignal && !asksHuman;
}

export function shouldCreateAgentEscalationTicket({ question, escalation }) {
  if (!escalation) return false;
  if (isInformationalProgramQuestion(question)) return false;

  const text = [
    question,
    escalation.issue_summary,
    escalation.reason,
    ...(escalation.attempted_steps || []),
  ].filter(Boolean).join(" ").toLowerCase();

  const asksHuman = /(petugas|admin|helpdesk|manusia|operator|cs|customer service)/i.test(text);
  const hasFailureSignal = /(tidak bisa|gak bisa|nggak bisa|ga bisa|tak bisa|error|eror|gagal|crash|hang|macet|lupa|password salah|struk.*tidak|struk.*gak|printer.*tidak|printer.*gak|selisih|hilang|rusak|kendala|masalah)/i.test(text);
  const hasAttemptedSteps = Array.isArray(escalation.attempted_steps) && escalation.attempted_steps.length > 0;
  return asksHuman || hasFailureSignal || hasAttemptedSteps;
}

export function isAffirmativeEscalationReply(question) {
  const text = String(question || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  return /^(iya|ya|y|boleh|ok|oke|siap|lanjut|teruskan|hubungkan|iya boleh|ya boleh|boleh lanjut|boleh teruskan|lanjutkan)(\b|[.!?])/.test(text);
}

export function isNegativeEscalationReply(question) {
  const text = String(question || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  return /^(tidak|nggak|gak|ga|jangan|belum|nanti|skip)(\b|[.!?])/.test(text);
}

function pendingEscalationFromMessage(message) {
  const meta = message?.metadata?.runtime_meta || {};
  if (message?.role !== "assistant" || !meta.pending_escalation_confirmation) return null;
  return meta.pending_escalation || null;
}

export function escalationConsentQuestion(escalation = {}) {
  const issue = String(escalation.issue_summary || "").trim();
  const prefix = issue
    ? `Saya belum bisa memastikan solusi final untuk: ${issue}.`
    : "Saya belum bisa memastikan solusi final dari informasi yang ada.";
  return `${prefix} Mau saya teruskan ke helpdesk supaya petugas bisa bantu cek lebih lanjut?`;
}

export function hasTicketCreatedClaim(answer) {
  const text = String(answer || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return false;
  const claimsCreatedTicket = /(tiket|ticket).{0,80}(dibuat|terbuat|sudah dibuat|otomatis dibuat|dibikinkan|terbuka|tercatat)/i.test(text);
  const claimsForwarded = /(sudah|telah).{0,40}(saya )?(teruskan|diteruskan|eskalasikan|kirimkan|arahkan).{0,80}(helpdesk|petugas|tim|admin|manusia)/i.test(text);
  return claimsCreatedTicket || claimsForwarded;
}

function questionPreview(question = "") {
  const text = String(question || "").replace(/\s+/g, " ").trim().slice(0, 180);
  return text ? ` untuk pertanyaan "${text}"` : " untuk pertanyaan ini";
}

export function sanitizeAnswerWithoutTicket({ answer, question, escalationBlocked, pendingEscalation = null }) {
  if (!hasTicketCreatedClaim(answer)) return answer;
  if (pendingEscalation) return escalationConsentQuestion(pendingEscalation);
  if (escalationBlocked || isInformationalProgramQuestion(question)) {
    return `Saya belum menemukan panduan yang cukup tepat${questionPreview(question)}, jadi saya belum membuat ticket. Saya bantu cek lewat chat dulu; jika masih belum jelas, saya bisa bantu arahkan ke helpdesk.`;
  }
  return `Saya belum bisa memastikan solusi${questionPreview(question)}, jadi saya belum membuat ticket. Jika Anda ingin dibantu petugas, saya bisa meneruskan kasus ini ke helpdesk untuk dicek lebih lanjut.`;
}

function groundedAnswerFromAgentResult(result) {
  const searchCalls = (result?.toolTrace || [])
    .filter((item) => item?.name === "search_knowledge" && item?.result?.found && item?.result?.primary_article)
    .reverse();
  for (const call of searchCalls) {
    const article = call.result.primary_article;
    const strength = call.result.evidence_strength || article?.retrieval?.evidence_strength || "weak";
    if (strength !== "strong") continue;
    const template = String(article.user_response_template || "").trim();
    if (template) return template;
    const steps = (article.troubleshooting_steps || [])
      .map((step) => String(step?.instruction || "").trim())
      .filter(Boolean);
    if (steps.length) return steps.join("\n");
  }
  return "Saya belum menemukan panduan yang cukup tepat untuk memastikan jawabannya. Sebutkan nama menu atau laporan yang dimaksud persis seperti yang tampil di program, supaya saya cari panduan yang lebih tepat.";
}

function hasStrongGroundedSearch(result) {
  return (result?.searches || []).some((search) => (
    search?.found &&
    search?.evidence_strength === "strong" &&
    search?.primary_article
  ));
}

function answerNeedsGroundedFallback(answer = "") {
  return /(belum (menemukan|punya|bisa|dapat memastikan|membuat ticket|membuat tiket)|tidak (menemukan|tahu|bisa memastikan)|belum ada panduan|tidak ada panduan|minta bantuan helpdesk|teruskan ke helpdesk|dibuatkan ticket|dibuatkan tiket)/i.test(answer);
}

function publicSearches(searches = []) {
  return searches.map((search) => ({
    query: search.query,
    found: search.found,
    confidence: search.confidence,
    mode: search.mode,
    vector: search.vector,
    timing: search.timing || null,
    status: search.status,
    evidence_strength: search.evidence_strength,
    reused_primary: search.reused_primary,
    primary_article: search.primary_article,
    sources: search.sources,
    fallback_candidates: search.fallback_candidates,
  }));
}

export async function chat(req, res, next) {
  try {
    const input = chatSchema.parse(req.body);
    const sessionId = input.session_id || crypto.randomUUID();
    const customerId = input.customer_id || null;

    // Dua read ringan dilakukan paralel: cek first-turn + long-term memory.
    // Active conversation history TIDAK dibaca manual lagi karena ditangani Checkpointer.
    const [hasHistory, memoryContext] = await Promise.all([
      hasSessionMessages(sessionId),
      loadCustomerMemoryContext({ customerId, currentSessionId: sessionId, currentQuestion: input.question }),
    ]);
    const isFirstTurn = !hasHistory;

    const [activeTicket, previousMessage] = await Promise.all([
      findActiveTicketBySession(sessionId),
      getLastChatMessage(sessionId),
    ]);
    const pendingEscalation = pendingEscalationFromMessage(previousMessage);

    const userMessage = await saveChatMessage({
      sessionId,
      customerId,
      role: "user",
      content: input.question,
      metadata: {
        attachments: input.attachments || [],
        customer_name: input.customer_name || null,
        customer_domain: input.customer_domain || null,
      },
    });
    publishEvent("new_message", { session_id: sessionId, message: userMessage });

    if (activeTicket) {
      await markCustomerMessageOnTicket(sessionId);
      return res.json({
        success: true,
        data: {
          session_id: sessionId,
          customer_id: customerId,
          handover_active: true,
          ticket: {
            _id: String(activeTicket._id),
            ticket_code: activeTicket.ticket_code,
            status: activeTicket.status,
            handover_status: activeTicket.handover_status,
          },
          answer: "Percakapan ini sedang diteruskan ke helpdesk. Pesan Anda sudah masuk ke petugas manusia.",
          meta: { routed_to: "helpdesk" },
        },
      });
    }

    if (pendingEscalation && isAffirmativeEscalationReply(input.question)) {
      const result = await createTicket({
        sessionId,
        customerId,
        customerName: input.customer_name,
        customerDomain: input.customer_domain,
        subject: pendingEscalation.issue_summary || "Permintaan bantuan helpdesk",
        reason: pendingEscalation.reason || "Customer menyetujui handover ke helpdesk.",
        source: pendingEscalation.source || "agent_escalation",
        priority: "normal",
      });
      const assistantMessage = await saveChatMessage({
        sessionId,
        customerId,
        role: "assistant",
        content: "Siap, saya teruskan ke helpdesk ya. Ticket sudah dibuat dari percakapan ini, petugas akan bantu cek lebih lanjut.",
        metadata: {
          runtime_meta: {
            escalation_confirmed: true,
            direct_customer_handover: pendingEscalation.source === "customer_button",
            ticket_code: result.ticket.ticket_code,
          },
        },
      });
      publishEvent("new_message", { session_id: sessionId, message: assistantMessage });

      return res.json({
        success: true,
        data: {
          session_id: sessionId,
          customer_id: customerId,
          answer: assistantMessage.content,
          handover_active: true,
          ticket: result.ticket,
          meta: assistantMessage.metadata.runtime_meta,
        },
      });
    }

    if (pendingEscalation && isNegativeEscalationReply(input.question)) {
      const assistantMessage = await saveChatMessage({
        sessionId,
        customerId,
        role: "assistant",
        content: "Oke, belum saya teruskan ke helpdesk. Kita lanjut cek di sini dulu ya. Bisa ceritakan bagian mana yang masih membingungkan atau yang ingin dicoba?",
        metadata: {
          runtime_meta: {
            escalation_declined: true,
          },
        },
      });
      publishEvent("new_message", { session_id: sessionId, message: assistantMessage });

      return res.json({
        success: true,
        data: {
          session_id: sessionId,
          customer_id: customerId,
          answer: assistantMessage.content,
          meta: assistantMessage.metadata.runtime_meta,
        },
      });
    }

    if (isExplicitHumanHandoverRequest(input.question)) {
      // Permintaan bantuan manusia masuk ke satu konfirmasi singkat. Jika
      // customer menjawab iya, branch di atas membuat ticket tanpa agent lagi.
      const recentMessages = await getChatMessages(sessionId, { limit: 12 });
      const handoverIssue = deriveHandoverIssue(recentMessages);
      const pendingHandover = {
        ...handoverIssue,
        source: "customer_button",
      };
      const assistantMessage = await saveChatMessage({
        sessionId,
        customerId,
        role: "assistant",
        content: "Baik, saya teruskan percakapan ini ke helpdesk. Apakah saya buatkan tiket sekarang?",
        metadata: {
          runtime_meta: {
            pending_escalation_confirmation: true,
            pending_escalation: pendingHandover,
            direct_customer_handover: true,
          },
        },
      });
      publishEvent("new_message", { session_id: sessionId, message: assistantMessage });

      return res.json({
        success: true,
        data: {
          session_id: sessionId,
          customer_id: customerId,
          answer: assistantMessage.content,
          handover_active: false,
          meta: assistantMessage.metadata.runtime_meta,
        },
      });
    }

    const result = await runHelpdeskAgent({
      sessionId,
      customerId,
      question: input.question,
      attachments: input.attachments || [],
      isFirstTurn,
      memoryContext,
    });

    const searches = publicSearches(result.searches);
    const allowAgentEscalation = shouldCreateAgentEscalationTicket({
      question: input.question,
      escalation: result.escalation,
    });
    const effectiveEscalation = allowAgentEscalation ? result.escalation : null;
    const effectiveRuntimeMeta = {
      ...result.runtimeMeta,
      needs_escalation: false,
      pending_escalation_confirmation: Boolean(effectiveEscalation),
      pending_escalation: effectiveEscalation,
      agent_escalation_blocked: Boolean(result.escalation && !allowAgentEscalation),
      agent_latency_ms: result.latencyMs,
    };
    const escalationBlocked = Boolean(result.escalation && !allowAgentEscalation);
    const effectiveAnswer = effectiveEscalation
      ? sanitizeAnswerWithoutTicket({
          answer: result.answer,
          question: input.question,
          escalationBlocked: false,
          pendingEscalation: effectiveEscalation,
        })
      : escalationBlocked
        ? groundedAnswerFromAgentResult(result)
        : hasStrongGroundedSearch(result) && answerNeedsGroundedFallback(result.answer)
          ? groundedAnswerFromAgentResult(result)
          : sanitizeAnswerWithoutTicket({
              answer: result.answer,
              question: input.question,
              escalationBlocked: false,
            });
    const assistantMetadata = {
      run_id: result.runId,
      tool_call_count: result.toolCallCount,
      model_call_count: result.modelCallCount,
      grounding_retry: result.groundingRetry,
      searches,
      escalation: null,
      runtime_meta: effectiveRuntimeMeta,
    };

    // Semua persistence setelah jawaban dilakukan paralel supaya latency tambahan minimal.
    const [assistantMessage] = await Promise.all([
      saveChatMessage({
        sessionId,
        customerId,
        role: "assistant",
        content: effectiveAnswer,
        metadata: assistantMetadata,
      }),
      saveAgentTrace({
        runId: result.runId,
        sessionId,
        customerId,
        question: input.question,
        answer: effectiveAnswer,
        toolTrace: result.toolTrace,
        searches,
        escalation: null,
        latencyMs: result.latencyMs,
        modelCallCount: result.modelCallCount,
        memorySource: memoryContext.source,
      }),
      rememberGroundedCase({
        customerId,
        sessionId,
        runId: result.runId,
        question: input.question,
        answer: effectiveAnswer,
        runtimeMeta: effectiveRuntimeMeta,
        escalation: null,
      }),
    ]);
    publishEvent("new_message", { session_id: sessionId, message: assistantMessage });

    const data = {
      session_id: sessionId,
      customer_id: customerId,
      run_id: result.runId,
      answer: effectiveAnswer,
      meta: effectiveRuntimeMeta,
    };

    if (env.debugAgent || env.debugRetrieval) {
      data.agent = {
        tool_call_count: result.toolCallCount,
        model_call_count: result.modelCallCount,
        grounding_retry: result.groundingRetry,
        recursion_fallback: result.recursionFallback,
        first_turn: isFirstTurn,
        memory: {
          source: memoryContext.source,
          items: memoryContext.items,
        },
        agent_latency_ms: result.latencyMs,
        tools: result.toolTrace.map((item) => ({
          name: item.name,
          args: item.args,
          result_status: item.result?.status || null,
        })),
        searches,
        escalated: false,
        escalation: null,
        pending_escalation_confirmation: Boolean(effectiveEscalation),
      };
    }

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function searchKnowledge(req, res, next) {
  try {
    const input = searchSchema.parse(req.body);
    const result = await retrieveKnowledge(input.query, { topK: input.top_k });

    res.json({
      success: true,
      data: {
        found: result.found,
        mode: result.retrievalMode,
        query: result.query,
        confidence: result.confidence,
        results: result.candidates.map((doc) => ({
          article_id: doc.articleId,
          title: doc.title,
          category: doc.category,
          product: doc.product,
          symptoms: doc.symptoms,
          user_response_template: doc.userResponseTemplate,
          troubleshooting_steps: doc.troubleshootingSteps,
          escalation_rules: doc.escalationRules,
          retrieval: doc.retrieval,
        })),
        vector: result.vector,
        timing: result.timing,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getCustomerContext(req, res, next) {
  try {
    const customerId = z.string().trim().min(2).max(200).parse(req.params.customer_id);
    const currentSessionId = req.query.session_id
      ? z.string().trim().min(3).max(200).parse(req.query.session_id)
      : "__context_preview__";

    const [memory, context] = await Promise.all([
      getCustomerLongTermMemory(customerId),
      loadCustomerMemoryContext({ customerId, currentSessionId }),
    ]);

    res.json({
      success: true,
      data: {
        customer_id: customerId,
        source: context.source,
        context_text: context.text,
        long_term_memory: memory,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function resetChatSession(req, res, next) {
  try {
    const sessionId = z.string().trim().min(3).max(200).parse(req.params.session_id);
    const [chatResult, traceResult] = await Promise.all([
      deleteChatSession(sessionId),
      deleteAgentTraceSession(sessionId),
      deleteAgentThread(sessionId),
    ]);

    res.json({
      success: true,
      data: {
        session_id: sessionId,
        deleted_chat_messages: chatResult.deletedCount || 0,
        deleted_agent_traces: traceResult.deletedCount || 0,
        deleted_checkpoints: true,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getSessionMessages(req, res, next) {
  try {
    const sessionId = z.string().trim().min(3).max(200).parse(req.params.session_id);
    const history = await getSessionMessagePage(sessionId, {
      limit: req.query.limit ? Number(req.query.limit) : 50,
      before: req.query.before ? String(req.query.before) : "",
    });
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
}
