import { useEffect, useRef, useState } from "react";
import { Download, Search } from "lucide-react";
import { TicketTable } from "../../components/ticket/TicketTable";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { navigateWithinHelpdesk } from "../../lib/navigation";
import { api, type Pagination } from "../../services/api";
import type { Ticket } from "../../types";

type Period = "today" | "7days" | "month" | "custom";

const LIMIT = 20;

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function periodRange(period: Period, customStart: string, customEnd: string) {
  const today = new Date();
  if (period === "custom") {
    return { startDate: customStart, endDate: customEnd || customStart };
  }
  if (period === "7days") {
    const start = new Date(today);
    start.setDate(today.getDate() - 6);
    return { startDate: toDateInput(start), endDate: toDateInput(today) };
  }
  if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { startDate: toDateInput(start), endDate: toDateInput(today) };
  }
  const date = toDateInput(today);
  return { startDate: date, endDate: date };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function TicketPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState<Period>("today");
  const [customStart, setCustomStart] = useState(toDateInput(new Date()));
  const [customEnd, setCustomEnd] = useState(toDateInput(new Date()));
  const [helpdeskId, setHelpdeskId] = useState("all");
  const [assignees, setAssignees] = useState<Array<{ helpdesk_id: string; name: string }>>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: LIMIT, total: 0, total_pages: 1 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const loadVersion = useRef(0);

  function currentFilters(nextPage = page) {
    const range = periodRange(period, customStart, customEnd);
    return {
      search,
      status,
      helpdesk_id: helpdeskId,
      start_date: range.startDate,
      end_date: range.endDate,
      page: String(nextPage),
      limit: String(LIMIT),
    };
  }

  async function load(nextPage = page) {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      setError("");
      const result = await api.ticketsPage(currentFilters(nextPage));
      if (version !== loadVersion.current) return;
      setTickets(result.data);
      setPagination(result.pagination);
      setPage(result.pagination.page);
    } catch (err) {
      if (version !== loadVersion.current) return;
      setError(err instanceof Error ? err.message : "Gagal memuat ticket.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }

  async function loadAssignees() {
    const range = periodRange(period, customStart, customEnd);
    const rows = await api.ticketAssignees({
      start_date: range.startDate,
      end_date: range.endDate,
      status,
      search,
    }).catch(() => []);
    setAssignees(rows);
  }

  useEffect(() => {
    load(1);
    loadAssignees();
  }, []);

  useEffect(() => {
    const stream = new EventSource(api.eventsUrl());
    const refresh = () => {
      load(page);
      loadAssignees();
    };
    stream.addEventListener("new_ticket", refresh);
    stream.addEventListener("ticket_updated", refresh);
    stream.addEventListener("handover_started", refresh);
    stream.addEventListener("handover_resolved", refresh);
    return () => stream.close();
  }, [search, status, period, customStart, customEnd, helpdeskId, page]);

  function applyFilters() {
    setPage(1);
    load(1);
    loadAssignees();
  }

  async function accept(ticket: Ticket) {
    await api.acceptTicket(ticket._id);
    navigateWithinHelpdesk(`/helpdesk/chat/${ticket.session_id}?ticketId=${ticket._id}`);
  }

  async function resolve(ticket: Ticket) {
    await api.resolveTicket(ticket._id);
    await load(page);
  }

  async function exportCsv() {
    try {
      setExporting(true);
      setError("");
      const { page: _page, limit: _limit, ...filters } = currentFilters(1);
      const blob = await api.ticketExportCsv(filters);
      downloadBlob(blob, `daftar-tiket-${filters.start_date}-sd-${filters.end_date}.csv`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal export CSV.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <HelpdeskLayout>
      <section className="queue-hero compact">
        <div>
          <span className="eyebrow">Riwayat Ticket</span>
          <h1>Daftar Tiket</h1>
          <p>Riwayat seluruh ticket sesuai periode, status, helpdesk, dan pencarian aktif.</p>
        </div>
        <div className="queue-stats">
          <article>
            <span>Total Filter</span>
            <strong>{pagination.total}</strong>
            <small>{pagination.total_pages} halaman</small>
          </article>
        </div>
      </section>

      <section className="ticket-board ticket-board-list">
        <div className="filters ticket-filters">
          <label className="search-field">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari tiket, customer, subject, session..." />
          </label>
          <select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
            <option value="today">Hari Ini</option>
            <option value="7days">7 Hari Terakhir</option>
            <option value="month">Bulan Ini</option>
            <option value="custom">Custom</option>
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Semua Status</option>
            <option value="new">Baru</option>
            <option value="pending">Menunggu</option>
            <option value="in_progress">Sedang Ditangani</option>
            <option value="resolved">Selesai</option>
          </select>
          <select value={helpdeskId} onChange={(event) => setHelpdeskId(event.target.value)}>
            <option value="all">Semua Helpdesk</option>
            {assignees.map((item) => (
              <option value={item.helpdesk_id} key={item.helpdesk_id}>{item.name}</option>
            ))}
          </select>
          <button className="button primary" onClick={applyFilters} type="button">Terapkan</button>
          <button className="button secondary" type="button" onClick={exportCsv} disabled={exporting}>
            <Download size={15} /> {exporting ? "Export..." : "Export CSV"}
          </button>
        </div>
        {period === "custom" && (
          <div className="custom-date-row">
            <label>
              Tanggal Dari
              <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
            </label>
            <label>
              Tanggal Sampai
              <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
            </label>
          </div>
        )}
      </section>

      {loading && <div className="empty-state">Memuat ticket...</div>}
      {error && <div className="error-box">{error}</div>}
      {!loading && <TicketTable tickets={tickets} onAccept={accept} onResolve={resolve} />}
      <div className="pagination-bar">
        <span>
          Halaman {pagination.page} dari {pagination.total_pages} · {pagination.total} ticket
        </span>
        <div>
          <button className="button secondary" type="button" disabled={pagination.page <= 1 || loading} onClick={() => load(page - 1)}>Sebelumnya</button>
          <button className="button secondary" type="button" disabled={pagination.page >= pagination.total_pages || loading} onClick={() => load(page + 1)}>Berikutnya</button>
        </div>
      </div>
    </HelpdeskLayout>
  );
}
