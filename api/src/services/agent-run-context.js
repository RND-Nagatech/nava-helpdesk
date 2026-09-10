import { AsyncLocalStorage } from "node:async_hooks";

export const agentRunContext = new AsyncLocalStorage();
