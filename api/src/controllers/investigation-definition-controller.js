import { z } from "zod";
import {
  archiveInvestigationDefinition,
  createInvestigationDefinition,
  getInvestigationDefinition,
  listInvestigationDefinitions,
  publishInvestigationDefinition,
  updateInvestigationDefinition,
} from "../services/investigation-definition-service.js";

const definitionSchema = z.object({
  operation_id: z.string().trim().min(3).max(100),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  allowed_collections: z.array(z.string().trim().max(120)).min(1).max(20),
  filters: z.array(z.string().trim().max(120)).max(30).optional(),
  group_by: z.array(z.string().trim().max(160)).max(30).optional(),
  metrics: z.array(z.object({
    source: z.string().trim().max(120),
    field: z.string().trim().max(160),
    operation: z.enum(["sum", "count", "avg", "min", "max"]),
    alias: z.string().trim().max(120).optional(),
  })).max(30).optional(),
  relation: z.object({
    left_collection: z.string().trim().max(120),
    left_field: z.string().trim().max(160),
    right_collection: z.string().trim().max(120),
    right_field: z.string().trim().max(160),
  }).nullable().optional(),
  result_type: z.enum(["unmatched_and_amount_difference", "summary_difference", "relation_lookup", "custom"]).optional(),
  execution: z.object({
    source_collection: z.string().trim().max(120),
    pipeline: z.array(z.record(z.string(), z.unknown())).max(50),
    max_rows: z.number().int().min(1).max(500).optional(),
  }).nullable().optional(),
  linked_knowledge_ids: z.array(z.string().trim().max(120)).max(30).optional(),
});

function operationIdParam(req) {
  return z.string().trim().min(3).max(100).parse(req.params.operationId);
}

export async function listInvestigationDefinitionsHandler(req, res, next) {
  try {
    res.json({
      success: true,
      data: await listInvestigationDefinitions({
        status: req.query.status ? String(req.query.status) : "",
        limit: req.query.limit ? Number(req.query.limit) : 100,
      }),
    });
  } catch (error) {
    next(error);
  }
}

export async function getInvestigationDefinitionHandler(req, res, next) {
  try {
    const definition = await getInvestigationDefinition(operationIdParam(req));
    if (!definition) return res.status(404).json({ success: false, message: "Definition investigasi tidak ditemukan." });
    res.json({ success: true, data: definition });
  } catch (error) {
    next(error);
  }
}

export async function createInvestigationDefinitionHandler(req, res, next) {
  try {
    const input = definitionSchema.parse(req.body);
    const definition = await createInvestigationDefinition(input, req.helpdeskUser);
    res.status(201).json({ success: true, data: definition });
  } catch (error) {
    next(error);
  }
}

export async function updateInvestigationDefinitionHandler(req, res, next) {
  try {
    const input = definitionSchema.parse(req.body);
    const definition = await updateInvestigationDefinition(operationIdParam(req), input, req.helpdeskUser);
    if (!definition) return res.status(404).json({ success: false, message: "Definition investigasi tidak ditemukan." });
    res.json({ success: true, data: definition });
  } catch (error) {
    next(error);
  }
}

export async function publishInvestigationDefinitionHandler(req, res, next) {
  try {
    const definition = await publishInvestigationDefinition(operationIdParam(req), req.helpdeskUser);
    if (!definition) return res.status(404).json({ success: false, message: "Definition investigasi tidak ditemukan." });
    res.json({ success: true, data: definition });
  } catch (error) {
    next(error);
  }
}

export async function archiveInvestigationDefinitionHandler(req, res, next) {
  try {
    const definition = await archiveInvestigationDefinition(operationIdParam(req), req.helpdeskUser);
    if (!definition) return res.status(404).json({ success: false, message: "Definition investigasi tidak ditemukan." });
    res.json({ success: true, data: definition });
  } catch (error) {
    next(error);
  }
}
