import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";
import { getChatMessages, getLastChatMessagesBySession, saveChatMessage } from "./chat-history.js";
import { deleteAgentThread } from "./agent-memory.js";
import { publishEvent } from "./event-bus.js";

const ACTIVE_STATUSES = ["new", "pending", "in_progress"];

function now() {
  return new Date();
}

export function createTicketCode(date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TCK-${ymd}-${suffix}`;
}

export function normalizePriority(priority) {
  return ["low", "normal", "high", "urgent"].includes(priority) ? priority : "normal";
}

export function createTicketDocument({
  sessionId,
  customerId = null,
  customerName = "",
  customerDomain = "",
  subject = "Permintaan bantuan helpdesk",
  reason = "",
  source = "customer_button",
  priority = "normal",
}) {
  const createdAt = now();
  return {
    ticket_code: createTicketCode(createdAt),
    session_id: sessionId,
    customer_id: customerId,
    customer_name: customerName || customerId || "Customer",
    customer_domain: customerDomain || null,
    subject,
    reason,
    source,
    priority: normalizePriority(priority),
    status: "new",
    handover_status: "pending",
    assigned_helpdesk_id: null,
    assigned_helpdesk_name: null,
    created_at: createdAt,
    first_response_at: null,
    resolved_at: null,
    last_message_at: createdAt,
  };
}

function serializeId(doc) {
  if (!doc) return null;
  return { ...doc, _id: String(doc._id) };
}

function normalizeDateStart(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDateEnd(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ticketQuery({ search, status, priority, handoverStatus, assignment, startDate, endDate, helpdeskId } = {}) {
  const query = {};
  if (status === "open" || status === "active") query.status = { $in: ACTIVE_STATUSES };
  else if (status === "waiting") query.status = { $in: ["new", "pending"] };
  else if (status && status !== "all") query.status = status;
  if (priority) query.priority = priority;
  if (handoverStatus) query.handover_status = handoverStatus;
  if (helpdeskId && helpdeskId !== "all") query.assigned_helpdesk_id = helpdeskId;
  const from = normalizeDateStart(startDate);
  const to = normalizeDateEnd(endDate);
  if (from || to) {
    query.created_at = {};
    if (from) query.created_at.$gte = from;
    if (to) query.created_at.$lte = to;
  }
  if (assignment === "unassigned") {
    query.$or = [
      { assigned_helpdesk_id: null },
      { assigned_helpdesk_id: "" },
      { assigned_helpdesk_id: { $exists: false } },
    ];
  } else if (assignment === "assigned") {
    query.assigned_helpdesk_id = { $exists: true, $nin: [null, ""] };
  }
  if (search) {
    const searchOr = [
      { ticket_code: { $regex: search, $options: "i" } },
      { customer_name: { $regex: search, $options: "i" } },
      { customer_id: { $regex: search, $options: "i" } },
      { subject: { $regex: search, $options: "i" } },
      { session_id: { $regex: search, $options: "i" } },
    ];
    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: searchOr }];
      delete query.$or;
    } else {
      query.$or = searchOr;
    }
  }
  return query;
}

function msToMinutesText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  return `${Math.round((ms / 60000) * 10) / 10} menit`;
}

function csvCell(value) {
  const text = value === undefined || value === null || value === "" ? "-" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toISOString();
}

export function ticketCsv(tickets = []) {
  const headers = [
    "Kode Ticket",
    "Customer",
    "Subject",
    "Status",
    "Helpdesk",
    "Tanggal Dibuat",
    "Tanggal Selesai",
    "Waktu Respons Pertama",
    "Waktu Penyelesaian",
  ];
  const rows = tickets.map((ticket) => {
    const createdAt = ticket.created_at ? new Date(ticket.created_at) : null;
    const firstResponseMs = createdAt && ticket.first_response_at ? new Date(ticket.first_response_at) - createdAt : NaN;
    const resolutionMs = createdAt && ticket.resolved_at ? new Date(ticket.resolved_at) - createdAt : NaN;
    return [
      ticket.ticket_code,
      ticket.customer_name || ticket.customer_id,
      ticket.subject,
      ticket.status,
      ticket.assigned_helpdesk_name || "Belum ditangani",
      formatDate(ticket.created_at),
      formatDate(ticket.resolved_at),
      msToMinutesText(firstResponseMs),
      msToMinutesText(resolutionMs),
    ].map(csvCell).join(",");
  });
  return [headers.map(csvCell).join(","), ...rows].join("\n");
}

export async function findActiveTicketBySession(sessionId) {
  const db = await getDb();
  return db.collection(env.ticketCollection).findOne({
    session_id: sessionId,
    status: { $in: ACTIVE_STATUSES },
  }, { maxTimeMS: 5000 });
}

export async function createTicket(input) {
  const db = await getDb();
  const existing = await findActiveTicketBySession(input.sessionId);
  if (existing) return { ticket: serializeId(existing), created: false };

  const doc = createTicketDocument(input);
  await db.collection(env.ticketCollection).insertOne(doc);
  const ticket = serializeId(doc);
  publishEvent("new_ticket", { ticket });
  return { ticket, created: true };
}

export async function listTickets(filters = {}) {
  const db = await getDb();
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 100);
  const page = Math.max(Number(filters.page || 0), 0);
  const query = ticketQuery(filters);
  const tickets = await db
    .collection(env.ticketCollection)
    .find(query, { maxTimeMS: 5000 })
    .sort({ last_message_at: -1, created_at: -1 })
    .skip(page ? (page - 1) * limit : 0)
    .limit(limit)
    .toArray();

  const lastMessageBySession = await getLastChatMessagesBySession(tickets.map((ticket) => ticket.session_id));

  const rows = tickets.map((ticket) => ({
    ...serializeId(ticket),
    last_message: lastMessageBySession.get(ticket.session_id)?.content || "",
  }));

  if (!page) return rows;
  const total = await db.collection(env.ticketCollection).countDocuments(query, { maxTimeMS: 5000 });
  return {
    data: rows,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.max(Math.ceil(total / limit), 1),
    },
  };
}

export async function listHelpdeskTicketAssignees(filters = {}) {
  const db = await getDb();
  const query = ticketQuery({ ...filters, helpdeskId: "all" });
  query.assigned_helpdesk_id = { $exists: true, $nin: [null, ""] };
  const rows = await db.collection(env.ticketCollection).aggregate([
    { $match: query },
    {
      $group: {
        _id: "$assigned_helpdesk_id",
        name: { $first: "$assigned_helpdesk_name" },
      },
    },
    { $sort: { name: 1, _id: 1 } },
  ], { maxTimeMS: 5000 }).toArray();
  return rows.map((row) => ({ helpdesk_id: row._id, name: row.name || row._id }));
}

export async function exportTicketsCsv(filters = {}) {
  const db = await getDb();
  const limit = Math.min(Math.max(Number(filters.limit || 5000), 1), 10000);
  const tickets = await db
    .collection(env.ticketCollection)
    .find(ticketQuery(filters), { maxTimeMS: 10000 })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
  return ticketCsv(tickets.map(serializeId));
}

export async function getTicketBySession(sessionId) {
  const db = await getDb();
  const ticket = await db.collection(env.ticketCollection).findOne({ session_id: sessionId }, { maxTimeMS: 5000, sort: { created_at: -1 } });
  return serializeId(ticket);
}

export async function getTicketDetail(id, { includeMessages = true } = {}) {
  const db = await getDb();
  const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { ticket_code: id };
  const ticket = await db.collection(env.ticketCollection).findOne(query, { maxTimeMS: 5000 });
  if (!ticket) return null;
  const messages = includeMessages ? await getChatMessages(ticket.session_id) : [];
  return { ticket: serializeId(ticket), messages };
}

export async function acceptHandover({ id, helpdeskId, helpdeskName }) {
  const db = await getDb();
  const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { ticket_code: id };
  const existing = await db.collection(env.ticketCollection).findOne(query, { maxTimeMS: 5000 });
  if (!existing || existing.status === "resolved") return null;
  if (existing.assigned_helpdesk_id) return serializeId(existing);

  const update = {
    $set: {
      status: "in_progress",
      handover_status: "active",
      assigned_helpdesk_id: helpdeskId,
      assigned_helpdesk_name: helpdeskName,
      updated_at: now(),
    },
  };
  const result = await db.collection(env.ticketCollection).findOneAndUpdate(
    {
      ...query,
      status: { $in: ["new", "pending"] },
      $or: [
        { assigned_helpdesk_id: null },
        { assigned_helpdesk_id: "" },
        { assigned_helpdesk_id: { $exists: false } },
      ],
    },
    update,
    { returnDocument: "after", maxTimeMS: 5000 }
  );
  const ticket = serializeId(result);
  if (!ticket) return serializeId(existing);
  publishEvent("handover_started", { ticket });
  publishEvent("ticket_updated", { ticket });
  return ticket;
}

export async function saveHelpdeskReply({ sessionId, customerId, helpdeskId, helpdeskName, message, attachments = [] }) {
  const db = await getDb();
  const ticket = await findActiveTicketBySession(sessionId);
  if (!ticket) {
    const error = new Error("Ticket aktif tidak ditemukan untuk session ini.");
    error.code = "ACTIVE_TICKET_NOT_FOUND";
    throw error;
  }

  const createdAt = now();
  const chat = await saveChatMessage({
    sessionId,
    customerId: customerId || ticket.customer_id || null,
    role: "helpdesk",
    content: message,
    metadata: {
      helpdesk_id: helpdeskId,
      helpdesk_name: helpdeskName,
      attachments,
    },
  });

  const set = {
    status: "in_progress",
    handover_status: "active",
    assigned_helpdesk_id: ticket.assigned_helpdesk_id || helpdeskId,
    assigned_helpdesk_name: ticket.assigned_helpdesk_name || helpdeskName,
    last_message_at: createdAt,
    updated_at: createdAt,
  };
  if (!ticket.first_response_at) set.first_response_at = createdAt;

  await db.collection(env.ticketCollection).updateOne({ _id: ticket._id }, { $set: set });
  publishEvent("new_message", { session_id: sessionId, message: chat });
  return chat;
}

export async function resolveTicket(id, helpdeskUser = null) {
  const db = await getDb();
  const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { ticket_code: id };
  const existing = await db.collection(env.ticketCollection).findOne(query, { maxTimeMS: 5000 });
  if (!existing) return null;
  if (existing.status === "resolved") return serializeId(existing);

  const resolvedAt = now();
  const resolverId = helpdeskUser?.helpdesk_id || existing.assigned_helpdesk_id || null;
  const resolverName = helpdeskUser?.name || existing.assigned_helpdesk_name || "Helpdesk";
  const result = await db.collection(env.ticketCollection).findOneAndUpdate(
    query,
    {
      $set: {
        status: "resolved",
        handover_status: "resolved",
        resolved_at: resolvedAt,
        resolved_by_helpdesk_id: resolverId,
        resolved_by_helpdesk_name: resolverName,
        last_message_at: resolvedAt,
        updated_at: resolvedAt,
      },
    },
    { returnDocument: "after" }
  );
  const ticket = serializeId(result);

  const closeMessage = await saveChatMessage({
    sessionId: existing.session_id,
    customerId: existing.customer_id || null,
    role: "helpdesk",
    content: "Percakapan dengan petugas helpdesk sudah berakhir. Jika ada pertanyaan berikutnya, NAVA akan kembali membantu Anda di chat ini.",
    metadata: {
      system_event: "handover_resolved",
      ticket_code: existing.ticket_code,
      helpdesk_id: resolverId,
      helpdesk_name: resolverName,
    },
  });

  publishEvent("new_message", { session_id: existing.session_id, message: closeMessage });
  publishEvent("handover_resolved", { ticket });
  publishEvent("ticket_updated", { ticket });
  await deleteAgentThread(existing.session_id).catch(() => undefined);
  return ticket;
}

export async function markCustomerMessageOnTicket(sessionId) {
  const db = await getDb();
  const ticket = await findActiveTicketBySession(sessionId);
  if (!ticket) return null;
  await db.collection(env.ticketCollection).updateOne(
    { _id: ticket._id },
    {
      $set: {
        status: ticket.status === "new" ? "pending" : ticket.status,
        last_message_at: now(),
        updated_at: now(),
      },
    }
  );
  return ticket;
}
