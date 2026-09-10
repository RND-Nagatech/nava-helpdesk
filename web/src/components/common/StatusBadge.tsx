import type { HandoverStatus, Priority, TicketStatus } from "../../types";

const statusLabels: Record<TicketStatus, string> = {
  new: "Baru",
  pending: "Pending",
  in_progress: "Ditangani",
  resolved: "Selesai",
};

const handoverLabels: Record<HandoverStatus, string> = {
  pending: "Menunggu",
  active: "Aktif",
  resolved: "Selesai",
};

const priorityLabels: Record<Priority, string> = {
  low: "Rendah",
  normal: "Normal",
  high: "Tinggi",
  urgent: "Urgent",
};

export function StatusBadge({ value, type }: { value: TicketStatus | HandoverStatus | Priority; type: "status" | "handover" | "priority" }) {
  const label = type === "status"
    ? statusLabels[value as TicketStatus]
    : type === "handover"
      ? handoverLabels[value as HandoverStatus]
      : priorityLabels[value as Priority];

  return <span className={`badge badge-${value}`}>{label || value}</span>;
}
