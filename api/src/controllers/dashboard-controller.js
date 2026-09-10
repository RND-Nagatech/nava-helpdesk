import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";

const DASHBOARD_TIMEZONE = "Asia/Jakarta";
const MS_IN_DAY = 24 * 60 * 60 * 1000;

function jakartaDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DASHBOARD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dateFromParam(value, fallback, endOfDay = false) {
  const raw = String(value || fallback || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return dateFromParam(fallback, jakartaDateString(), endOfDay);
  return new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`);
}

function dashboardRange(query = {}) {
  const today = jakartaDateString();
  const startDate = String(query.start_date || today).slice(0, 10);
  const endDate = String(query.end_date || startDate || today).slice(0, 10);
  return {
    start: dateFromParam(startDate, today, false),
    end: dateFromParam(endDate, startDate, true),
  };
}

function periodMatch(field, range) {
  return { [field]: { $gte: range.start, $lte: range.end } };
}

function roundNumber(value, decimals = 0) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function msToMinutes(ms) {
  return roundNumber(Number(ms || 0) / 60000, 1);
}

function settledValue(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function countByStatus(rows = []) {
  return Object.fromEntries(rows.map((row) => [row._id || "unknown", row.total || 0]));
}

function timelineDateRange(range) {
  const startLabel = jakartaDateString(range.start);
  const endLabel = jakartaDateString(range.end);
  const start = Date.parse(`${startLabel}T00:00:00.000Z`);
  const end = Date.parse(`${endLabel}T00:00:00.000Z`);
  const dates = [];
  for (let time = start; time <= end; time += MS_IN_DAY) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

function mergeTimeline(range, chatRows = [], ticketRows = []) {
  const byDate = new Map(timelineDateRange(range).map((date) => [date, {
    date,
    conversations: 0,
    nava_responses: 0,
    tickets: 0,
    resolved: 0,
  }]));

  for (const row of chatRows) {
    if (!byDate.has(row._id)) byDate.set(row._id, { date: row._id, conversations: 0, nava_responses: 0, tickets: 0, resolved: 0 });
    const current = byDate.get(row._id);
    current.conversations = row.conversations || 0;
    current.nava_responses = row.nava_responses || 0;
  }

  for (const row of ticketRows) {
    if (!byDate.has(row._id)) byDate.set(row._id, { date: row._id, conversations: 0, nava_responses: 0, tickets: 0, resolved: 0 });
    const current = byDate.get(row._id);
    current.tickets = row.tickets || 0;
    current.resolved = row.resolved || 0;
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export async function dashboardSummary(req, res, next) {
  try {
    const db = await getDb();
    const chat = db.collection(env.chatCollection);
    const trace = db.collection(env.agentTraceCollection);
    const tickets = db.collection(env.ticketCollection);
    const range = dashboardRange(req.query);
    const chatPeriod = periodMatch("created_at", range);
    const tracePeriod = periodMatch("created_at", range);
    const ticketPeriod = periodMatch("created_at", range);

    const [
      conversationRows,
      navaResponseCount,
      traceRows,
      ticketStatusRows,
      ticketTimeRows,
      helpdeskMessageCount,
      perHelpdeskRows,
      chatTimelineRows,
      ticketTimelineRows,
    ] = (await Promise.allSettled([
      chat.aggregate([
        { $match: chatPeriod },
        { $group: { _id: "$session_id" } },
        { $count: "total" },
      ], { maxTimeMS: 5000 }).toArray(),
      chat.countDocuments({ ...chatPeriod, role: "assistant" }, { maxTimeMS: 5000 }),
      trace.aggregate([
        { $match: tracePeriod },
        {
          $project: {
            latency: { $ifNull: ["$metrics.latency_ms", { $ifNull: ["$latency_ms", "$runtime_meta.agent_latency_ms"] }] },
            modelCall: { $ifNull: ["$metrics.model_call_count", { $ifNull: ["$model_call_count", "$runtime_meta.model_call_count"] }] },
            toolCall: {
              $ifNull: [
                "$metrics.tool_call_count",
                { $ifNull: ["$runtime_meta.tool_call_count", { $size: { $ifNull: ["$tool_trace", { $ifNull: ["$toolTrace", []] }] } }] },
              ],
            },
            usedKnowledge: {
              $cond: [
                { $or: [{ $gt: [{ $size: { $ifNull: ["$searches", []] } }, 0] }, { $eq: ["$runtime_meta.used_knowledge", true] }] },
                1,
                0,
              ],
            },
            escalated: { $cond: [{ $ne: ["$escalation", null] }, 1, 0] },
            recursionFallback: {
              $cond: [
                { $or: [{ $eq: ["$runtime_meta.recursion_fallback", true] }, { $eq: ["$metrics.recursion_fallback", true] }] },
                1,
                0,
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            knowledgeUses: { $sum: "$usedKnowledge" },
            escalations: { $sum: "$escalated" },
            recursionFallback: { $sum: "$recursionFallback" },
            avgLatencyMs: { $avg: "$latency" },
            avgModelCall: { $avg: "$modelCall" },
            avgToolCall: { $avg: "$toolCall" },
          },
        },
      ], { maxTimeMS: 5000 }).toArray(),
      tickets.aggregate([
        { $match: ticketPeriod },
        { $group: { _id: "$status", total: { $sum: 1 } } },
      ], { maxTimeMS: 5000 }).toArray(),
      tickets.aggregate([
        { $match: ticketPeriod },
        {
          $project: {
            firstResponseMs: {
              $cond: [
                { $and: ["$first_response_at", "$created_at"] },
                { $subtract: ["$first_response_at", "$created_at"] },
                null,
              ],
            },
            resolutionMs: {
              $cond: [
                { $and: ["$resolved_at", "$created_at"] },
                { $subtract: ["$resolved_at", "$created_at"] },
                null,
              ],
            },
          },
        },
        { $group: { _id: null, avgFirstResponseMs: { $avg: "$firstResponseMs" }, avgResolutionMs: { $avg: "$resolutionMs" } } },
      ], { maxTimeMS: 5000 }).toArray(),
      chat.countDocuments({ ...chatPeriod, role: "helpdesk" }, { maxTimeMS: 5000 }),
      tickets.aggregate([
        { $match: { ...ticketPeriod, assigned_helpdesk_id: { $exists: true, $nin: [null, ""] } } },
        {
          $project: {
            assigned_helpdesk_id: 1,
            assigned_helpdesk_name: 1,
            resolved: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] },
            firstResponseMs: {
              $cond: [
                { $and: ["$first_response_at", "$created_at"] },
                { $subtract: ["$first_response_at", "$created_at"] },
                null,
              ],
            },
            resolutionMs: {
              $cond: [
                { $and: ["$resolved_at", "$created_at"] },
                { $subtract: ["$resolved_at", "$created_at"] },
                null,
              ],
            },
          },
        },
        {
          $group: {
            _id: "$assigned_helpdesk_id",
            nama: { $first: "$assigned_helpdesk_name" },
            ticket_ditangani: { $sum: 1 },
            ticket_selesai: { $sum: "$resolved" },
            avgFirstResponseMs: { $avg: "$firstResponseMs" },
            avgResolutionMs: { $avg: "$resolutionMs" },
          },
        },
        { $sort: { ticket_ditangani: -1, nama: 1 } },
      ], { maxTimeMS: 5000 }).toArray(),
      chat.aggregate([
        { $match: chatPeriod },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$created_at", timezone: DASHBOARD_TIMEZONE } },
              session: "$session_id",
            },
            nava_responses: { $sum: { $cond: [{ $eq: ["$role", "assistant"] }, 1, 0] } },
          },
        },
        {
          $group: {
            _id: "$_id.date",
            conversations: { $sum: 1 },
            nava_responses: { $sum: "$nava_responses" },
          },
        },
        { $sort: { _id: 1 } },
      ], { maxTimeMS: 5000 }).toArray(),
      tickets.aggregate([
        { $match: ticketPeriod },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at", timezone: DASHBOARD_TIMEZONE } },
            tickets: { $sum: 1 },
            resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ], { maxTimeMS: 5000 }).toArray(),
    ])).map((result, index) => settledValue(result, [1, 5].includes(index) ? 0 : []));

    const totalConversations = conversationRows[0]?.total || 0;
    const traceSummary = traceRows[0] || {};
    const knowledgeUses = traceSummary.knowledgeUses || 0;
    const escalations = traceSummary.escalations || 0;
    const ticketCounts = countByStatus(ticketStatusRows);
    const totalTickets = ticketStatusRows.reduce((sum, row) => sum + (row.total || 0), 0);
    const ticketTimes = ticketTimeRows[0] || {};

    res.json({
      success: true,
      data: {
        period: {
          start_date: jakartaDateString(range.start),
          end_date: jakartaDateString(range.end),
          timezone: DASHBOARD_TIMEZONE,
        },
        agent: {
          total_conversations: totalConversations,
          total_responses: navaResponseCount,
          knowledge_usage_count: knowledgeUses,
          knowledge_usage_rate: navaResponseCount ? knowledgeUses / navaResponseCount : 0,
          escalation_count: escalations,
          escalation_rate: totalConversations ? escalations / totalConversations : 0,
          avg_latency_ms: Math.round(traceSummary.avgLatencyMs || 0),
          avg_model_calls: roundNumber(traceSummary.avgModelCall, 1),
          avg_tool_calls: roundNumber(traceSummary.avgToolCall, 1),
          recursion_fallback_count: traceSummary.recursionFallback || 0,
        },
        helpdesk: {
          total_tickets: totalTickets,
          new_tickets: ticketCounts.new || 0,
          waiting_handover: (ticketCounts.new || 0) + (ticketCounts.pending || 0),
          in_progress: ticketCounts.in_progress || 0,
          resolved: ticketCounts.resolved || 0,
          avg_first_response_ms: Math.round(ticketTimes.avgFirstResponseMs || 0),
          avg_first_response_minutes: msToMinutes(ticketTimes.avgFirstResponseMs || 0),
          avg_resolution_ms: Math.round(ticketTimes.avgResolutionMs || 0),
          avg_resolution_minutes: msToMinutes(ticketTimes.avgResolutionMs || 0),
          total_helpdesk_messages: helpdeskMessageCount,
          performance_by_helpdesk: perHelpdeskRows.map((row) => ({
            helpdesk_id: row._id,
            name: row.nama || row._id || "Helpdesk",
            tickets_handled: row.ticket_ditangani || 0,
            tickets_resolved: row.ticket_selesai || 0,
            avg_response_ms: Math.round(row.avgFirstResponseMs || 0),
            avg_response_minutes: msToMinutes(row.avgFirstResponseMs || 0),
            avg_resolution_ms: Math.round(row.avgResolutionMs || 0),
            avg_resolution_minutes: msToMinutes(row.avgResolutionMs || 0),
          })),
        },
        timeline: mergeTimeline(range, chatTimelineRows, ticketTimelineRows),
      },
    });
  } catch (error) {
    next(error);
  }
}
