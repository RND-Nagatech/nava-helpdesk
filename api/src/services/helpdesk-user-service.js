import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";
import { createHelpdeskUserDocument, hashPassword, serializeHelpdeskUser } from "./helpdesk-auth.js";

const ROLES = ["admin", "helpdesk"];

function userCollection(db) {
  return db.collection(env.helpdeskUserCollection);
}

function userQuery(helpdeskId) {
  return { helpdesk_id: String(helpdeskId || "").trim() };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicUser(user) {
  return serializeHelpdeskUser(user);
}

function validateInput(input, { partial = false } = {}) {
  const errors = [];
  if (!partial || input.helpdesk_id !== undefined) {
    if (!String(input.helpdesk_id || "").trim()) errors.push("Helpdesk ID wajib diisi.");
  }
  if (!partial || input.name !== undefined) {
    if (!String(input.name || "").trim()) errors.push("Nama wajib diisi.");
  }
  if (!partial || input.role !== undefined) {
    if (!ROLES.includes(input.role)) errors.push("Role harus admin atau helpdesk.");
  }
  if (!partial || input.password !== undefined) {
    if (!partial && String(input.password || "").length < 1) errors.push("Password wajib diisi.");
    if (partial && input.password !== undefined && String(input.password).length < 1) errors.push("Password wajib diisi.");
  }
  if (errors.length) {
    const error = new Error(errors.join(" "));
    error.statusCode = 400;
    error.code = "HELPDESK_USER_INVALID";
    throw error;
  }
}

export async function listHelpdeskUsers(search = "") {
  const db = await getDb();
  const query = String(search || "").trim();
  const filter = query
    ? {
        $or: [
          { helpdesk_id: { $regex: escapeRegex(query), $options: "i" } },
          { name: { $regex: escapeRegex(query), $options: "i" } },
          { role: { $regex: escapeRegex(query), $options: "i" } },
          { tier: { $regex: escapeRegex(query), $options: "i" } },
        ],
      }
    : {};
  const users = await userCollection(db).find(filter, { projection: { password_hash: 0 } }).sort({ name: 1, helpdesk_id: 1 }).toArray();
  return users.map(publicUser);
}

export async function getHelpdeskUser(helpdeskId) {
  const db = await getDb();
  const user = await userCollection(db).findOne(userQuery(helpdeskId), { projection: { password_hash: 0 } });
  return publicUser(user);
}

export async function createHelpdeskUser(input) {
  validateInput(input);
  const db = await getDb();
  const collection = userCollection(db);
  const helpdeskId = String(input.helpdesk_id).trim();
  const existing = await collection.findOne(userQuery(helpdeskId));
  if (existing) {
    const error = new Error("Helpdesk ID sudah digunakan.");
    error.statusCode = 409;
    error.code = "HELPDESK_USER_EXISTS";
    throw error;
  }

  const document = await createHelpdeskUserDocument({
    helpdeskId,
    name: input.name,
    password: input.password,
    role: input.role,
    tier: input.tier || (input.role === "admin" ? "Administrator" : "Tier 1 Helpdesk"),
    isActive: input.is_active !== false,
  });
  try {
    await collection.insertOne(document);
  } catch (error) {
    if (error?.code === 11000) {
      error.statusCode = 409;
      error.message = "Helpdesk ID sudah digunakan.";
    }
    throw error;
  }
  return publicUser(document);
}

export async function updateHelpdeskUser(helpdeskId, input, { currentHelpdeskId } = {}) {
  validateInput(input, { partial: true });
  const id = String(helpdeskId || "").trim();
  if (currentHelpdeskId && id === currentHelpdeskId && input.is_active === false) {
    const error = new Error("Akun yang sedang digunakan tidak dapat dinonaktifkan.");
    error.statusCode = 400;
    error.code = "HELPDESK_USER_SELF_ACTION";
    throw error;
  }

  const db = await getDb();
  const collection = userCollection(db);
  const set = {};
  if (input.helpdesk_id !== undefined) set.helpdesk_id = String(input.helpdesk_id).trim();
  if (input.name !== undefined) set.name = String(input.name).trim();
  if (input.role !== undefined) set.role = input.role;
  if (input.tier !== undefined) set.tier = String(input.tier || "").trim();
  if (input.is_active !== undefined) set.is_active = Boolean(input.is_active);
  if (input.password) set.password_hash = hashPassword(input.password);
  if (!Object.keys(set).length) return getHelpdeskUser(id);

  if (set.role && set.role !== "admin") {
    const current = await collection.findOne(userQuery(id));
    if (current?.role === "admin" && current.is_active && (await collection.countDocuments({ role: "admin", is_active: true })) <= 1) {
      const error = new Error("Minimal harus ada satu admin aktif.");
      error.statusCode = 400;
      error.code = "HELPDESK_USER_LAST_ADMIN";
      throw error;
    }
  }

  if (set.is_active === false) {
    const current = await collection.findOne(userQuery(id));
    if (current?.role === "admin" && current.is_active && (await collection.countDocuments({ role: "admin", is_active: true })) <= 1) {
      const error = new Error("Minimal harus ada satu admin aktif.");
      error.statusCode = 400;
      error.code = "HELPDESK_USER_LAST_ADMIN";
      throw error;
    }
  }

  try {
    const result = await collection.updateOne(userQuery(id), { $set: set });
    if (!result.matchedCount) return null;
  } catch (error) {
    if (error?.code === 11000) {
      error.statusCode = 409;
      error.message = "Helpdesk ID sudah digunakan.";
    }
    throw error;
  }
  return getHelpdeskUser(set.helpdesk_id || id);
}

export async function setHelpdeskUserActive(helpdeskId, isActive, options = {}) {
  return updateHelpdeskUser(helpdeskId, { is_active: Boolean(isActive) }, options);
}

export async function deleteHelpdeskUser(helpdeskId, { currentHelpdeskId } = {}) {
  const id = String(helpdeskId || "").trim();
  if (currentHelpdeskId && id === currentHelpdeskId) {
    const error = new Error("Akun yang sedang digunakan tidak dapat dihapus.");
    error.statusCode = 400;
    error.code = "HELPDESK_USER_SELF_ACTION";
    throw error;
  }
  const db = await getDb();
  const collection = userCollection(db);
  const current = await collection.findOne(userQuery(id));
  if (!current) return false;
  if (current.role === "admin" && current.is_active && (await collection.countDocuments({ role: "admin", is_active: true })) <= 1) {
    const error = new Error("Minimal harus ada satu admin aktif.");
    error.statusCode = 400;
    error.code = "HELPDESK_USER_LAST_ADMIN";
    throw error;
  }
  const result = await collection.deleteOne(userQuery(id));
  return Boolean(result.deletedCount);
}
