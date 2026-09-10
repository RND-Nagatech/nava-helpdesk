import { z } from "zod";
import {
  acceptHandover,
  createTicket,
  getTicketBySession,
  getTicketDetail,
  exportTicketsCsv,
  listHelpdeskTicketAssignees,
  listTickets,
  resolveTicket,
  saveHelpdeskReply,
} from "../services/ticket-service.js";

function ticketFiltersFromQuery(query) {
  return {
    search: query.search ? String(query.search) : "",
    status: query.status ? String(query.status) : "",
    priority: query.priority ? String(query.priority) : "",
    handoverStatus: query.handover_status ? String(query.handover_status) : "",
    assignment: query.assignment ? String(query.assignment) : "",
    helpdeskId: query.helpdesk_id ? String(query.helpdesk_id) : "",
    startDate: query.start_date ? String(query.start_date) : "",
    endDate: query.end_date ? String(query.end_date) : "",
    page: query.page ? Number(query.page) : 0,
    limit: query.limit ? Number(query.limit) : 100,
  };
}

const createTicketSchema = z.object({
  session_id: z.string().trim().min(3).max(200),
  customer_id: z.string().trim().min(2).max(200).optional().nullable(),
  customer_name: z.string().trim().max(200).optional(),
  customer_domain: z.string().trim().max(200).optional(),
  subject: z.string().trim().min(3).max(300).optional(),
  reason: z.string().trim().max(1000).optional(),
  source: z.enum(["customer_button", "agent_escalation"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});

const replySchema = z.object({
  session_id: z.string().trim().min(3).max(200),
  customer_id: z.string().trim().min(2).max(200).optional().nullable(),
  message: z.string().trim().min(1).max(4000),
  attachments: z.array(z.object({
    filename: z.string(),
    original_name: z.string(),
    mime_type: z.string(),
    size: z.number(),
    url: z.string(),
  })).max(5).optional(),
});

export async function createTicketHandler(req, res, next) {
  try {
    const input = createTicketSchema.parse(req.body);
    const result = await createTicket({
      sessionId: input.session_id,
      customerId: input.customer_id || null,
      customerName: input.customer_name,
      customerDomain: input.customer_domain,
      subject: input.subject,
      reason: input.reason,
      source: input.source || "customer_button",
      priority: input.priority || "normal",
    });
    res.status(result.created ? 201 : 200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function listTicketsHandler(req, res, next) {
  try {
    const result = await listTickets(ticketFiltersFromQuery(req.query));
    if (result?.pagination) {
      return res.json({ success: true, data: result.data, pagination: result.pagination });
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function ticketAssigneesHandler(req, res, next) {
  try {
    const assignees = await listHelpdeskTicketAssignees(ticketFiltersFromQuery(req.query));
    res.json({ success: true, data: assignees });
  } catch (error) {
    next(error);
  }
}

export async function exportTicketsCsvHandler(req, res, next) {
  try {
    const csv = await exportTicketsCsv(ticketFiltersFromQuery(req.query));
    const filename = `daftar-tiket-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
}

export async function ticketDetailHandler(req, res, next) {
  try {
    const detail = await getTicketDetail(req.params.id, { includeMessages: req.query.messages !== "false" });
    if (!detail) return res.status(404).json({ success: false, message: "Ticket tidak ditemukan." });
    res.json({ success: true, data: detail });
  } catch (error) {
    next(error);
  }
}

export async function ticketBySessionHandler(req, res, next) {
  try {
    const ticket = await getTicketBySession(req.params.session_id);
    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
}

export async function acceptHandoverHandler(req, res, next) {
  try {
    const helpdeskUser = req.helpdeskUser;
    const ticket = await acceptHandover({
      id: req.params.id,
      helpdeskId: helpdeskUser.helpdesk_id,
      helpdeskName: helpdeskUser.name,
    });
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket tidak ditemukan." });
    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
}

export async function helpdeskReplyHandler(req, res, next) {
  try {
    const input = replySchema.parse(req.body);
    const message = await saveHelpdeskReply({
      sessionId: input.session_id,
      customerId: input.customer_id || null,
      helpdeskId: req.helpdeskUser.helpdesk_id,
      helpdeskName: req.helpdeskUser.name,
      message: input.message,
      attachments: input.attachments || [],
    });
    res.status(201).json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
}

export async function resolveTicketHandler(req, res, next) {
  try {
    const ticket = await resolveTicket(req.params.id, req.helpdeskUser);
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket tidak ditemukan." });
    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
}
