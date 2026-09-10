import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Activity, Bot, BookOpen, CalendarDays, Clock3, Headphones, MessageSquare, RefreshCw, TicketCheck } from "lucide-react";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { api } from "../../services/api";
import type { DashboardSummary, DashboardTimelineItem } from "../../types";

type PeriodPreset = "today" | "last7" | "month" | "custom";

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(date = new Date()) {
  return localDateString(new Date(date.getFullYear(), date.getMonth(), 1));
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDateString(date);
}

function rangeForPreset(preset: PeriodPreset, customStart: string, customEnd: string) {
  const today = localDateString();
  if (preset === "last7") return { start_date: daysAgo(6), end_date: today };
  if (preset === "month") return { start_date: startOfMonth(), end_date: today };
  if (preset === "custom") return { start_date: customStart || today, end_date: customEnd || customStart || today };
  return { start_date: today, end_date: today };
}

function percent(value: number) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function minutes(value: number) {
  return `${Number(value || 0)} menit`;
}

function metricNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasDashboardData(data: DashboardSummary) {
  return Boolean(
    data.agent.total_conversations ||
    data.agent.total_responses ||
    data.helpdesk.total_tickets ||
    data.helpdesk.total_helpdesk_messages
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [period, setPeriod] = useState<PeriodPreset>("today");
  const [customStart, setCustomStart] = useState(localDateString());
  const [customEnd, setCustomEnd] = useState(localDateString());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const periodParams = useMemo(() => rangeForPreset(period, customStart, customEnd), [period, customStart, customEnd]);

  async function loadDashboard(params = periodParams) {
    try {
      setLoading(true);
      setError("");
      const summary = await api.dashboard(params);
      setData(summary);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Gagal memuat dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard(periodParams);
  }, [periodParams.start_date, periodParams.end_date]);

  useEffect(() => {
    let timeout: number | undefined;
    const refresh = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        api.dashboard(periodParams).then(setData).catch(() => undefined);
      }, 700);
    };
    const stream = new EventSource(api.eventsUrl());
    stream.addEventListener("new_ticket", refresh);
    stream.addEventListener("new_message", refresh);
    stream.addEventListener("ticket_updated", refresh);
    stream.addEventListener("handover_resolved", refresh);
    return () => {
      window.clearTimeout(timeout);
      stream.close();
    };
  }, [periodParams.start_date, periodParams.end_date]);

  const agent = data?.agent;
  const helpdesk = data?.helpdesk;
  const totalTicket = metricNumber(helpdesk?.total_tickets);
  const empty = data ? !hasDashboardData(data) : false;

  return (
    <HelpdeskLayout>
      <section className="page-hero dashboard-hero">
        <div>
          <span className="eyebrow">Dashboard Operasional</span>
          <h1>Dashboard Performa & Operasional</h1>
          <p>Semua angka dihitung dari MongoDB sesuai periode yang dipilih.</p>
        </div>
        <div className="hero-actions dashboard-actions">
          <button className={`period ${period === "today" ? "active" : ""}`} onClick={() => setPeriod("today")} type="button">Hari Ini</button>
          <button className={`period ${period === "last7" ? "active" : ""}`} onClick={() => setPeriod("last7")} type="button">7 Hari Terakhir</button>
          <button className={`period ${period === "month" ? "active" : ""}`} onClick={() => setPeriod("month")} type="button">Bulan Ini</button>
          <button className={`period ${period === "custom" ? "active" : ""}`} onClick={() => setPeriod("custom")} type="button">
            <CalendarDays size={14} /> Custom
          </button>
          <button className="button secondary" onClick={() => loadDashboard()} type="button" disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
        {period === "custom" && (
          <div className="dashboard-custom-period">
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

      {loading && <DashboardSkeleton />}
      {error && (
        <div className="error-box dashboard-error">
          <span>{error}</span>
          <button className="button secondary" type="button" onClick={() => loadDashboard()}>Coba Lagi</button>
        </div>
      )}
      {empty && <div className="empty-state">Belum ada data pada periode ini.</div>}

      {data && !loading && !error && (
        <>
          <div className="section-heading">
            <div className="section-icon"><Bot size={17} /></div>
            <div>
              <h2>Performa NAVA</h2>
              <p>{data.period.start_date} sampai {data.period.end_date}</p>
            </div>
            <span className="sync-chip">{data.period.timezone}</span>
          </div>
          <div className="metric-grid">
            <Metric icon={<Activity size={17} />} label="Total Percakapan" value={agent?.total_conversations} note="Distinct session_id dari chat" />
            <Metric icon={<MessageSquare size={17} />} label="Total Response NAVA" value={agent?.total_responses} note="Pesan role assistant" />
            <Metric icon={<BookOpen size={17} />} label="Knowledge Usage" value={percent(agent?.knowledge_usage_rate || 0)} note={`${agent?.knowledge_usage_count || 0} trace memakai knowledge`} progress={agent?.knowledge_usage_rate || 0} />
            <Metric label="Escalation" value={percent(agent?.escalation_rate || 0)} note={`${agent?.escalation_count || 0} trace eskalasi`} progress={agent?.escalation_rate || 0} tone="amber" />
            <Metric icon={<Clock3 size={17} />} label="Rata-rata Agent Latency" value={`${agent?.avg_latency_ms || 0} ms`} note="Dari tt_agent_trace.metrics.latency_ms" />
            <Metric label="Rata-rata Model Call" value={agent?.avg_model_calls} note="Per response NAVA" />
            <Metric label="Rata-rata Tool Call" value={agent?.avg_tool_calls} note="Per response NAVA" />
            <Metric label="Recursion Fallback" value={agent?.recursion_fallback_count} note="Jumlah fallback agent" />
          </div>

          <div className="section-heading">
            <div className="section-icon"><Headphones size={17} /></div>
            <div>
              <h2>Performa Helpdesk</h2>
              <p>Ticket, response, dan penyelesaian sesuai periode yang sama</p>
            </div>
          </div>
          <div className="metric-grid">
            <Metric icon={<TicketCheck size={17} />} label="Total Ticket" value={helpdesk?.total_tickets} note="Ticket dibuat pada periode" />
            <Metric label="Ticket Baru" value={helpdesk?.new_tickets} note="Status new" tone="amber" />
            <Metric label="Menunggu Handover" value={helpdesk?.waiting_handover} note="Status new + pending" tone="amber" />
            <Metric label="Sedang Ditangani" value={helpdesk?.in_progress} note="Status in_progress" />
            <Metric label="Ticket Selesai" value={helpdesk?.resolved} note={`${totalTicket ? Math.round(((helpdesk?.resolved || 0) / totalTicket) * 100) : 0}% resolved`} progress={totalTicket ? (helpdesk?.resolved || 0) / totalTicket : 0} />
            <Metric label="Rata-rata First Response" value={minutes(helpdesk?.avg_first_response_minutes || 0)} note="first_response_at - created_at" />
            <Metric label="Rata-rata Resolution" value={minutes(helpdesk?.avg_resolution_minutes || 0)} note="resolved_at - created_at" />
            <Metric label="Pesan Helpdesk" value={helpdesk?.total_helpdesk_messages} note="Pesan role helpdesk" />
          </div>

          <div className="dashboard-panels">
            <StatusDistribution helpdesk={data.helpdesk} />
            <TimelinePanel timeline={data.timeline} />
            <HelpdeskPerformanceTable agents={data.helpdesk.performance_by_helpdesk} />
          </div>
        </>
      )}
    </HelpdeskLayout>
  );
}

function StatusDistribution({ helpdesk }: { helpdesk: DashboardSummary["helpdesk"] }) {
  const total = Math.max(helpdesk.total_tickets, 1);
  const rows = [
    { label: "Baru", value: helpdesk.new_tickets },
    { label: "Menunggu", value: helpdesk.waiting_handover },
    { label: "Ditangani", value: helpdesk.in_progress },
    { label: "Selesai", value: helpdesk.resolved },
  ];

  return (
    <div className="panel">
      <div className="panel-title">
        <h2>Distribusi Status Ticket</h2>
        <span>{helpdesk.total_tickets} ticket</span>
      </div>
      {helpdesk.total_tickets ? (
        <div className="mini-chart">
          {rows.map((row) => (
            <div className="chart-row" key={row.label}>
              <span>{row.label}</span>
              <div><b style={{ width: `${(row.value / total) * 100}%` }} /></div>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">Belum ada ticket pada periode ini.</div>
      )}
    </div>
  );
}

function TimelinePanel({ timeline }: { timeline: DashboardTimelineItem[] }) {
  const max = Math.max(...timeline.map((item) => Math.max(item.conversations, item.tickets, item.resolved)), 1);
  const hasData = timeline.some((item) => item.conversations || item.tickets || item.resolved);

  return (
    <div className="panel">
      <div className="panel-title">
        <h2>Timeline Periode</h2>
        <span>{timeline.length} hari</span>
      </div>
      {hasData ? (
        <div className="dashboard-timeline-chart">
          {timeline.map((item) => (
            <div className="timeline-bar-row" key={item.date}>
              <span>{item.date.slice(5)}</span>
              <div title={`${item.conversations} percakapan`}>
                <b style={{ width: `${(item.conversations / max) * 100}%` }} />
              </div>
              <div title={`${item.tickets} ticket`}>
                <b style={{ width: `${(item.tickets / max) * 100}%` }} />
              </div>
              <div title={`${item.resolved} selesai`}>
                <b style={{ width: `${(item.resolved / max) * 100}%` }} />
              </div>
            </div>
          ))}
          <div className="timeline-legend">
            <span>Percakapan</span>
            <span>Ticket</span>
            <span>Selesai</span>
          </div>
        </div>
      ) : (
        <div className="empty-state compact">Belum ada aktivitas pada periode ini.</div>
      )}
    </div>
  );
}

function HelpdeskPerformanceTable({ agents }: { agents: DashboardSummary["helpdesk"]["performance_by_helpdesk"] }) {
  return (
    <div className="panel dashboard-wide-panel">
      <div className="panel-title">
        <h2>Performa Per Petugas</h2>
        <span>{agents.length} petugas</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Nama Helpdesk</th>
            <th>Ticket Ditangani</th>
            <th>Ticket Selesai</th>
            <th>Rata-rata Response</th>
            <th>Rata-rata Resolution</th>
          </tr>
        </thead>
        <tbody>
          {agents.length ? agents.map((agent) => (
            <tr key={agent.helpdesk_id}>
              <td>{agent.name}</td>
              <td>{agent.tickets_handled}</td>
              <td>{agent.tickets_resolved}</td>
              <td>{minutes(agent.avg_response_minutes)}</td>
              <td>{minutes(agent.avg_resolution_minutes)}</td>
            </tr>
          )) : (
            <tr>
              <td colSpan={5}>Belum ada ticket yang ditangani petugas pada periode ini.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton">
      {Array.from({ length: 8 }).map((_, index) => <div className="skeleton-card" key={index} />)}
    </div>
  );
}

function Metric({ icon, label, value, note, progress, tone }: { icon?: ReactNode; label: string; value: string | number | undefined; note?: string; progress?: number; tone?: "amber" }) {
  return (
    <article className={`metric-card ${tone ? `metric-${tone}` : ""}`}>
      <div className="metric-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value ?? 0}</strong>
      {note && <small>{note}</small>}
      {typeof progress === "number" && (
        <div className="metric-progress">
          <b style={{ width: `${Math.max(0, Math.min(progress, 1)) * 100}%` }} />
        </div>
      )}
    </article>
  );
}
