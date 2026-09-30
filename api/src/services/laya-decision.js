import { env } from "../config/env.js";

const SUPPORT_AREA_CRITERIA = {
  account_access: "login, password, user access, website access, akun tidak bisa dibuka",
  inventory_weight: "stock, barang, berat barang, timbangan, timbang, berat tidak muncul",
  sales_transaction: "penjualan, pembelian, transaksi, faktur, nota, struk transaksi",
  reports: "laporan, report, summary, detail, data laporan tidak muncul",
  printing: "print, cetak, printer, popup, struk atau dokumen hasil cetak tidak keluar",
  other: "hal lain atau pertanyaan yang belum jelas masuk area mana",
};

const REPORT_TYPE_CRITERIA = {
  sales_report: "laporan penjualan, barang yang terjual, item terjual, hasil penjualan, performa penjualan, pertanyaan laporan mana untuk melihat barang yang sudah terjual, pertanyaan apakah laporan tertentu memuat data barang terjual",
  item_detail_report: "laporan barang detail untuk melihat atribut atau rincian barang yang terdaftar, bukan status barang yang terjual",
  inventory_report: "laporan stok, persediaan, saldo barang, jumlah barang yang tersedia",
  purchase_report: "laporan pembelian, barang yang dibeli, penerimaan pembelian, buyback atau pembelian dari customer",
  transaction_report: "laporan transaksi, riwayat transaksi, faktur, nota, struk, transaksi penjualan atau pembelian",
  summary_report: "laporan ringkasan, summary, rekap, total atau rangkuman data",
  other: "jenis laporan lain atau pertanyaan laporan yang belum cukup jelas",
};

function clean(value, maxChars = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function normalizeChoice(value, criteria = SUPPORT_AREA_CRITERIA) {
  const choice = clean(value, 80).toLowerCase().replace(/[ -]+/g, "_");
  return Object.hasOwn(criteria, choice) ? choice : null;
}

function normalizeReportType(value) {
  return normalizeChoice(value, REPORT_TYPE_CRITERIA);
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
  const reportType = answers.report_type || {};
  const reportSoldItems = answers.report_sold_items || {};
  const urgent = answers.is_urgent || {};
  const area = normalizeChoice(supportArea.choice);
  const asksSoldItems = normalizeNoul(reportSoldItems.noul);
  const type = asksSoldItems === true ? "sales_report" : normalizeReportType(reportType.choice);
  const isUrgent = normalizeNoul(urgent.noul);

  if (!area && isUrgent === null) return null;

  return {
    enabled: true,
    source: "laya",
    area,
    reportType: type,
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
      report_type: {
        type: "choice",
        instructions: "If this is a report question, choose the report containing the data the customer wants. Prioritize the requested data over a report name mentioned only as a comparison. For example, 'di laporan barang detail bisa lihat data barang yang terjual?' must be sales_report because the requested data is sold items; do not choose item_detail_report only because it was mentioned.",
        criteria: REPORT_TYPE_CRITERIA,
      },
      report_sold_items: {
        type: "noul",
        instructions: "Does the customer ask whether or where data about sold items is available? Treat a report name mentioned in the question as context, not as the requested data.",
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
    return { enabled: false, source: "disabled", area: null, reportType: null, urgent: null };
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
      reportType: null,
      urgent: null,
    };
  }
}

export const __layaInternals = {
  SUPPORT_AREA_CRITERIA,
  REPORT_TYPE_CRITERIA,
  clean,
  normalizeChoice,
  normalizeReportType,
  normalizeNoul,
  requestBody,
  withTimeout,
};
