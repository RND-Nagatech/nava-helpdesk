import { useEffect, useRef, useState } from "react";
import { TicketTable } from "../../components/ticket/TicketTable";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { navigateWithinHelpdesk } from "../../lib/navigation";
import { subscribeHelpdeskEvent } from "../../lib/helpdeskEvents";
import { api } from "../../services/api";
import type { Ticket } from "../../types";

export function HandoverPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState("");
  const loadVersion = useRef(0);

  async function load() {
    const version = ++loadVersion.current;
    try {
      setError("");
      const rows = await api.tickets({ status: "waiting", handover_status: "pending", assignment: "unassigned", sort: "oldest", limit: "50" });
      if (version !== loadVersion.current) return;
      setTickets(rows.filter((ticket) => !ticket.assigned_helpdesk_id && ticket.status !== "resolved" && ticket.handover_status === "pending"));
    } catch (err) {
      if (version !== loadVersion.current) return;
      setError(err instanceof Error ? err.message : "Gagal memuat handover.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const cleanups = (["new_ticket", "ticket_updated", "handover_started", "handover_resolved"] as const)
      .map((eventName) => subscribeHelpdeskEvent(eventName, load));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  async function accept(ticket: Ticket) {
    await api.acceptTicket(ticket._id);
    navigateWithinHelpdesk(`/helpdesk/chat/${ticket.session_id}?ticketId=${ticket._id}`);
  }

  async function resolve(ticket: Ticket) {
    await api.resolveTicket(ticket._id);
    await load();
  }

  return (
    <HelpdeskLayout>
      <section className="queue-hero compact">
        <div>
          <span className="eyebrow">Live Handover</span>
          <h1>Handover</h1>
          <p>Antrian customer yang sedang menunggu bantuan manusia.</p>
        </div>
        <div className="queue-stats">
          <article>
            <span>Menunggu Petugas</span>
            <strong>{tickets.length}</strong>
            <small>belum ditangani</small>
          </article>
        </div>
      </section>
      {error && <div className="error-box">{error}</div>}
      <TicketTable tickets={tickets} onAccept={accept} onResolve={resolve} variant="handover" />
    </HelpdeskLayout>
  );
}
