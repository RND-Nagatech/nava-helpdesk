import { env } from "../config/env.js";

const SUPPORT_AREA_CRITERIA = {
  account_access: "login, password, user access, website access, akun tidak bisa dibuka",
  inventory_weight: "stock, barang, berat barang, timbangan, timbang, berat tidak muncul",
  sales_transaction: "penjualan, pembelian, transaksi, faktur, nota, struk transaksi",
  reports: "laporan, report, summary, detail, data laporan tidak muncul",
  printing: "print, cetak, printer, popup, struk atau dokumen hasil cetak tidak keluar",
  other: "hal lain atau pertanyaan yang belum jelas masuk area mana",
};

function clean(value, maxChars = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function normalizeChoice(value) {
  const choice = clean(value, 80).toLowerCase().replace(/[ -]+/g, "_");
  return Object.hasOwn(SUPPORT_AREA_CRITERIA, choice) ? choice : null;
}

function normalizeNoul(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value >= 0.5;
  const normalized = clean(value, 40).toLowerCase();
  if (["yes", "true", "urgent", "ya", "iya"].includes(normalized)) return true;
  if (["no", "false", "not_urgent", "tidak", "tidak_urgent"].includes(normalized)) return false;
  return null;
}

export function parseLayaDecision(response) {
  const answers = response?.answers || {};
  const supportArea = answers.support_area || {};
  const urgent = answers.is_urgent || {};
  const area = normalizeChoice(supportArea.choice);
  const isUrgent = normalizeNoul(urgent.noul);

  if (!area && isUrgent === null) return null;

  return {
    enabled: true,
    source: "laya",
    area,
    urgent: isUrgent,
    model: clean(response?.model || env.layaModel, 80),
  };
}

function withTimeout(operation, timeoutMs = env.layaTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
  return Promise.resolve()
    .then(() => operation(controller.signal))
    .finally(() => clearTimeout(timer));
}

function requestBody({ question, customerDomain = "" }) {
  return {
    state: {
      body: clean(question, 4000),
      ...(customerDomain ? { customer_domain: clean(customerDomain, 200) } : {}),
    },
    model: env.layaModel,
    questions: {
      support_area: {
        type: "choice",
        instructions: "Which helpdesk area best matches this customer request?",
        criteria: SUPPORT_AREA_CRITERIA,
      },
      is_urgent: {
        type: "noul",
        instructions: "Does the message clearly indicate an urgent outage, blocked operation, or high-severity business impact?",
      },
    },
  };
}

export async function decideLaya({ question, customerDomain = "" } = {}) {
  if (!env.layaEnabled || !env.layaUrl || !question) {
    return { enabled: false, source: "disabled", area: null, urgent: null };
  }

  const baseUrl = String(env.layaUrl).replace(/\/+$/, "");
  try {
    const response = await withTimeout((signal) => fetch(`${baseUrl}/v1/systemone`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(env.layaApiKey ? { Authorization: `Bearer ${env.layaApiKey}` } : {}),
      },
      body: JSON.stringify(requestBody({ question, customerDomain })),
    }));

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const decision = parseLayaDecision(await response.json());
    if (!decision) throw new Error("response tidak berisi decision yang dikenali");
    return decision;
  } catch (error) {
    console.warn(`Laya decision warning: ${error?.message || error}`);
    return {
      enabled: true,
      source: "laya_unavailable",
      area: null,
      urgent: null,
    };
  }
}

export const __layaInternals = {
  SUPPORT_AREA_CRITERIA,
  clean,
  normalizeChoice,
  normalizeNoul,
  requestBody,
  withTimeout,
};
