import { z } from "zod";
import {
  closeTrainingSession,
  createTrainingSession,
  generateTrainingKnowledge,
  getTrainingSession,
  listTrainingSessions,
  markTrainingMessage,
  saveTrainingDraft,
  sendTrainingCorrection,
  sendTrainingMessage,
} from "../services/chat-training-service.js";

const trainingIdSchema = z.string().trim().min(8).max(200);
const messageSchema = z.object({
  question: z.string().trim().min(2).max(4000),
});
const correctionSchema = z.object({
  correction: z.string().trim().min(2).max(4000),
  message_id: z.string().trim().max(200).optional(),
});
const feedbackSchema = z.object({
  message_id: z.string().trim().min(1).max(200),
  verdict: z.enum(["correct", "needs_correction"]),
});
const sessionSchema = z.object({
  title: z.string().trim().max(200).optional(),
});
const saveDraftSchema = z.object({
  draft: z.object({
    title: z.string().trim().max(300),
    category: z.string().trim().max(120).optional(),
    product: z.string().trim().max(120).optional(),
    clientScope: z.array(z.string().trim().max(100)).max(20).optional(),
    symptoms: z.array(z.string().trim().max(400)).max(30).optional(),
    tags: z.array(z.string().trim().max(80)).max(50).optional(),
    userResponseTemplate: z.string().trim().max(4000),
    troubleshootingSteps: z.array(z.object({
      order: z.number().int().min(1).max(100).optional(),
      title: z.string().trim().max(120).optional(),
      instruction: z.string().trim().max(2000),
      expectedResult: z.string().trim().max(1000).optional(),
    })).max(30),
    escalationRules: z.array(z.string().trim().max(500)).max(20).optional(),
    internalNotes: z.string().trim().max(4000).optional(),
  }),
  action: z.enum(["new", "update_existing"]).optional(),
  existing_article_id: z.string().trim().max(200).optional(),
});

function trainingIdParam(req) {
  return trainingIdSchema.parse(req.params.trainingId);
}

export async function createTrainingSessionHandler(req, res, next) {
  try {
    const input = sessionSchema.parse(req.body || {});
    const session = await createTrainingSession(req.helpdeskUser, input.title);
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}

export async function getTrainingSessionHandler(req, res, next) {
  try {
    const session = await getTrainingSession(trainingIdParam(req), req.helpdeskUser);
    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}

export async function listTrainingSessionsHandler(req, res, next) {
  try {
    const sessions = await listTrainingSessions(req.helpdeskUser);
    res.json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
}

export async function sendTrainingMessageHandler(req, res, next) {
  try {
    const input = messageSchema.parse(req.body);
    const result = await sendTrainingMessage({
      trainingId: trainingIdParam(req),
      helpdeskUser: req.helpdeskUser,
      question: input.question,
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function sendTrainingCorrectionHandler(req, res, next) {
  try {
    const input = correctionSchema.parse(req.body);
    const result = await sendTrainingCorrection({
      trainingId: trainingIdParam(req),
      helpdeskUser: req.helpdeskUser,
      correction: input.correction,
      messageId: input.message_id || "",
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function trainingFeedbackHandler(req, res, next) {
  try {
    const input = feedbackSchema.parse(req.body);
    const message = await markTrainingMessage({
      trainingId: trainingIdParam(req),
      helpdeskUser: req.helpdeskUser,
      messageId: input.message_id,
      verdict: input.verdict,
    });
    res.json({ success: true, data: message });
  } catch (error) {
    next(error);
  }
}

export async function generateTrainingKnowledgeHandler(req, res, next) {
  try {
    const result = await generateTrainingKnowledge({
      trainingId: trainingIdParam(req),
      helpdeskUser: req.helpdeskUser,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function saveTrainingDraftHandler(req, res, next) {
  try {
    const input = saveDraftSchema.parse(req.body);
    const article = await saveTrainingDraft({
      trainingId: trainingIdParam(req),
      helpdeskUser: req.helpdeskUser,
      draft: input.draft,
      action: input.action || "new",
      existingArticleId: input.existing_article_id || "",
    });
    res.status(201).json({ success: true, data: article });
  } catch (error) {
    next(error);
  }
}

export async function closeTrainingSessionHandler(req, res, next) {
  try {
    const session = await closeTrainingSession({
      trainingId: trainingIdParam(req),
      helpdeskUser: req.helpdeskUser,
    });
    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}
