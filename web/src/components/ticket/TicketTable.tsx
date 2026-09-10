import { StatusBadge } from "../common/StatusBadge";
import { handleHelpdeskNavigation } from "../../lib/navigation";
import type { Ticket } from "../../types";

type TicketTableProps = {
  tickets: Ticket[];
  onAccept: (ticket: Ticket) => void;
  onResolve: (ticket: Ticket) => void;
  variant?: "tickets" | "handover";
};

export function TicketTable({ tickets, onAccept, onResolve, variant = "tickets" }: TicketTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Kode Ticket</th>
            <th>Customer</th>
            <th>Subject</th>
            <th>Status</th>
            <th>Prioritas</th>
            <th>Helpdesk</th>
            <th>Created At</th>
            <th>Last Message</th>
            <th>Resolved At</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr className={ticket.handover_status === "pending" ? "row-waiting" : ""} key={ticket._id}>
              <td>
                <div className="ticket-code">
                  <strong>{ticket.ticket_code}</strong>
                  <span>{ticket.source === "agent_escalation" ? "Eskalasi bot" : "Direct client"}</span>
                </div>
              </td>
              <td>
                <div className="customer-cell">
                  <span>{(ticket.customer_name || ticket.customer_id || "C").slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{ticket.customer_name || ticket.customer_id || "Customer"}</strong>
                    <small>{ticket.customer_domain || "NAVA"}</small>
                  </div>
                </div>
              </td>
              <td>
                <div className="subject-cell">
                  <strong>{ticket.subject}</strong>
                  <span>{ticket.reason || ticket.last_message || "-"}</span>
                </div>
              </td>
              <td>
                {variant === "handover"
                  ? <span className="badge badge-pending">Belum ditangani</span>
                  : <StatusBadge type="status" value={ticket.status} />}
              </td>
              <td><StatusBadge type="priority" value={ticket.priority} /></td>
              <td>{ticket.assigned_helpdesk_name || (variant === "handover" ? "Belum ditangani" : "-")}</td>
              <td className="mono-cell">{new Date(ticket.created_at).toLocaleString("id-ID")}</td>
              <td className="truncate-cell">{ticket.last_message || "-"}</td>
              <td className="mono-cell">{ticket.resolved_at ? new Date(ticket.resolved_at).toLocaleString("id-ID") : "-"}</td>
              <td>
                <div className="row-actions">
                  {variant === "handover" && <button onClick={() => onAccept(ticket)}>Ambil Chat</button>}
                  {variant === "tickets" && (
                    <a href={`/helpdesk/chat/${ticket.session_id}?ticketId=${ticket._id}`} onClick={handleHelpdeskNavigation}>
                      Buka Chat
                    </a>
                  )}
                  {variant === "tickets" && ticket.status !== "resolved" && <button onClick={() => onResolve(ticket)}>Selesaikan</button>}
                </div>
              </td>
            </tr>
          ))}
          {!tickets.length && (
            <tr>
              <td colSpan={10}>Tidak ada ticket yang sesuai.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
