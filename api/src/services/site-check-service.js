import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";

const GOLDSTORE_SUFFIX = ".goldstore.id";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CACHE_TTL_MS = 60000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const RESERVED_SLUGS = new Set(["localhost", "local", "127", "0", "internal"]);

const cache = new Map();

function timeoutMs() {
  const value = Number(env.siteCheckTimeoutMs || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1000), 20000) : DEFAULT_TIMEOUT_MS;
}

function cacheTtlMs() {
  const value = Number(env.siteCheckCacheTtlMs || DEFAULT_CACHE_TTL_MS);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 300000) : DEFAULT_CACHE_TTL_MS;
}

function errorWithCode(message, code = "SITE_CHECK_FAILED", statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function isAllowedHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!normalized.endsWith(GOLDSTORE_SUFFIX)) return false;
  const label = normalized.slice(0, -GOLDSTORE_SUFFIX.length);
  return Boolean(label) && label.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part));
}

export function normalizeGoldstoreDomain(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) throw errorWithCode("Domain toko wajib diisi.", "SITE_DOMAIN_INVALID");
  if (/\s|[@#?]/.test(raw)) throw errorWithCode("Domain toko belum sesuai. Gunakan contoh: italy atau italy.goldstore.id.", "SITE_DOMAIN_INVALID");

  const bareSlug = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(raw);
  if (bareSlug && RESERVED_SLUGS.has(raw)) {
    throw errorWithCode("Domain toko belum sesuai. Gunakan subdomain Goldstore yang aktif.", "SITE_DOMAIN_INVALID");
  }
  const candidate = raw.includes("://")
    ? raw
    : `https://${bareSlug ? `${raw}${GOLDSTORE_SUFFIX}` : raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw errorWithCode("Domain toko belum sesuai. Gunakan contoh: italy atau italy.goldstore.id.", "SITE_DOMAIN_INVALID");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !isAllowedHostname(url.hostname)) {
    throw errorWithCode("Domain hanya boleh berupa subdomain Goldstore, misalnya italy atau italy.goldstore.id.", "SITE_DOMAIN_INVALID");
  }

  return {
    hostname: url.hostname,
    origin: `https://${url.hostname}`,
  };
}

async function readLimitedText(response, maxBytes = MAX_RESPONSE_BYTES) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw errorWithCode("Response website terlalu besar untuk diperiksa.", "SITE_RESPONSE_TOO_LARGE", 502);
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw errorWithCode("Response website terlalu besar untuk diperiksa.", "SITE_RESPONSE_TOO_LARGE", 502);
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw errorWithCode("Response website terlalu besar untuk diperiksa.", "SITE_RESPONSE_TOO_LARGE", 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function fetchAllowed(url, { method = "GET", accept = "*/*", readBody = true, headers = {}, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  let current = new URL(url);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (current.protocol !== "https:" || !isAllowedHostname(current.hostname)) {
      throw errorWithCode("Website mengarahkan ke domain yang tidak diizinkan.", "SITE_REDIRECT_BLOCKED", 502);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());
    try {
      const response = await fetch(current, {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept,
          "user-agent": "NAVA-Website-Checker/1.0",
          ...headers,
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect >= MAX_REDIRECTS) throw errorWithCode("Website terlalu banyak mengarahkan ulang.", "SITE_REDIRECT_BLOCKED", 502);
        current = new URL(location, current);
        continue;
      }

      return {
        response,
        url: current.toString(),
        body: readBody ? await readLimitedText(response, maxBytes) : "",
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw errorWithCode("Pengecekan website terlalu lama.", "SITE_CHECK_TIMEOUT", 504);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw errorWithCode("Website tidak dapat diperiksa.", "SITE_CHECK_FAILED", 502);
}

function scriptSources(html, origin) {
  const sources = [];
  const pattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const url = new URL(match[1], origin);
      if (url.origin === origin && url.protocol === "https:") sources.push(url.toString());
    } catch {
      // Abaikan src yang tidak valid.
    }
  }
  return [...new Set(sources)].slice(0, 8);
}

function extractFrontendMetadata(script) {
  const source = String(script || "");
  const match = source.match(
    /buildMajor\s*:\s*["']?(\d+)["']?\s*,\s*buildMinor\s*:\s*["']?(\d+)["']?\s*,\s*buildRevision\s*:\s*["']?(\d+)["']?\s*,\s*buildFe\s*:\s*["']?(\d+)["']?\s*,[\s\S]{0,240}?branchName\s*:\s*["']([^"']*)["']/i,
  );
  if (match) {
    const version = `${match[1]}.${match[2]}.${match[3]}.${match[4]}`;
    return {
      version,
      base_version: `${match[1]}.${match[2]}.${match[3]}`,
      branch: String(match[5] || "").trim(),
    };
  }

  // Some NAGAGOLD deployments expose only minified version constants in the
  // production bundle, for example: yJ=3,_J=8,vJ=5,kJ=61,xJ="NEW RELEASE".
  // The release marker keeps this fallback specific enough not to mistake
  // unrelated numeric constants for a frontend version.
  const minifiedMatch = source.match(
    /[A-Za-z_$][\w$]*\s*=\s*(\d+)\s*,\s*[A-Za-z_$][\w$]*\s*=\s*(\d+)\s*,\s*[A-Za-z_$][\w$]*\s*=\s*(\d+)\s*,\s*[A-Za-z_$][\w$]*\s*=\s*(\d+)\s*,\s*[A-Za-z_$][\w$]*\s*=\s*["']NEW RELEASE["']/i,
  );
  if (!minifiedMatch) return null;

  const version = `${minifiedMatch[1]}.${minifiedMatch[2]}.${minifiedMatch[3]}.${minifiedMatch[4]}`;
  return {
    version,
    base_version: `${minifiedMatch[1]}.${minifiedMatch[2]}.${minifiedMatch[3]}`,
    branch: "",
  };
}

async function checkFrontend(origin) {
  const page = await fetchAllowed(origin, { accept: "text/html" });
  const online = page.response.status >= 200 && page.response.status < 300;
  if (!online) {
    return { status: "offline", http_status: page.response.status, version: null, base_version: null, branch: "", url: page.url };
  }

  const sources = scriptSources(page.body, origin);
  for (const source of sources) {
    try {
      const asset = await fetchAllowed(source, { accept: "application/javascript,text/javascript", maxBytes: MAX_ASSET_BYTES });
      const metadata = extractFrontendMetadata(asset.body);
      if (metadata) return { status: "online", http_status: page.response.status, ...metadata, url: page.url };
    } catch {
      // Frontend tetap online walaupun satu asset gagal dibaca.
    }
  }

  return { status: "online", http_status: page.response.status, version: null, base_version: null, branch: "", url: page.url };
}

function backendRequestHeaders(timestamp = new Date().toISOString()) {
  const headers = {};
  const token = String(env.siteCheckBackendToken || "");
  const apiKey = String(env.siteCheckApiKey || "");
  const signingSecret = String(env.siteCheckSigningSecret || "");

  if (token) headers["x-auth-token"] = token;
  if (!apiKey || !signingSecret) return headers;

  headers["api-key"] = apiKey;
  headers.timestamp = timestamp;
  headers.signature = createHash("sha256")
    .update(`${apiKey}${signingSecret}${token}${timestamp}`)
    .digest("hex");
  return headers;
}

async function checkBackend(origin) {
  const endpoint = `${origin}/api/v1/system/get`;
  try {
    const result = await fetchAllowed(endpoint, {
      accept: "application/json",
      headers: backendRequestHeaders(),
    });
    const online = result.response.status >= 200 && result.response.status < 300;
    if (!online) {
      const status = [401, 403].includes(result.response.status) ? "unauthorized" : "offline";
      return { status, http_status: result.response.status, version: null, base_version: null, branch: "", url: result.url };
    }
    let payload;
    try {
      payload = JSON.parse(result.body);
    } catch {
      return { status: "offline", http_status: result.response.status, version: null, base_version: null, branch: "", url: result.url, error_code: "BACKEND_INVALID_JSON" };
    }
    const version = typeof payload?.version === "string" ? payload.version.trim() : "";
    const baseVersion = version.split(".").slice(0, 3).join(".") || null;
    return {
      status: "online",
      http_status: result.response.status,
      version: version || null,
      base_version: baseVersion,
      branch: String(payload?.branch_name || "").trim(),
      store: payload?.["0"] || null,
      url: result.url,
    };
  } catch (error) {
    return {
      status: "offline",
      http_status: error?.statusCode || null,
      version: null,
      base_version: null,
      branch: "",
      url: endpoint,
      error_code: error?.code || "BACKEND_UNREACHABLE",
    };
  }
}

function compatibility(frontend, backend) {
  if (!frontend.base_version || !backend.base_version) return "unknown";
  return frontend.base_version === backend.base_version ? "match" : "mismatch";
}

function publicResult(normalized, frontend, backend) {
  return {
    domain: normalized.hostname,
    origin: normalized.origin,
    frontend,
    backend,
    compatibility: compatibility(frontend, backend),
    checked_at: new Date().toISOString(),
  };
}

export async function checkCustomerSite(value, { force = false } = {}) {
  const normalized = normalizeGoldstoreDomain(value);
  const key = normalized.hostname;
  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;

  const [frontend, backend] = await Promise.all([
    checkFrontend(normalized.origin).catch((error) => ({ status: "offline", version: null, base_version: null, branch: "", error_code: error?.code || "FRONTEND_UNREACHABLE" })),
    checkBackend(normalized.origin),
  ]);
  const valueResult = publicResult(normalized, frontend, backend);
  cache.set(key, { value: valueResult, expiresAt: Date.now() + cacheTtlMs() });
  return valueResult;
}

export function siteScopeFromCheck(siteCheck) {
  if (!siteCheck?.domain) return null;
  return {
    domain: siteCheck.domain,
    frontendVersion: siteCheck.frontend?.base_version || null,
    backendVersion: siteCheck.backend?.base_version || null,
    frontendBranch: siteCheck.frontend?.branch || "",
    backendBranch: siteCheck.backend?.branch || "",
  };
}

export function siteScopeMatches(siteScope, siteCheck) {
  if (!siteScope?.domain) return true;
  if (!siteCheck?.domain || siteScope.domain !== siteCheck.domain) return false;
  if (siteScope.frontendVersion && siteScope.frontendVersion !== siteCheck.frontend?.base_version) return false;
  if (siteScope.backendVersion && siteScope.backendVersion !== siteCheck.backend?.base_version) return false;
  if (siteScope.frontendBranch && siteScope.frontendBranch !== siteCheck.frontend?.branch) return false;
  if (siteScope.backendBranch && siteScope.backendBranch !== siteCheck.backend?.branch) return false;
  return true;
}

export const siteCheckInputSchema = z.object({
  domain: z.string().trim().min(1).max(200),
  force: z.boolean().optional(),
});

export const __siteCheckInternals = {
  extractFrontendMetadata,
  compatibility,
  isAllowedHostname,
  scriptSources,
  backendRequestHeaders,
};
