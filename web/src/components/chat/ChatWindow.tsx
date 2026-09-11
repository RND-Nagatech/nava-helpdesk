import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, Headphones, ImagePlus, SendHorizontal, RefreshCw, Store, UserRound, Wifi } from "lucide-react";
import { getStoredHelpdeskUser } from "../../lib/helpdeskAuth";
import { api } from "../../services/api";
import type { Attachment, ChatMessage, Ticket } from "../../types";
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
  "Saya ingin dibantu petugas manusia",
];

const helpdeskQuickPrompts = [
  "Mohon tunggu sebentar, saya cek dulu ya.",
  "Bisa dibantu kirim screenshot kendalanya?",
  "Sudah saya bantu proses, silakan coba kembali.",
];

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
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const historyVersion = useRef(0);
  const historyCursor = useRef<string | null>(null);
  const historyRequest = useRef<{ sessionId: string; promise: Promise<void> } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
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
    historyCursor.current = null;
    loadHistory();
  }, [sessionId]);

  useEffect(() => {
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
        await api.chat({
          question: content,
          session_id: sessionId,
          customer_id: customerId,
          customer_name: customerName,
          customer_domain: customerDomain,
          attachments,
        });
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
            <span>Balas Kilat:</span>
            {helpdeskQuickPrompts.map((prompt) => (
              <button type="button" key={prompt} onClick={() => setText(prompt)} disabled={sending || composerDisabled}>
                {prompt}
              </button>
            ))}
          </div>
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
