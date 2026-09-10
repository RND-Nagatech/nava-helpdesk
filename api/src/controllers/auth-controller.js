import { z } from "zod";
import { loginHelpdeskUser } from "../services/helpdesk-auth.js";

const loginSchema = z.object({
  helpdesk_id: z.string().trim().min(2).max(200),
  password: z.string().min(1).max(200),
});

export async function helpdeskLoginHandler(req, res, next) {
  try {
    const input = loginSchema.parse(req.body);
    const session = await loginHelpdeskUser({ helpdeskId: input.helpdesk_id, password: input.password });
    if (!session) {
      return res.status(401).json({ success: false, message: "Helpdesk ID atau password salah." });
    }
    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}

export async function helpdeskMeHandler(req, res) {
  res.json({ success: true, data: req.helpdeskUser });
}

export async function helpdeskLogoutHandler(req, res) {
  res.json({ success: true, data: { logged_out: true } });
}
