import { z } from "zod";
import {
  archiveKnowledgeArticle,
  createKnowledgeArticle,
  getKnowledgeArticle,
  listKnowledgeCategories,
  listKnowledgeArticles,
  publishKnowledgeArticle,
  updateKnowledgeArticle,
} from "../services/knowledge-article-service.js";

const stepSchema = z.object({
  order: z.number().int().min(1).max(100).optional(),
  title: z.string().trim().max(120).optional(),
  instruction: z.string().trim().max(2000),
  expectedResult: z.string().trim().max(1000).optional(),
});

const articleSchema = z.object({
  title: z.string().trim().max(300).optional(),
  category: z.string().trim().max(120).optional(),
  product: z.string().trim().max(120).optional(),
  clientScope: z.array(z.string().trim().max(100)).max(20).optional(),
  symptoms: z.array(z.string().trim().max(400)).max(30).optional(),
  tags: z.array(z.string().trim().max(80)).max(50).optional(),
  userResponseTemplate: z.string().trim().max(4000).optional(),
  troubleshootingSteps: z.array(stepSchema).max(30).optional(),
  escalationRules: z.array(z.string().trim().max(500)).max(20).optional(),
  internalNotes: z.string().trim().max(4000).optional(),
});

function articleIdParam(req) {
  return z.string().trim().min(3).max(200).parse(req.params.articleId);
}

export async function listKnowledgeArticlesHandler(req, res, next) {
  try {
    const articles = await listKnowledgeArticles({
      search: req.query.search ? String(req.query.search) : "",
      status: req.query.status ? String(req.query.status) : "",
      category: req.query.category ? String(req.query.category) : "",
      limit: req.query.limit ? Number(req.query.limit) : 80,
    });
    res.json({ success: true, data: articles });
  } catch (error) {
    next(error);
  }
}

export async function listKnowledgeCategoriesHandler(req, res, next) {
  try {
    const categories = await listKnowledgeCategories();
    res.json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
}

export async function getKnowledgeArticleHandler(req, res, next) {
  try {
    const article = await getKnowledgeArticle(articleIdParam(req));
    if (!article) return res.status(404).json({ success: false, message: "Artikel tidak ditemukan." });
    res.json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
}

export async function createKnowledgeArticleHandler(req, res, next) {
  try {
    const input = articleSchema.parse(req.body);
    const article = await createKnowledgeArticle(input, req.helpdeskUser);
    res.status(201).json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
}

export async function updateKnowledgeArticleHandler(req, res, next) {
  try {
    const input = articleSchema.parse(req.body);
    const article = await updateKnowledgeArticle(
      articleIdParam(req),
      input,
      req.helpdeskUser,
      { status: req.query.as_draft === "true" ? "draft" : null }
    );
    if (!article) return res.status(404).json({ success: false, message: "Artikel tidak ditemukan." });
    res.json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
}

export async function publishKnowledgeArticleHandler(req, res, next) {
  try {
    const article = await publishKnowledgeArticle(articleIdParam(req), req.helpdeskUser);
    if (!article) return res.status(404).json({ success: false, message: "Artikel tidak ditemukan." });
    res.json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
}

export async function archiveKnowledgeArticleHandler(req, res, next) {
  try {
    const article = await archiveKnowledgeArticle(articleIdParam(req), req.helpdeskUser);
    if (!article) return res.status(404).json({ success: false, message: "Artikel tidak ditemukan." });
    res.json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
}
