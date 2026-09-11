import { api } from "../services/api";

export type HelpdeskEventName =
  | "new_message"
  | "new_ticket"
  | "ticket_updated"
  | "handover_started"
  | "handover_resolved";

type HelpdeskEventHandler = (event: MessageEvent) => void;
type HelpdeskConnectionHandler = (reconnecting: boolean) => void;

const eventNames: HelpdeskEventName[] = [
  "new_message",
  "new_ticket",
  "ticket_updated",
  "handover_started",
  "handover_resolved",
];

let stream: EventSource | null = null;
const subscribers = new Map<HelpdeskEventName, Set<HelpdeskEventHandler>>();
const connectionSubscribers = new Set<HelpdeskConnectionHandler>();

function dispatch(eventName: HelpdeskEventName, event: Event) {
  const handlers = subscribers.get(eventName);
  if (!handlers?.size) return;
  for (const handler of [...handlers]) handler(event as MessageEvent);
}

function ensureStream() {
  if (stream) return;
  stream = new EventSource(api.eventsUrl());
  stream.addEventListener("open", () => {
    for (const handler of [...connectionSubscribers]) handler(false);
  });
  stream.addEventListener("error", () => {
    for (const handler of [...connectionSubscribers]) handler(true);
  });
  for (const eventName of eventNames) {
    stream.addEventListener(eventName, (event) => dispatch(eventName, event));
  }
}

export function subscribeHelpdeskConnection(handler: HelpdeskConnectionHandler) {
  connectionSubscribers.add(handler);
  ensureStream();
  if (stream?.readyState === EventSource.OPEN) handler(false);

  return () => {
    connectionSubscribers.delete(handler);
  };
}

export function subscribeHelpdeskEvent(eventName: HelpdeskEventName, handler: HelpdeskEventHandler) {
  const handlers = subscribers.get(eventName) || new Set<HelpdeskEventHandler>();
  handlers.add(handler);
  subscribers.set(eventName, handlers);
  ensureStream();

  return () => {
    handlers.delete(handler);
    if (handlers.size) return;
    subscribers.delete(eventName);

    const hasSubscribers = [...subscribers.values()].some((items) => items.size > 0);
    if (!hasSubscribers && stream) {
      stream.close();
      stream = null;
    }
  };
}
