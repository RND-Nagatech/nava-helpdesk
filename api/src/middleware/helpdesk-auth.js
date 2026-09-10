import { verifyHelpdeskToken } from "../services/helpdesk-auth.js";

export async function requireHelpdeskAuth(req, res, next) {
  try {
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const payload = token ? verifyHelpdeskToken(token) : null;
    if (!payload) {
      return res.status(401).json({ success: false, message: "Silakan login helpdesk terlebih dahulu." });
    }

    req.helpdeskUser = {
      helpdesk_id: payload.helpdesk_id,
      name: payload.name,
      role: payload.role,
      tier: payload.tier,
      is_active: true,
    };
    next();
  } catch (error) {
    next(error);
  }
}
