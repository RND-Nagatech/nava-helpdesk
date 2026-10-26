import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, Headphones, ImagePlus, Search, SendHorizontal, RefreshCw, Store, UserRound, Wifi } from "lucide-react";
import { getStoredHelpdeskUser } from "../../lib/helpdeskAuth";
import { subscribeHelpdeskConnection, subscribeHelpdeskEvent } from "../../lib/helpdeskEvents";
import { api } from "../../services/api";
import type { Attachment, ChatMessage, KnowledgeSearchResult, SiteCheckResult, Ticket } from "../../types";
import { AttachmentGrid, PendingFiles } from "./AttachmentPreview";
import { MessageContent } from "./MessageContent";

type Props = {
  mode: "customer" | "helpdesk";
  sessionId: string;
  customerId?: string;
  customerName?: string;
  customerDomain?: string;
  ticket?: Ticket | null;
  onResolve?: () => Promise<void>;
  onSent?: () => void | Promise<void>;
  onEditProfile?: () => void;
  onNewSession?: () => void;
  readOnlyReason?: string;
};

function roleName(role: ChatMessage["role"]) {
  if (role === "assistant") return "NAVA";
  if (role === "helpdesk") return "Helpdesk";
  return "Customer";
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "C";
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

const customerQuickPrompts = [
  "Struk saya tidak keluar",
  "Saya tidak bisa login",
  "Data transaksi tidak muncul",
];

const helpdeskQuickPrompts = [
  "Mohon tunggu sebentar, saya cek dulu ya.",
  "Bisa dibantu kirim screenshot kendalanya?",
  "Sudah saya bantu proses, silakan coba kembali.",
];

function knowledgeAnswer(article: KnowledgeSearchResult) {
  const template = article.user_response_template?.trim();
  if (template) return template;

  const steps = (article.troubleshooting_steps || [])
    .filter((step) => step.instruction?.trim())
    .map((step, index) => `${step.order || index + 1}. ${step.instruction.trim()}${step.expectedResult?.trim() ? `\n   Hasil yang diharapkan: ${step.expectedResult.trim()}` : ""}`)
    .join("\n");
  return steps ? `Silakan coba langkah berikut:\n\n${steps}` : "";
}

function knowledgePreview(article: KnowledgeSearchResult) {
  const answer = knowledgeAnswer(article).replace(/\s+/g, " ").trim();
  if (!answer) return "Belum ada template jawaban atau langkah troubleshooting.";
  return answer.length > 240 ? `${answer.slice(0, 237)}...` : answer;
}

function knowledgeEvidence(article: KnowledgeSearchResult) {
  const retrieval = article.retrieval || {};
  const evidence = retrieval.evidence_strength ?? retrieval.evidenceStrength;
  const score = retrieval.hybrid_score ?? retrieval.hybridScore ?? retrieval.vector_score ?? retrieval.vectorScore;
  const scoreLabel = typeof score === "number" ? `skor ${score.toFixed(2)}` : "";
  if (typeof evidence === "string" && evidence.trim()) return scoreLabel ? `${evidence} · ${scoreLabel}` : evidence;
  return scoreLabel || "relevansi tersedia";
}

export function ChatWindow({
  mode,
  sessionId,
  customerId = "",
  customerName = "Customer NAVA",
  customerDomain = "",
  ticket,
  onSent,
  onEditProfile,
  onNewSession,
  readOnlyReason = "",
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [siteCheck, setSiteCheck] = useState<SiteCheckResult | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeSearchResult[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [knowledgeNotice, setKnowledgeNotice] = useState("");
  const historyVersion = useRef(0);
  const historyCursor = useRef<string | null>(null);
  const historyRequest = useRef<{ sessionId: string; promise: Promise<void> } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const helpdeskClosed = mode === "helpdesk" && ticket?.status === "resolved";
  const composerDisabled = helpdeskClosed || Boolean(readOnlyReason);
  const customerLabel = ticket?.customer_name || customerName || "Customer";
  const helpdeskUser = getStoredHelpdeskUser();

  async function loadHistory() {
    if (historyRequest.current?.sessionId === sessionId) return historyRequest.current.promise;
    const version = ++historyVersion.current;
    let promise!: Promise<void>;
    promise = (async () => {
      try {
        setError("");
        const page = await api.history(sessionId);
        if (version !== historyVersion.current) return;
        setMessages(page.items);
        const latestSiteCheck = [...page.items].reverse().find((item) => item.metadata?.runtime_meta && (item.metadata.runtime_meta as { site_check?: SiteCheckResult }).site_check);
        setSiteCheck((latestSiteCheck?.metadata?.runtime_meta as { site_check?: SiteCheckResult } | undefined)?.site_check || null);
        setHasMore(page.has_more);
        historyCursor.current = page.next_cursor;
      } catch (err) {
        if (version !== historyVersion.current) return;
        setError(err instanceof Error ? err.message : "Gagal mengambil history chat.");
      } finally {
        if (version === historyVersion.current) setLoading(false);
        if (historyRequest.current?.promise === promise) historyRequest.current = null;
      }
    })();
    historyRequest.current = { sessionId, promise };
    return promise;
  }

  function upsertMessage(message?: ChatMessage) {
    if (!message?._id) return false;
    setMessages((current) => {
      if (current.some((item) => item._id === message._id)) return current;
      const withoutMatchingOptimistic = current.filter((item) => {
        if (!String(item._id || "").startsWith("optimistic-")) return true;
        return !(item.role === message.role && item.content === message.content);
      });
      return [...withoutMatchingOptimistic, message].sort((left, right) =>
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      );
    });
    return true;
  }

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setHasMore(false);
    setKnowledgeOpen(false);
    setKnowledgeQuery("");
    setKnowledgeResults([]);
    setKnowledgeError("");
    setKnowledgeNotice("");
    historyCursor.current = null;
    loadHistory();
  }, [sessionId]);

  useEffect(() => {
    if (mode === "helpdesk") {
      const unsubscribeMessage = subscribeHelpdeskEvent("new_message", (messageEvent) => {
        const payload = JSON.parse(messageEvent.data || "{}") as { session_id?: string; message?: ChatMessage };
        if (payload.session_id !== sessionId) return;
        upsertMessage(payload.message);
        setLoading(false);
      });
      const unsubscribeConnection = subscribeHelpdeskConnection(setReconnecting);
      return () => {
        unsubscribeMessage();
        unsubscribeConnection();
      };
    }

    const stream = new EventSource(api.eventsUrl());
    stream.addEventListener("open", () => setReconnecting(false));
    stream.addEventListener("error", () => setReconnecting(true));
    stream.addEventListener("new_message", (messageEvent) => {
      const payload = JSON.parse((messageEvent as MessageEvent).data || "{}") as { session_id?: string; message?: ChatMessage };
      if (payload.session_id !== sessionId) return;
      upsertMessage(payload.message);
      setLoading(false);
    });
    return () => {
      stream.close();
    };
  }, [sessionId]);

  async function loadOlder() {
    if (!hasMore || loadingOlder || !historyCursor.current) return;
    setLoadingOlder(true);
    try {
      const page = await api.history(sessionId, 50, historyCursor.current);
      setMessages((current) => [...page.items, ...current]);
      setHasMore(page.has_more);
      historyCursor.current = page.next_cursor;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengambil history lama.");
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (mode !== "helpdesk" || !composerInputRef.current) return;
    const textarea = composerInputRef.current;
    const minHeight = 30;
    if (!textarea.value.trim()) {
      textarea.style.height = `${minHeight}px`;
      textarea.style.overflowY = "hidden";
      return;
    }
    textarea.style.height = "auto";
    const maxHeight = 200;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [mode, text]);

  async function sendMessage(draft: string, selectedFiles = files) {
    if ((!draft.trim() && !selectedFiles.length) || sending || composerDisabled) return;
    setSending(true);
    setText("");
    setFiles([]);
    setError("");
    const content = draft.trim() || "Mengirim gambar";

    const optimistic: ChatMessage = {
      _id: `optimistic-${Date.now()}`,
      session_id: sessionId,
      customer_id: customerId,
      role: mode === "customer" ? "user" : "helpdesk",
      content,
      metadata: { attachments: [], helpdesk_name: mode === "helpdesk" ? helpdeskUser?.name : undefined },
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);

    try {
      let attachments: Attachment[] = [];
      if (selectedFiles.length) {
        setUploading(true);
        attachments = await api.upload(selectedFiles);
        setUploading(false);
        setMessages((current) => current.map((item) => (
          item._id === optimistic._id ? { ...item, metadata: { attachments } } : item
        )));
      }

      if (mode === "customer") {
        const response = await api.chat({
          question: content,
          session_id: sessionId,
          customer_id: customerId,
          customer_name: customerName,
          customer_domain: customerDomain,
          attachments,
        });
        if (response.meta?.site_check) setSiteCheck(response.meta.site_check);
      } else {
        const sentMessage = await api.helpdeskReply({
          session_id: sessionId,
          customer_id: ticket?.customer_id,
          message: content,
          attachments,
        });
        upsertMessage(sentMessage);
      }

      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pesan gagal dikirim.");
      setUploading(false);
      setText(content);
      setFiles(selectedFiles);
      setMessages((current) => current.filter((item) => item._id !== optimistic._id));
    } finally {
      setSending(false);
    }
  }

  function openKnowledgeSearch() {
    const latestCustomerMessage = [...messages].reverse().find((message) => message.role === "user")?.content || "";
    const fallbackQuery = latestCustomerMessage || ticket?.reason || ticket?.subject || "";
    setKnowledgeOpen((current) => !current);
    setKnowledgeError("");
    setKnowledgeNotice("");
    setKnowledgeQuery((current) => current.trim() || fallbackQuery);
  }

  async function searchKnowledge() {
    const query = knowledgeQuery.trim();
    if (query.length < 2) {
      setKnowledgeError("Masukkan minimal 2 karakter untuk mencari knowledge.");
      setKnowledgeResults([]);
      return;
    }

    setKnowledgeLoading(true);
    setKnowledgeError("");
    setKnowledgeNotice("");
    try {
      const response = await api.knowledgeSearch(query, 5);
      setKnowledgeResults(response.results || []);
      if (!response.results?.length) setKnowledgeNotice("Knowledge yang cocok belum ditemukan. Coba gunakan kata kunci lain.");
    } catch (err) {
      setKnowledgeResults([]);
      setKnowledgeError(err instanceof Error ? err.message : "Pencarian knowledge gagal. Chat tetap dapat digunakan.");
    } finally {
      setKnowledgeLoading(false);
    }
  }

  function insertKnowledgeAnswer(article: KnowledgeSearchResult) {
    const answer = knowledgeAnswer(article);
    if (!answer) {
      setKnowledgeError("Artikel ini belum memiliki template jawaban atau langkah troubleshooting yang bisa dimasukkan.");
      return;
    }
    setText((current) => current.trim() ? `${current.trim()}\n\n${answer}` : answer);
    setKnowledgeOpen(false);
    setKnowledgeNotice("");
    window.setTimeout(() => {
      const textarea = composerInputRef.current;
      textarea?.focus();
      if (textarea) {
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
      }
    }, 0);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await sendMessage(text.trim());
  }

  return (
    <section className={`chat-shell chat-shell-${mode}`}>
      {mode === "customer" && (
        <header className="chat-header">
          <div className="chat-title-compact">
            <span className="eyebrow">Live Support</span>
            <p>Live Chat</p>
          </div>
          <div className="chat-actions">
            <span className={`online-pill ${reconnecting ? "reconnecting" : ""}`}>
              <Wifi size={16} />
              {reconnecting ? "Reconnect" : "Online"}
            </span>
            <button className="header-action" type="button" onClick={onEditProfile}>
              <Store size={16} />
              Ganti toko
            </button>
            <button className="header-action strong" type="button" onClick={onNewSession}>
              <RefreshCw size={16} />
              Sesi baru
            </button>
          </div>
        </header>
      )}
      {mode === "helpdesk" && reconnecting && <div className="handover-banner">Menyambungkan ulang realtime...</div>}
      {helpdeskClosed && <div className="handover-banner resolved-banner">Ticket sudah selesai. Balasan petugas ditutup dan customer kembali dilayani NAVA.</div>}
      {mode === "customer" && ticket?.status === "resolved" && (
        <div className="handover-banner resolved-banner">Ticket {ticket.ticket_code} sudah selesai. Anda tetap dapat melanjutkan percakapan dengan NAVA.</div>
      )}
      {!helpdeskClosed && readOnlyReason && <div className="handover-banner">{readOnlyReason}</div>}

      {mode === "customer" && siteCheck && (
        <div className="site-check-summary" role="status">
          <strong>Hasil cek {siteCheck.domain}</strong>
          <span>Frontend: <b className={siteCheck.frontend.status === "online" ? "site-online" : "site-offline"}>{siteCheck.frontend.status === "online" ? "Online" : "Offline"}</b></span>
          <span>Backend: <b className={siteCheck.backend.status === "online" ? "site-online" : siteCheck.backend.status === "unauthorized" ? "site-unknown" : "site-offline"}>{siteCheck.backend.status === "online" ? "Online" : siteCheck.backend.status === "unauthorized" ? "Perlu kredensial" : "Offline"}</b></span>
          {siteCheck.frontend.version && <span>Klien: {siteCheck.frontend.version}</span>}
          {siteCheck.backend.version && <span>Server: {siteCheck.backend.version}</span>}
          <span>Versi: <b>{siteCheck.compatibility === "match" ? "Match" : siteCheck.compatibility === "mismatch" ? "Mismatch" : "Unknown"}</b></span>
        </div>
      )}

      {ticket && ticket.status !== "resolved" && (
        <div className="handover-banner">
          Ticket {ticket.ticket_code} aktif. {ticket.handover_status === "active" ? "Pesan berikutnya diarahkan ke petugas helpdesk." : "Menunggu petugas mengambil percakapan."}
        </div>
      )}

      <div className="message-list">
        {loading && <div className="empty-state">Memuat history percakapan...</div>}
        {!loading && hasMore && <button className="button secondary" type="button" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? "Memuat..." : "Muat pesan sebelumnya"}</button>}
        {!loading && !messages.length && <div className="empty-state">Belum ada pesan. Mulai percakapan dengan NAVA.</div>}
        {messages.map((message, index) => (
          <article className={`message message-${message.role}`} key={message._id || `${message.created_at}-${index}`}>
            <div className={`message-avatar avatar-${message.role}`} aria-hidden="true">
              {message.role === "assistant" ? <Bot size={17} /> : message.role === "helpdesk" ? "HD" : mode === "helpdesk" ? initials(customerLabel) : <UserRound size={16} />}
            </div>
            <div className="message-bubble">
              <div className="message-meta">
                <strong>{message.role === "user" ? customerLabel : message.role === "helpdesk" ? String(message.metadata?.helpdesk_name || "Helpdesk") : roleName(message.role)}</strong>
                <span>{new Date(message.created_at).toLocaleString("id-ID")}</span>
              </div>
              <MessageContent content={message.content} />
              <AttachmentGrid attachments={message.metadata?.attachments} />
            </div>
          </article>
        ))}
        {sending && <div className="empty-state">{uploading ? "Mengunggah gambar..." : mode === "customer" ? "NAVA sedang memproses..." : "Mengirim balasan..."}</div>}
        <div ref={bottomRef} />
      </div>

      {error && <div className="error-box">{error}</div>}

      <form className="composer" onSubmit={submit}>
        {mode === "customer" && (
          <div className="quick-actions" aria-label="Aksi cepat">
            {customerQuickPrompts.map((prompt) => (
              <button
                type="button"
                key={prompt}
                onClick={() => prompt.includes("petugas") ? sendMessage(prompt) : setText(prompt)}
                disabled={sending}
              >
                {prompt.includes("petugas") && <Headphones size={15} />}
                {prompt}
              </button>
            ))}
          </div>
        )}
        {mode === "helpdesk" && (
          <div className="quick-actions" aria-label="Balas cepat">
            {!knowledgeOpen && (
              <>
                <span>Balas Kilat:</span>
                {helpdeskQuickPrompts.map((prompt) => (
                  <button type="button" key={prompt} onClick={() => setText(prompt)} disabled={sending || composerDisabled}>
                    {prompt}
                  </button>
                ))}
              </>
            )}
            <button type="button" className="knowledge-search-button" onClick={openKnowledgeSearch} disabled={sending || composerDisabled}>
              <Search size={15} />
              {knowledgeOpen ? "Tutup Knowledge" : "Cari Knowledge"}
            </button>
          </div>
        )}
        {mode === "helpdesk" && knowledgeOpen && (
          <section className="knowledge-search-panel" aria-label="Cari knowledge resmi">
            <div className="knowledge-search-head">
              <div>
                <strong>Cari Knowledge</strong>
                <span>Query awal diambil dari pesan customer terakhir. Edit jika ingin mencari konteks lain.</span>
              </div>
              <span className="knowledge-search-scope">Published</span>
            </div>
            <div className="knowledge-search-form" role="search">
              <input
                value={knowledgeQuery}
                onChange={(event) => setKnowledgeQuery(event.target.value)}
                placeholder="Contoh: berat barang tidak muncul"
                minLength={2}
                maxLength={1200}
                aria-label="Query knowledge"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    searchKnowledge();
                  }
                }}
              />
              <button type="button" className="button primary" onClick={searchKnowledge} disabled={knowledgeLoading || knowledgeQuery.trim().length < 2}>
                {knowledgeLoading ? "Mencari..." : "Cari"}
              </button>
            </div>
            {knowledgeError && <div className="knowledge-search-error" role="alert">{knowledgeError}</div>}
            {knowledgeNotice && <div className="knowledge-search-notice" role="status">{knowledgeNotice}</div>}
            <div className="knowledge-search-results">
              {knowledgeLoading && <div className="knowledge-search-empty">Mencari di knowledge resmi...</div>}
              {!knowledgeLoading && knowledgeResults.map((article) => (
                <article className="knowledge-search-result" key={article.article_id}>
                  <div className="knowledge-search-result-top">
                    <div>
                      <strong>{article.title}</strong>
                      <div className="knowledge-search-result-meta">
                        <span>{article.category || "Tanpa kategori"}</span>
                        <span>Evidence: {knowledgeEvidence(article)}</span>
                      </div>
                    </div>
                    <button type="button" className="button secondary" onClick={() => insertKnowledgeAnswer(article)} disabled={composerDisabled}>
                      Gunakan Jawaban
                    </button>
                  </div>
                  <p className="knowledge-search-result-preview">{knowledgePreview(article)}</p>
                </article>
              ))}
              {!knowledgeLoading && !knowledgeError && !knowledgeNotice && !knowledgeResults.length && (
                <div className="knowledge-search-empty">Masukkan keluhan customer, lalu klik Cari.</div>
              )}
            </div>
          </section>
        )}
        <PendingFiles files={files} onRemove={(index) => setFiles((current) => current.filter((_, i) => i !== index))} />
        <div className="composer-row">
          <div className="composer-tools">
            <label className="composer-tool image-upload" title="Kirim gambar">
              <ImagePlus size={17} />
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                disabled={composerDisabled}
                onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 5))}
              />
            </label>
            <span className="composer-mode">{mode === "helpdesk" ? "Balasan Publik" : "Chat NAVA"}</span>
          </div>
          <textarea
            ref={composerInputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={composerDisabled}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={helpdeskClosed ? "Ticket sudah selesai" : readOnlyReason || (mode === "helpdesk" ? `Tulis balasan untuk ${customerLabel}... Gunakan '/' untuk template cepat` : "Tulis pesan...")}
          />
          <button className="send-button" type="submit" title="Kirim pesan" disabled={sending || composerDisabled || (!text.trim() && !files.length)}>
            Kirim
            <SendHorizontal size={18} />
          </button>
        </div>
      </form>
    </section>
  );
}
