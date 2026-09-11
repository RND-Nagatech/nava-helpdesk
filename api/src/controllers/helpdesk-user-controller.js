import { z } from "zod";
import {
  createHelpdeskUser,
  deleteHelpdeskUser,
  getHelpdeskUser,
  listHelpdeskUsers,
  setHelpdeskUserActive,
  updateHelpdeskUser,
} from "../services/helpdesk-user-service.js";

const createSchema = z.object({
  helpdesk_id: z.string().trim().min(2).max(100),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
  role: z.enum(["admin", "helpdesk"]),
  tier: z.string().trim().max(100).optional(),
  is_active: z.boolean().optional(),
});

const updateSchema = z.object({
  helpdesk_id: z.string().trim().min(2).max(100).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(1).max(200).optional(),
  role: z.enum(["admin", "helpdesk"]).optional(),
  tier: z.string().trim().max(100).optional(),
  is_active: z.boolean().optional(),
}).refine((input) => Object.keys(input).length > 0, { message: "Minimal satu field harus diubah." });

export async function listHelpdeskUsersHandler(req, res, next) {
  try {
    res.json({ success: true, data: await listHelpdeskUsers(req.query.search) });
  } catch (error) {
    next(error);
  }
}

export async function getHelpdeskUserHandler(req, res, next) {
  try {
    const user = await getHelpdeskUser(req.params.helpdeskId);
    if (!user) return res.status(404).json({ success: false, message: "User helpdesk tidak ditemukan." });
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

export async function createHelpdeskUserHandler(req, res, next) {
  try {
    const user = await createHelpdeskUser(createSchema.parse(req.body));
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

export async function updateHelpdeskUserHandler(req, res, next) {
  try {
    const user = await updateHelpdeskUser(req.params.helpdeskId, updateSchema.parse(req.body), {
      currentHelpdeskId: req.helpdeskUser.helpdesk_id,
    });
    if (!user) return res.status(404).json({ success: false, message: "User helpdesk tidak ditemukan." });
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

export async function updateHelpdeskUserStatusHandler(req, res, next) {
  try {
    const input = z.object({ is_active: z.boolean() }).parse(req.body);
    const user = await setHelpdeskUserActive(req.params.helpdeskId, input.is_active, {
      currentHelpdeskId: req.helpdeskUser.helpdesk_id,
    });
    if (!user) return res.status(404).json({ success: false, message: "User helpdesk tidak ditemukan." });
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

export async function deleteHelpdeskUserHandler(req, res, next) {
  try {
    const deleted = await deleteHelpdeskUser(req.params.helpdeskId, {
      currentHelpdeskId: req.helpdeskUser.helpdesk_id,
    });
    if (!deleted) return res.status(404).json({ success: false, message: "User helpdesk tidak ditemukan." });
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    next(error);
  }
}
