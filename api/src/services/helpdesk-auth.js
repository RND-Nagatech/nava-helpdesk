import crypto from "node:crypto";
import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";

const PASSWORD_ALGORITHM = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 210000;
const PASSWORD_KEY_LENGTH = 32;
const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const DEFAULT_HELPDESK_ID = "hd1";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function parseBase64urlJson(input) {
  return JSON.parse(Buffer.from(input, "base64url").toString("utf8"));
}

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function generateHelpdeskId() {
  return `HD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, "sha256")
    .toString("hex");
  return `${PASSWORD_ALGORITHM}$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [algorithm, iterations, salt, expectedHash] = String(storedHash || "").split("$");
  if (algorithm !== PASSWORD_ALGORITHM || !iterations || !salt || !expectedHash) return false;

  const actualHash = crypto
    .pbkdf2Sync(String(password), salt, Number(iterations), PASSWORD_KEY_LENGTH, "sha256")
    .toString("hex");
  return timingSafeStringEqual(actualHash, expectedHash);
}

export function serializeHelpdeskUser(user) {
  if (!user) return null;
  return {
    helpdesk_id: user.helpdesk_id,
    name: user.name,
    role: user.role,
    tier: user.tier,
    is_active: Boolean(user.is_active),
    created_at: user.created_at || null,
  };
}

export function signHelpdeskToken(user, { secret = env.helpdeskAuthSecret, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) throw new Error("HELPDESK_AUTH_SECRET belum diisi.");
  const payload = {
    helpdesk_id: user.helpdesk_id,
    name: user.name,
    role: user.role,
    tier: user.tier,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyHelpdeskToken(token, { secret = env.helpdeskAuthSecret, now = Math.floor(Date.now() / 1000) } = {}) {
  try {
    if (!secret) throw new Error("HELPDESK_AUTH_SECRET belum diisi.");
    const [encodedPayload, signature] = String(token || "").split(".");
    if (!encodedPayload || !signature) return null;

    const expectedSignature = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
    if (!timingSafeStringEqual(signature, expectedSignature)) return null;

    const payload = parseBase64urlJson(encodedPayload);
    if (!payload?.helpdesk_id || Number(payload.exp || 0) <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function findHelpdeskUserById(helpdeskId) {
  const db = await getDb();
  return db.collection(env.helpdeskUserCollection).findOne({ helpdesk_id: String(helpdeskId || "").trim() });
}

export async function loginHelpdeskUser({ helpdeskId, password }) {
  const user = await findHelpdeskUserById(helpdeskId);
  if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) return null;
  return { user: serializeHelpdeskUser(user), token: signHelpdeskToken(user) };
}

export async function createHelpdeskUserDocument({
  helpdeskId = generateHelpdeskId(),
  name,
  password,
  role = "helpdesk",
  tier = "Tier 1 Helpdesk",
  isActive = true,
}) {
  return {
    helpdesk_id: String(helpdeskId || generateHelpdeskId()).trim(),
    name: String(name || "").trim(),
    password_hash: hashPassword(password),
    role,
    tier,
    is_active: Boolean(isActive),
    created_at: new Date(),
  };
}

export async function seedDefaultHelpdeskUser() {
  if (!env.helpdeskDefaultPassword) {
    throw new Error("HELPDESK_DEFAULT_PASSWORD belum diisi.");
  }

  const db = await getDb();
  const collection = db.collection(env.helpdeskUserCollection);
  const existing = await collection.findOne({ helpdesk_id: DEFAULT_HELPDESK_ID });
  if (existing) return { created: false, user: serializeHelpdeskUser(existing) };

  const doc = await createHelpdeskUserDocument({
    helpdeskId: DEFAULT_HELPDESK_ID,
    name: "Admin NAVA",
    password: env.helpdeskDefaultPassword,
    role: "admin",
    tier: "Administrator",
  });
  await collection.insertOne(doc);
  return { created: true, user: serializeHelpdeskUser(doc) };
}
