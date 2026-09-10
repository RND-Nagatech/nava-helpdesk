import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";

export async function saveAgentTrace({
  runId,
  sessionId,
  customerId = null,
  question,
  answer,
  toolTrace = [],
  searches = [],
  escalation = null,
  latencyMs = null,
  modelCallCount = null,
  memorySource = null,
}) {
  const db = await getDb();
  await db.collection(env.agentTraceCollection).insertOne({
    run_id: runId,
    session_id: sessionId,
    customer_id: customerId || null,
    question,
    answer,
    tool_trace: toolTrace,
    searches,
    escalation,
    metrics: {
      latency_ms: latencyMs,
      model_call_count: modelCallCount,
      tool_call_count: toolTrace.length,
      memory_source: memorySource,
    },
    created_at: new Date(),
  });
}

export async function deleteAgentTraceSession(sessionId) {
  const db = await getDb();
  return db.collection(env.agentTraceCollection).deleteMany({ session_id: sessionId });
}
