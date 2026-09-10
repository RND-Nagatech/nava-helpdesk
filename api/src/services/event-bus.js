const clients = new Set();

export const HELP_DESK_EVENTS = [
  "new_message",
  "new_ticket",
  "ticket_updated",
  "handover_started",
  "handover_resolved",
];

export function addEventClient(res) {
  clients.add(res);
  res.on("error", () => {
    clients.delete(res);
  });
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ ok: true, timestamp: new Date().toISOString() })}\n\n`);

  return () => {
    clients.delete(res);
  };
}

export function publishEvent(event, payload = {}) {
  if (!HELP_DESK_EVENTS.includes(event)) return;

  const message = `event: ${event}\ndata: ${JSON.stringify({
    ...payload,
    event,
    timestamp: new Date().toISOString(),
  })}\n\n`;

  for (const client of [...clients]) {
    try {
      client.write(message);
    } catch {
      clients.delete(client);
    }
  }
}
