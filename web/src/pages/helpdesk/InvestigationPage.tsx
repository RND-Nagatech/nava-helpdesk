import { FormEvent, useEffect, useState } from "react";
import { ChevronDown, DatabaseZap, MessageSquare, Plus, RefreshCw, SendHorizontal } from "lucide-react";
import { MessageContent } from "../../components/chat/MessageContent";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { handleHelpdeskNavigation } from "../../lib/navigation";
import { api } from "../../services/api";
import type { InvestigationMessage, InvestigationSession, InvestigationTarget } from "../../types";

const ACTIVE_INVESTIGATION_KEY = "nava_active_investigation_session";

export function InvestigationPage() {
  const [session, setSession] = useState<InvestigationSession | null>(null);
  const [targets, setTargets] = useState<InvestigationTarget[]>([]);
  const [domain, setDomain] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedTarget = targets.find((target) => target.domain === domain);
  const filteredTargets = targets.filter((target) => {
    if (target.status !== "active") return false;
    const haystack = `${target.display_name} ${target.domain}`.toLowerCase();
    return haystack.includes(targetSearch.trim().toLowerCase());
  });

  async function loadTargets() {
    try {
      const rows = await api.investigationTargets();
      setTargets(rows);
      setDomain((current) => current || rows.find((row) => row.status === "active")?.domain || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat target database.");
    }
  }

  async function createRoom(message = "") {
    try {
      setLoading(true);
      setError("");
      const next = await api.createInvestigationSession();
      sessionStorage.setItem(ACTIVE_INVESTIGATION_KEY, next.training_id);
      setSession(next);
      setDomain(next.customer_domain || domain);
      setTargetSearch("");
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat room investigasi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      setLoading(true);
      await loadTargets();

      try {
        const rows = await api.investigationSessions();
        const savedId = sessionStorage.getItem(ACTIVE_INVESTIGATION_KEY);
        const active = rows.find((row) => row.status === "active");
        const id = active?.training_id || savedId || "";
        if (id) {
          const saved = await api.investigationSession(id);
          if (!cancelled) {
            sessionStorage.setItem(ACTIVE_INVESTIGATION_KEY, saved.training_id);
            setSession(saved);
            setDomain(saved.customer_domain || "");
            setTargetSearch("");
            setLoading(false);
          }
          return;
        }
      } catch {
        sessionStorage.removeItem(ACTIVE_INVESTIGATION_KEY);
      }

      if (!cancelled) await createRoom();
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (!session || !question.trim() || sending || session.status !== "active") return;

    const text = question.trim();
    const optimistic: InvestigationMessage = {
      _id: "optimistic-" + Date.now(),
      training_id: session.training_id,
      role: "helpdesk",
      content: text,
      metadata: { delivery_status: "sending", domain: domain || null },
      created_at: new Date().toISOString(),
    };

    setSession((current) => current ? { ...current, messages: [...current.messages, optimistic] } : current);
    setQuestion("");

    try {
      setSending(true);
      setError("");
      const result = await api.investigationMessage(session.training_id, text, domain);
      setSession(result.session);
      setDomain(result.session.customer_domain || domain);
      setTargetSearch("");
      sessionStorage.setItem(ACTIVE_INVESTIGATION_KEY, result.session.training_id);
    } catch (err) {
      setSession((current) => current ? {
        ...current,
        messages: current.messages.map((message) => message._id === optimistic._id
          ? { ...message, metadata: { ...message.metadata, delivery_status: "failed" } }
          : message),
      } : current);
      setError(err instanceof Error ? err.message : "Gagal menjalankan investigasi.");
    } finally {
      setSending(false);
    }
  }

  return (
    <HelpdeskLayout>
      <section className="training-page investigation-page">
        <div className="training-page-head">
          <div>
            <span className="eyebrow"><DatabaseZap size={14} /> Internal Tool</span>
            <h1>Investigasi Helpdesk</h1>
            <p>Pemeriksaan read-only untuk menelusuri relasi report, buyback, keuangan, dan stok NAGAGOLD.</p>
          </div>
          <div className="training-head-actions">
            <span className="training-status active">Helpdesk only</span>
            <button className="button investigation-new-button" type="button" onClick={() => createRoom()} disabled={loading || sending}>
              <Plus size={15} /> Investigasi Baru
            </button>
            <a className="button investigation-submenu-button" href="/helpdesk/investigation-playbooks" onClick={handleHelpdeskNavigation}>Kelola Playbook</a>
            <a className="button investigation-submenu-button" href="/helpdesk/investigation-targets" onClick={handleHelpdeskNavigation}>Kelola Target DB</a>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
        {notice && <div className="success-box">{notice}</div>}

        {!targets.length && (
          <div className="training-warning">
            Belum ada target database yang dikonfigurasi. Admin perlu mengisi mapping domain dan tenant di menu Target DB sebelum pemeriksaan dapat dijalankan.
          </div>
        )}

        <div className="training-layout">
          <div className="investigation-main-column">
            <div className="investigation-target-bar panel-card">
              <div>
                <strong>Target database</strong>
                <small>Helpdesk cukup memilih domain. Credential tidak dimasukkan ke chat.</small>
              </div>
              <div className="investigation-target-controls">
                <div className="investigation-target-combobox">
                  <button
                    className="investigation-target-select-trigger"
                    type="button"
                    role="combobox"
                    aria-expanded={targetMenuOpen}
                    aria-controls="investigation-target-options"
                    aria-haspopup="listbox"
                    onClick={() => setTargetMenuOpen((current) => !current)}
                    disabled={sending}
                  >
                    <span>{selectedTarget ? `${selectedTarget.display_name} · ${selectedTarget.domain}` : "Pilih domain toko..."}</span>
                    <ChevronDown size={18} aria-hidden="true" />
                  </button>
                  {targetMenuOpen && (
                    <div className="investigation-target-options" id="investigation-target-options" role="listbox">
                      <input
                        className="investigation-target-search"
                        value={targetSearch}
                        onChange={(event) => setTargetSearch(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        autoFocus
                        placeholder="Cari domain atau nama toko..."
                        aria-label="Cari target database"
                      />
                      <div className="investigation-target-option-list">
                        {filteredTargets.length ? filteredTargets.map((target) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={target.domain === domain}
                            key={target.domain}
                            onClick={() => { setDomain(target.domain); setTargetSearch(""); setTargetMenuOpen(false); }}
                          >
                            <strong>{target.display_name}</strong>
                            <span>{target.domain}</span>
                          </button>
                        )) : <div className="investigation-target-empty">Domain tidak ditemukan.</div>}
                      </div>
                    </div>
                  )}
                </div>
                <button className="icon-ghost" type="button" onClick={loadTargets} title="Refresh target database" aria-label="Refresh target database">
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            <section className="training-conversation panel-card">
            <div className="training-panel-head">
              <div>
                <span className="eyebrow"><MessageSquare size={14} /> Conversation</span>
                <h2>{session?.title || "Memuat investigasi..."}</h2>
              </div>
              <small>{session?.training_id || "-"}{domain ? " · " + domain : ""}</small>
            </div>

            <div className="training-message-list">
              {loading && <div className="empty-state">Menyiapkan room investigasi...</div>}
              {!loading && !session?.messages.length && (
                <div className="empty-state">
                  Pilih domain lalu tanyakan kendalanya. Contoh: “buyback customer tanggal 2026-09-14 tidak masuk saldo” atau “data pembelian tidak muncul di report”.
                </div>
              )}
              {session?.messages.map((message, index) => (
                <article className={"training-message training-message-" + message.role} key={message._id || message.created_at + "-" + index}>
                  <div className="training-message-meta">
                    <strong>{message.role === "assistant" ? "NAVA" : "Helpdesk"}</strong>
                    <span>{new Date(message.created_at).toLocaleString("id-ID")}</span>
                  </div>
                  <div className="training-message-content">
                    {message.role === "assistant" ? <MessageContent content={message.content} /> : <p>{message.content}</p>}
                  </div>
                  {message.metadata?.delivery_status === "failed" && (
                    <div className="training-message-delivery-error">Pesan belum berhasil dikirim. Coba ulangi.</div>
                  )}
                </article>
              ))}
              {sending && <div className="empty-state">NAVA sedang membaca relasi dan memeriksa data secara read-only...</div>}
            </div>

            <form className="training-composer" onSubmit={submitQuestion}>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={sending || session?.status !== "active"}
                        placeholder={session?.status === "closed" ? "Investigasi sudah ditutup" : "Tanyakan selisih report, buyback, keuangan, barcode, tanggal, kode baki, atau gudang..."}
              />
              <button className="button primary" type="submit" disabled={sending || !question.trim() || !domain || session?.status !== "active"}>
                <SendHorizontal size={16} /> Kirim
              </button>
            </form>
            </section>
          </div>

          <aside className="training-info panel-card investigation-info">
            <div className="training-panel-head">
              <div>
                <span className="eyebrow"><DatabaseZap size={14} /> Investigation Info</span>
                <h2>Selisih Barang</h2>
              </div>
            </div>
            <div className="investigation-info-body">
              <p>Operation investigasi yang tersedia:</p>
              <ul>
                <li>Selisih antarhari: mencari barcode yang stock awalnya berbeda dari stock akhir hari sebelumnya.</li>
                <li>Detail vs summary: dipakai jika barcode sudah diketahui.</li>
              </ul>
              <p>Collection yang menjadi sumber:</p>
              <ul>
                <li>tm_barang</li>
                <li>tt_barang_saldo</li>
                <li>th_barang_saldo</li>
                <li>tt_barang_summary</li>
              </ul>
              <p>NAVA hanya membaca data dan memberikan indikasi penyebab serta usulan perbaikan. Perubahan tetap dilakukan Helpdesk melalui prosedur NAGAGOLD.</p>
            </div>
          </aside>
        </div>
      </section>
    </HelpdeskLayout>
  );
}
