import type { HelpdeskUser } from "../types";

const TOKEN_KEY = "nava_helpdesk_token";
const USER_KEY = "nava_helpdesk_user";
const REMEMBER_ID_KEY = "nava_helpdesk_remembered_id";
const LEGACY_REMEMBER_PASSWORD_KEY = "nava_helpdesk_remembered_password";

export function getHelpdeskToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
}

export function getStoredHelpdeskUser(): HelpdeskUser | null {
  const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HelpdeskUser;
  } catch {
    return null;
  }
}

export function getRememberedHelpdeskId() {
  return localStorage.getItem(REMEMBER_ID_KEY) || "";
}

export function saveHelpdeskSession(token: string, user: HelpdeskUser, remember = false) {
  localStorage.removeItem(LEGACY_REMEMBER_PASSWORD_KEY);
  const persistentStorage = remember ? localStorage : sessionStorage;
  const temporaryStorage = remember ? sessionStorage : localStorage;
  temporaryStorage.removeItem(TOKEN_KEY);
  temporaryStorage.removeItem(USER_KEY);
  persistentStorage.setItem(TOKEN_KEY, token);
  persistentStorage.setItem(USER_KEY, JSON.stringify(user));
  if (remember) {
    localStorage.setItem(REMEMBER_ID_KEY, user.helpdesk_id);
  } else {
    localStorage.removeItem(REMEMBER_ID_KEY);
  }
}

export function clearHelpdeskSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  localStorage.removeItem(LEGACY_REMEMBER_PASSWORD_KEY);
}
