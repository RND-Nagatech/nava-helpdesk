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
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/[^a-z0-9.-]/g, "");
  }
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
