const SESSION_KEY = "nava_session_id";
const CUSTOMER_KEY = "nava_customer_id";
const PROFILE_KEY = "nava_customer_profile";

function randomId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function getSessionId() {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const next = randomId("session");
  localStorage.setItem(SESSION_KEY, next);
  return next;
}

export function createNewSessionId() {
  const next = randomId("session");
  localStorage.setItem(SESSION_KEY, next);
  return next;
}

export function getCustomerId() {
  const existing = localStorage.getItem(CUSTOMER_KEY);
  if (existing) return existing;
  const next = randomId("customer");
  localStorage.setItem(CUSTOMER_KEY, next);
  return next;
}

export type CustomerProfile = {
  name: string;
  domain: string;
};

export function normalizeCustomerDomain(value: string) {
  let raw = value.trim().toLowerCase();
  if (!raw) return "";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Biarkan nilai asli jika input mengandung escape yang tidak valid.
  }
  raw = raw.replace(/\s+/g, " ").trim();
  if (raw.includes(" ") && !/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(raw)) return `${raw}.goldstore.id`;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return decodeURIComponent(url.hostname).replace(/^www\./, "");
  } catch {
    return raw.replace(/[^a-z0-9.\- ]/g, "").replace(/\s+/g, " ").trim();
  }
}

export function isGoldstoreDomain(value: string) {
  const normalized = normalizeCustomerDomain(value);
  if (["localhost.goldstore.id", "local.goldstore.id", "127.goldstore.id", "0.goldstore.id", "internal.goldstore.id"].includes(normalized)) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.goldstore\.id$/i.test(normalized);
}

export function loadCustomerProfile(): CustomerProfile | null {
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null") as CustomerProfile | null;
    if (!stored?.name || !stored?.domain) return null;
    return { name: stored.name, domain: normalizeCustomerDomain(stored.domain) };
  } catch {
    localStorage.removeItem(PROFILE_KEY);
    return null;
  }
}

export function saveCustomerProfile(profile: CustomerProfile) {
  const next = { name: profile.name.trim(), domain: normalizeCustomerDomain(profile.domain) };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  return next;
}
