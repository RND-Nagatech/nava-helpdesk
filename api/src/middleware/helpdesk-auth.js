import { findHelpdeskUserById, serializeHelpdeskUser, verifyHelpdeskToken } from "../services/helpdesk-auth.js";

export async function requireHelpdeskAuth(req, res, next) {
  try {
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const payload = token ? verifyHelpdeskToken(token) : null;
    if (!payload) {
      return res.status(401).json({ success: false, message: "Silakan login helpdesk terlebih dahulu." });
    }

    const currentUser = await findHelpdeskUserById(payload.helpdesk_id);
    if (!currentUser || !currentUser.is_active) {
      return res.status(401).json({ success: false, message: "Akun helpdesk tidak aktif atau sudah dihapus." });
    }
    req.helpdeskUser = serializeHelpdeskUser(currentUser);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireHelpdeskAdmin(req, res, next) {
  if (req.helpdeskUser?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Hanya admin yang dapat mengelola user helpdesk." });
  }
  next();
}
