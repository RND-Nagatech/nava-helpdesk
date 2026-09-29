import { z } from "zod";
import {
  archiveInvestigationPlaybook,
  createInvestigationPlaybook,
  getInvestigationPlaybook,
  listInvestigationPlaybooks,
  publishInvestigationPlaybook,
  updateInvestigationPlaybook,
} from "../services/investigation-playbook-service.js";

const collectionSchema = z.object({
  name: z.string().trim().max(120),
  purpose: z.string().trim().max(600).optional(),
  fields: z.array(z.string().trim().max(160)).max(40).optional(),
});

const relationSchema = z.object({
  from_collection: z.string().trim().max(120),
  from_field: z.string().trim().max(160),
  to_collection: z.string().trim().max(120),
  to_field: z.string().trim().max(160),
  explanation: z.string().trim().max(800).optional(),
});

const stepSchema = z.object({
  title: z.string().trim().max(160).optional(),
  instruction: z.string().trim().max(2400),
  expected_result: z.string().trim().max(800).optional(),
});

const parameterSchema = z.object({
  key: z.string().trim().max(80),
  label: z.string().trim().max(160).optional(),
  type: z.enum(["text", "date", "number", "boolean"]).optional(),
  required: z.boolean().optional(),
  description: z.string().trim().max(600).optional(),
});

const executionSchema = z.object({
  source_collection: z.string().trim().max(120),
  pipeline: z.array(z.record(z.string(), z.unknown())).max(60),
  max_rows: z.number().int().min(1).max(500).optional(),
});

const playbookSchema = z.object({
  playbook_id: z.string().trim().max(160).optional(),
  name: z.string().trim().max(240).optional(),
  description: z.string().trim().max(2400).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  trigger_examples: z.array(z.string().trim().max(600)).max(30).optional(),
  aggregation_source: z.string().trim().max(30000).optional(),
  aggregation_script: z.string().trim().max(30000).optional(),
  parameters: z.array(parameterSchema).max(30).optional(),
  executor_id: z.string().trim().max(180).optional(),
  executor_operation_id: z.string().trim().max(120).optional(),
  collections: z.array(collectionSchema).max(30).optional(),
  relations: z.array(relationSchema).max(30).optional(),
  steps: z.array(stepSchema).max(30).optional(),
  response_template: z.string().trim().max(6000).optional(),
  safety_notes: z.string().trim().max(3000).optional(),
  finding_rules: z.string().trim().max(5000).optional(),
  correction_guidance: z.string().trim().max(5000).optional(),
  execution: executionSchema.optional(),
});

function playbookIdParam(req) {
  return z.string().trim().min(3).max(160).parse(req.params.playbookId);
}

export async function listInvestigationPlaybooksHandler(req, res, next) {
  try {
    res.json({ success: true, data: await listInvestigationPlaybooks({ status: req.query.status ? String(req.query.status) : "" }) });
  } catch (error) {
    next(error);
  }
}

export async function getInvestigationPlaybookHandler(req, res, next) {
  try {
    const playbook = await getInvestigationPlaybook(playbookIdParam(req));
    if (!playbook) return res.status(404).json({ success: false, message: "Playbook investigasi tidak ditemukan." });
    res.json({ success: true, data: playbook });
  } catch (error) {
    next(error);
  }
}

export async function createInvestigationPlaybookHandler(req, res, next) {
  try {
    const playbook = await createInvestigationPlaybook(playbookSchema.parse(req.body), req.helpdeskUser);
    res.status(201).json({ success: true, data: playbook });
  } catch (error) {
    next(error);
  }
}

export async function updateInvestigationPlaybookHandler(req, res, next) {
  try {
    const playbook = await updateInvestigationPlaybook(playbookIdParam(req), playbookSchema.parse(req.body), req.helpdeskUser);
    if (!playbook) return res.status(404).json({ success: false, message: "Playbook investigasi tidak ditemukan." });
    res.json({ success: true, data: playbook });
  } catch (error) {
    next(error);
  }
}

export async function publishInvestigationPlaybookHandler(req, res, next) {
  try {
    const playbook = await publishInvestigationPlaybook(playbookIdParam(req), req.helpdeskUser);
    if (!playbook) return res.status(404).json({ success: false, message: "Playbook investigasi tidak ditemukan." });
    res.json({ success: true, data: playbook });
  } catch (error) {
    next(error);
  }
}

export async function archiveInvestigationPlaybookHandler(req, res, next) {
  try {
    const playbook = await archiveInvestigationPlaybook(playbookIdParam(req), req.helpdeskUser);
    if (!playbook) return res.status(404).json({ success: false, message: "Playbook investigasi tidak ditemukan." });
    res.json({ success: true, data: playbook });
  } catch (error) {
    next(error);
  }
}
