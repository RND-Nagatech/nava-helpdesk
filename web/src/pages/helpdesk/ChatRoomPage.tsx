import { useEffect, useRef, useState } from "react";
import { Bot, CheckCircle2, Search, SlidersHorizontal, X } from "lucide-react";
import { ChatWindow } from "../../components/chat/ChatWindow";
import { StatusBadge } from "../../components/common/StatusBadge";
import { getStoredHelpdeskUser } from "../../lib/helpdeskAuth";
import { handleHelpdeskNavigation } from "../../lib/navigation";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { api } from "../../services/api";
import type { Ticket } from "../../types";

export function ChatRoomPage({ sessionId }: { sessionId?: string }) {
  const selectedTicketId = new URLSearchParams(window.location.search).get("ticketId") || "";
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [queueSearch, setQueueSearch] = useState("");
  const [error, setError] = useState("");
  const [confirmResolve, setConfirmResolve] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const loadVersion = useRef(0);
  const currentHelpdesk = getStoredHelpdeskUser();

  async function loadQueue(version = ++loadVersion.current) {
    try {
      setQueueLoading(true);
      setError("");
      const rows = await api.tickets({ status: "in_progress", assignment: "assigned", limit: "30" });
      if (version !== loadVersion.current) return rows;
      setTickets(rows);
      return rows;
    } catch (err) {
      if (version !== loadVersion.current) return [];
      setError(err instanceof Error ? err.message : "Gagal refresh antrean.");
      return [];
    } finally {
      if (version === loadVersion.current) setQueueLoading(false);
    }
  }

  async function loadTicket(id = sessionId || "") {
    const version = ++loadVersion.current;
    if (!id) {
      await loadQueue(version);
      return;
    }
    try {
      setError("");
      const rows = await loadQueue(version);
      if (version !== loadVersion.current) return;
      const fromQueue = selectedTicketId
        ? rows.find((row) => row._id === selectedTicketId)
        : rows.find((row) => row.session_id === id);
      if (fromQueue) {
        setTicket(fromQueue);
        return;
      }
      const current = selectedTicketId
        ? await api.ticket(selectedTicketId).catch(() => api.ticketBySession(id))
        : await api.ticketBySession(id);
      if (version !== loadVersion.current) return;
      setTicket(current);
    } catch (err) {
      if (version !== loadVersion.current) return;
      setError(err instanceof Error ? err.message : "Gagal memuat ticket.");
    }
  }

  useEffect(() => {
    setTicket(null);
    loadTicket(sessionId || "");
  }, [sessionId, selectedTicketId]);

  useEffect(() => {
    const stream = new EventSource(api.eventsUrl());
    const refreshQueue = () => loadTicket(sessionId || "");
    stream.addEventListener("new_ticket", refreshQueue);
    stream.addEventListener("ticket_updated", refreshQueue);
    stream.addEventListener("handover_started", refreshQueue);
    stream.addEventListener("handover_resolved", refreshQueue);
    return () => stream.close();
  }, [sessionId, selectedTicketId]);

  async function resolve() {
    if (!ticket) return;
    try {
      setResolving(true);
      setTicket(await api.resolveTicket(ticket._id));
      setConfirmResolve(false);
      await loadQueue();
    } finally {
      setResolving(false);
    }
  }

  const visibleTickets = tickets.filter((row) => {
    const haystack = `${row.ticket_code} ${row.customer_name} ${row.customer_domain} ${row.subject} ${row.reason}`.toLowerCase();
    return haystack.includes(queueSearch.toLowerCase());
  });
  const activeAssignedTicket = Boolean(ticket?.assigned_helpdesk_id && ticket.status === "in_progress");
  const readOnlyReason = ticket && ticket.status !== "resolved" && !activeAssignedTicket
    ? "Ticket ini belum masuk Chat Aktif. Ambil chat dari menu Handover sebelum membalas."
    : "";

  return (
    <HelpdeskLayout>
      {error && <div className="error-box">{error}</div>}
      <section className={`helpdesk-workspace ${queueCollapsed ? "queue-collapsed" : ""}`}>
        <aside className="queue-panel">
          <div className="queue-panel-head">
            <div>
              <h2>Chat Aktif <span>{tickets.length}</span></h2>
              <small>Ticket yang sudah diambil helpdesk</small>
            </div>
            <button
              className="icon-ghost queue-collapse-toggle"
              type="button"
              title={queueCollapsed ? "Buka daftar chat" : "Ciutkan daftar chat"}
              aria-label={queueCollapsed ? "Buka daftar chat" : "Ciutkan daftar chat"}
              aria-expanded={!queueCollapsed}
              onClick={() => setQueueCollapsed((current) => !current)}
            >
              <SlidersHorizontal size={18} />
            </button>
          </div>
          <label className="search-field">
            <Search size={17} />
            <input value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Cari ID ticket, user, toko..." />
          </label>
          <div className="queue-list">
            {visibleTickets.map((row) => (
              <a className={`queue-item ${row._id === (ticket?._id || selectedTicketId) ? "active" : ""}`} href={`/helpdesk/chat/${row.session_id}?ticketId=${row._id}`} onClick={handleHelpdeskNavigation} key={row._id}>
                <div className="queue-item-top">
                  <strong>{row.customer_name || "Customer"}</strong>
                  <span>{new Date(row.last_message_at || row.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div className="ticket-code compact">
                  <strong>{row.ticket_code}</strong>
                </div>
                <div className="queue-badges">
                  <StatusBadge type="handover" value={row.handover_status} />
                  {row.status !== "resolved" && <StatusBadge type="status" value={row.status} />}
                </div>
                <p>{row.last_message || row.subject}</p>
                <small>Ditangani: {row.assigned_helpdesk_name || "Helpdesk"}{row.assigned_helpdesk_id === currentHelpdesk?.helpdesk_id ? " (Anda)" : ""}</small>
              </a>
            ))}
            {!visibleTickets.length && <div className="empty-state">Belum ada chat aktif.</div>}
          </div>
        </aside>

        <main className={`conversation-panel ${sessionId ? "has-chat" : "is-empty"}`}>
          {sessionId ? (
            <>
              <div className="conversation-top">
                <div className="customer-avatar">{(ticket?.customer_name || "C").slice(0, 1).toUpperCase()}</div>
                <div>
                  <h1>{ticket?.customer_name || "Customer NAVA"}</h1>
                  <p>{ticket?.customer_domain || "Direct client"} · {ticket?.ticket_code || sessionId}</p>
                </div>
                <div className="conversation-actions">
                  {ticket && activeAssignedTicket && (
                    <button className="button primary" type="button" onClick={() => setConfirmResolve(true)}>
                      <CheckCircle2 size={16} /> Tandai Selesai
                    </button>
                  )}
                    <a className="button secondary close-chat-button" href="/helpdesk/chat" onClick={handleHelpdeskNavigation} title="Tutup chat">
                    <X size={16} /> Tutup Chat
                  </a>
                </div>
              </div>
              <ChatWindow mode="helpdesk" sessionId={sessionId} ticket={ticket} onResolve={resolve} onSent={loadTicket} readOnlyReason={readOnlyReason} />
            </>
          ) : (
            <section className="open-session-card empty-conversation">
              <div className="empty-bot-mark">
                <Bot size={44} />
              </div>
              <h1>Belum ada chat terbuka</h1>
              <p>Pilih chat aktif di kiri untuk melihat riwayat NAVA, customer, attachment, dan balasan helpdesk di session yang sama.</p>
              <button className="button secondary" type="button" onClick={() => loadQueue()} disabled={queueLoading}>
                {queueLoading ? "Memuat..." : "Refresh Chat Aktif"}
              </button>
            </section>
          )}
        </main>

        <aside className="detail-panel">
          <div className="detail-title">
            <h2>Detail Tiket</h2>
            {ticket && <StatusBadge type="handover" value={ticket.handover_status} />}
          </div>
          {ticket ? (
            <>
              <div className="detail-card">
                <span>Identifikasi Ticket</span>
                <strong>{ticket.ticket_code}</strong>
                <dl>
                  <div><dt>Waktu Masuk</dt><dd>{new Date(ticket.created_at).toLocaleString("id-ID")}</dd></div>
                  <div><dt>Status</dt><dd><StatusBadge type="status" value={ticket.status} /></dd></div>
                  <div><dt>Prioritas</dt><dd><StatusBadge type="priority" value={ticket.priority} /></dd></div>
                  <div><dt>Petugas</dt><dd>{ticket.assigned_helpdesk_name || "Belum ditugaskan"}</dd></div>
                </dl>
              </div>
              <div className="detail-card">
                <span>Informasi Customer</span>
                <strong>{ticket.customer_name || "Customer NAVA"}</strong>
                <p>{ticket.customer_domain || "Domain belum tersedia"}</p>
                <p>{ticket.customer_id || "Customer ID belum tersedia"}</p>
              </div>
              <div className="detail-card">
                <span>Alur Eskalasi</span>
                <ol className="timeline">
                  <li><strong>Bot NAVA</strong><span>Diagnostik awal berjalan</span></li>
                  <li><strong>Permintaan Agen Manusia</strong><span>{ticket.reason}</span></li>
                  <li><strong>Handover</strong><span>{ticket.handover_status === "active" ? "Ditangani petugas" : ticket.handover_status === "resolved" ? "Selesai" : "Menunggu petugas"}</span></li>
                </ol>
              </div>
            </>
          ) : (
            <div className="empty-state">Pilih ticket untuk melihat detail.</div>
          )}
        </aside>

        {confirmResolve && ticket && (
          <div className="confirm-backdrop" role="presentation" onMouseDown={() => setConfirmResolve(false)}>
            <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="resolve-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="confirm-icon">
                <CheckCircle2 size={22} />
              </div>
              <h2 id="resolve-title">Selesaikan ticket ini?</h2>
              <p>Setelah diselesaikan, handover manusia ditutup dan customer akan kembali dilayani NAVA pada session yang sama.</p>
              <div className="confirm-actions">
                <button className="button secondary" type="button" onClick={() => setConfirmResolve(false)} disabled={resolving}>Batal</button>
                <button className="button primary" type="button" onClick={resolve} disabled={resolving}>
                  {resolving ? "Menyelesaikan..." : "Ya, Selesaikan"}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </HelpdeskLayout>
  );
}
