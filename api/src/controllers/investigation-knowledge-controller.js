import { z } from "zod";
import {
  archiveInvestigationKnowledge,
  createInvestigationKnowledge,
  getInvestigationKnowledge,
  listInvestigationKnowledge,
  publishInvestigationKnowledge,
  updateInvestigationKnowledge,
} from "../services/investigation-knowledge-service.js";

const stepSchema = z.object({
  title: z.string().trim().max(120).optional(),
  instruction: z.string().trim().max(2000),
  expectedResult: z.string().trim().max(1000).optional(),
});

const knowledgeSchema = z.object({
  articleId: z.string().trim().max(200).optional(),
  title: z.string().trim().max(300).optional(),
  category: z.string().trim().max(120).optional(),
  symptoms: z.array(z.string().trim().max(400)).max(30).optional(),
  tags: z.array(z.string().trim().max(80)).max(50).optional(),
  troubleshootingSteps: z.array(stepSchema).max(30).optional(),
  userResponseTemplate: z.string().trim().max(4000).optional(),
  internalNotes: z.string().trim().max(8000).optional(),
  linked_operation_ids: z.array(z.string().trim().max(100)).max(30).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

function articleIdParam(req) {
  return z.string().trim().min(3).max(200).parse(req.params.articleId);
}

export async function listInvestigationKnowledgeHandler(req, res, next) {
  try {
    res.json({ success: true, data: await listInvestigationKnowledge({ status: req.query.status ? String(req.query.status) : "" }) });
  } catch (error) {
    next(error);
  }
}

export async function getInvestigationKnowledgeHandler(req, res, next) {
  try {
    const article = await getInvestigationKnowledge(articleIdParam(req));
    if (!article) return res.status(404).json({ success: false, message: "Knowledge investigasi tidak ditemukan." });
    res.json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
}

export async function createInvestigationKnowledgeHandler(req, res, next) {
  try {
    const article = await createInvestigationKnowledge(knowledgeSchema.parse(req.body), req.helpdeskUser);
    res.status(201).json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
}

export async function updateInvestigationKnowledgeHandler(req, res, next) {
  try {
    const article = await updateInvestigationKnowledge(articleIdParam(req), knowledgeSchema.parse(req.body), req.helpdeskUser);
    if (!article) return res.status(404).json({ success: false, message: "Knowledge investigasi tidak ditemukan." });
    res.json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
}

export async function publishInvestigationKnowledgeHandler(req, res, next) {
  try {
    const article = await publishInvestigationKnowledge(articleIdParam(req), req.helpdeskUser);
    if (!article) return res.status(404).json({ success: false, message: "Knowledge investigasi tidak ditemukan." });
    res.json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
}

export async function archiveInvestigationKnowledgeHandler(req, res, next) {
  try {
    const article = await archiveInvestigationKnowledge(articleIdParam(req), req.helpdeskUser);
    if (!article) return res.status(404).json({ success: false, message: "Knowledge investigasi tidak ditemukan." });
    res.json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
}
