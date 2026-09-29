import crypto from "node:crypto";
import { MongoClient } from "mongodb";
import { env } from "../config/env.js";
import { getDb } from "../database/mongodb.js";
import { normalizeGoldstoreDomain } from "./site-check-service.js";

const STOCK_FIELDS = [
  "stock_awal",
  "stock_in",
  "stock_out",
  "stock_beli",
  "stock_jual",
  "stock_hancur",
  "stock_akhir",
  "berat_awal",
  "berat_in",
  "berat_out",
  "berat_beli",
  "berat_jual",
  "berat_hancur",
  "berat_akhir",
];

// Field-field ini berasal dari saldo harian NAGAGOLD. Nilai-nilai tersebut
// dipakai untuk membedakan mismatch carry-forward murni dari mismatch yang
// mungkin memang dijelaskan oleh mutasi pada tanggal berjalan.
const ROLLOVER_MOVEMENT_FIELDS = [
  "stock_tambah",
  "stock_in",
  "stock_out",
  "stock_jual",
  "stock_beli",
  "stock_hancur",
  "berat_tambah",
  "berat_in",
  "berat_out",
  "berat_jual",
  "berat_beli",
  "berat_hancur",
];

// Kategori yang digunakan oleh flow penjualan NAGAGOLD. PENJUALAN adalah
// penerimaan utama; kategori lain harus dipisahkan agar pembatalan/cashback
// tidak keliru dianggap sebagai penjualan baru.
const SALES_CASH_CATEGORIES = [
  "PENJUALAN",
  "BATAL PENJUALAN",
  "KEMBALI LEBIH BAYAR",
  "TUKAR KURANG",
  "KELEBIHAN BAYAR DP PENJUALAN",
  "CASHBACK",
  "LEBIH BAYAR PENJUALAN",
  "KELEBIHAN PO",
];
const SALES_ADJUSTMENT_CATEGORIES = new Set(SALES_CASH_CATEGORIES.slice(1));
const FINANCE_AMOUNT_TOLERANCE = 0.01;
const BUYBACK_CASH_CATEGORIES = new Set(["PEMBELIAN", "BATAL BELI", "BATAL PEMBELIAN"]);
const REPORT_VISIBILITY_CONTEXTS = new Set(["buyback", "sales", "cash", "service", "debt", "stock"]);

const TARGET_STATUSES = new Set(["active", "disabled"]);
let investigationClients = new Map();

function now() {
  return new Date();
}

function investigationError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function clean(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

const INVESTIGATION_TIME_ZONE = "Asia/Jakarta";
const INDONESIAN_MONTHS = {
  januari: 1,
  jan: 1,
  februari: 2,
  feb: 2,
  maret: 3,
  mar: 3,
  april: 4,
  apr: 4,
  mei: 5,
  may: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  agustus: 8,
  agu: 8,
  agt: 8,
  september: 9,
  sep: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  desember: 12,
  des: 12,
};

function jakartaDateString(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INVESTIGATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftIsoDate(value, days) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function resolveInvestigationDate(value, referenceDate = new Date()) {
  const input = clean(value, 80).toLowerCase().replace(/\s+/g, " ");
  if (!input) {
    throw investigationError("Tanggal wajib diisi.", "INVESTIGATION_DATE_INVALID");
  }

  if (isValidIsoDate(input)) return input;

  const today = jakartaDateString(referenceDate);
  const relativeOffsets = {
    "hari ini": 0,
    hariini: 0,
    today: 0,
    kemarin: -1,
    yesterday: -1,
    besok: 1,
    tomorrow: 1,
    lusa: 2,
  };
  if (Object.hasOwn(relativeOffsets, input)) return shiftIsoDate(today, relativeOffsets[input]);

  const withoutPrefix = input.replace(/^(tanggal|tgl)\s+/, "");
  const monthNameMatch = withoutPrefix.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
  if (monthNameMatch) {
    const day = Number(monthNameMatch[1]);
    const month = INDONESIAN_MONTHS[monthNameMatch[2]];
    const year = Number(monthNameMatch[3] || today.slice(0, 4));
    const candidate = `${String(year).padStart(4, "0")}-${String(month || 0).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (month && isValidIsoDate(candidate)) return candidate;
  }

  const numericMatch = withoutPrefix.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?$/);
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    const year = Number(numericMatch[3] || today.slice(0, 4));
    const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (isValidIsoDate(candidate)) return candidate;
  }

  throw investigationError(
    "Tanggal tidak dikenali. Gunakan 'hari ini', 'kemarin', atau format YYYY-MM-DD.",
    "INVESTIGATION_DATE_INVALID",
  );
}

function normalizeDate(value) {
  return resolveInvestigationDate(value);
}

export function normalizeInvestigationDomain(value) {
  return normalizeGoldstoreDomain(value).hostname;
}

function publicTarget(doc) {
  return {
    domain: doc.domain,
    tenant_id: doc.tenant_id || doc.domain || "",
    connection_profile: doc.connection_profile || env.investigationMongoDefaultProfile,
    database_name: doc.database_name || "",
    display_name: doc.display_name || doc.domain,
    status: doc.status || "active",
    allowed_collection_profile: doc.allowed_collection_profile || "stock-v1",
    created_at: doc.created_at || null,
    updated_at: doc.updated_at || null,
  };
}

function normalizeConnectionProfile(value) {
  const profile = clean(value, 64).toLowerCase() || env.investigationMongoDefaultProfile;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile)) {
    throw investigationError("Profil koneksi database tidak valid.", "INVESTIGATION_PROFILE_INVALID");
  }
  return profile;
}

async function getInvestigationClient(profileName) {
  const profile = normalizeConnectionProfile(profileName);
  const existing = investigationClients.get(profile);
  if (existing) return existing;
  const uri = env.investigationMongoProfiles[profile];
  if (!uri) {
    throw investigationError(
      `Profil koneksi database investigasi '${profile}' belum dikonfigurasi. Isi INVESTIGATION_MONGODB_URI_${profile.toUpperCase()} dengan koneksi MongoDB read-only.`,
      "INVESTIGATION_DB_NOT_CONFIGURED",
      503,
    );
  }

  const client = new MongoClient(uri, {
    maxPoolSize: 5,
    minPoolSize: 0,
    connectTimeoutMS: Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000),
    serverSelectionTimeoutMS: Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000),
    socketTimeoutMS: Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000),
    readPreference: "secondaryPreferred",
  });

  try {
    await client.connect();
    investigationClients.set(profile, client);
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw investigationError(
      `Database customer pada profil '${profile}' tidak dapat dihubungi: ` + (error?.message || "connection failed"),
      "INVESTIGATION_DB_UNAVAILABLE",
      503,
    );
  }
}

export async function closeInvestigationMongo() {
  await Promise.all([...investigationClients.values()].map((client) => client.close().catch(() => undefined)));
  investigationClients = new Map();
}

export async function listInvestigationTargets() {
  const db = await getDb();
  const rows = await db.collection(env.investigationTargetCollection)
    .find({}, { projection: { domain: 1, tenant_id: 1, connection_profile: 1, database_name: 1, display_name: 1, status: 1, allowed_collection_profile: 1, created_at: 1, updated_at: 1 } })
    .sort({ status: 1, domain: 1 })
    .limit(500)
    .toArray();
  return rows.map(publicTarget);
}

export async function upsertInvestigationTarget({
  domain,
  connection_profile,
  database_name,
  display_name,
  status = "active",
  allowed_collection_profile = "stock-v1",
  helpdeskUser,
}) {
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const normalizedStatus = clean(status, 20).toLowerCase() || "active";
  if (!TARGET_STATUSES.has(normalizedStatus)) {
    throw investigationError("Status target database tidak valid.", "INVESTIGATION_TARGET_INVALID");
  }

  const normalizedProfile = normalizeConnectionProfile(connection_profile);
  const normalizedTenant = normalizedDomain;
  const normalizedDatabase = clean(database_name || env.investigationMongoDb, 200);
  if (!normalizedDatabase) throw investigationError("Nama database tenant wajib diisi.", "INVESTIGATION_DATABASE_REQUIRED");

  const db = await getDb();
  const timestamp = now();
  const result = await db.collection(env.investigationTargetCollection).findOneAndUpdate(
    { domain: normalizedDomain },
    {
      $set: {
        domain: normalizedDomain,
        tenant_id: normalizedTenant,
        connection_profile: normalizedProfile,
        database_name: normalizedDatabase,
        display_name: clean(display_name, 200) || normalizedDomain,
        status: normalizedStatus,
        allowed_collection_profile: clean(allowed_collection_profile, 80) || "stock-v1",
        updated_at: timestamp,
        updated_by_helpdesk_id: helpdeskUser?.helpdesk_id || "",
      },
      $setOnInsert: {
        created_at: timestamp,
        created_by_helpdesk_id: helpdeskUser?.helpdesk_id || "",
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  return publicTarget(result);
}

async function findTarget(domain) {
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const db = await getDb();
  const target = await db.collection(env.investigationTargetCollection).findOne(
    { domain: normalizedDomain, status: "active" },
    { maxTimeMS: 5000 },
  );
  if (!target) {
    throw investigationError(
      "Target database untuk " + normalizedDomain + " belum dikonfigurasi atau sedang disabled.",
      "INVESTIGATION_TARGET_NOT_FOUND",
      404,
    );
  }
  return target;
}

export async function getInvestigationDatabase(domain, profileName = "") {
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const target = await findTarget(normalizedDomain);
  const client = await getInvestigationClient(profileName || target.connection_profile);
  return {
    target,
    db: client.db(target.database_name || env.investigationMongoDb),
  };
}

function projectionFor(fields) {
  return Object.fromEntries(fields.map((field) => [field, 1]));
}

function scopeFilter({ kode_barcode, kode_toko, kode_gudang, tanggal }) {
  return {
    kode_barcode,
    ...(kode_toko ? { kode_toko } : {}),
    ...(kode_gudang ? { kode_gudang } : {}),
    ...(tanggal ? { tanggal } : {}),
  };
}

function stockScopeFilter({ kode_toko, kode_gudang, tanggal }) {
  return {
    ...(kode_toko ? { kode_toko } : {}),
    ...(kode_gudang ? { kode_gudang } : {}),
    ...(tanggal ? { tanggal } : {}),
  };
}

function resolveKodeBaki(params = {}) {
  return clean(params.kode_toko || params.kode_baki, 80);
}

function numericSum(rows, field) {
  return rows.reduce((total, row) => {
    const value = Number(row?.[field]);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function amountExpression(field) {
  return {
    $convert: {
      input: field,
      to: "double",
      onError: 0,
      onNull: 0,
    },
  };
}

function servicePaymentTotalExpression() {
  return {
    $reduce: {
      input: { $ifNull: ["$pembayaran", []] },
      initialValue: 0,
      in: {
        $add: [
          "$$value",
          { $convert: { input: "$$this.jumlah_rp", to: "double", onError: 0, onNull: 0 } },
        ],
      },
    },
  };
}

function serviceExpectedCashExpression() {
  return {
    $reduce: {
      input: { $ifNull: ["$pembayaran", []] },
      initialValue: 0,
      in: {
        $add: [
          "$$value",
          {
            $multiply: [
              { $convert: { input: "$$this.jumlah_rp", to: "double", onError: 0, onNull: 0 } },
              {
                $add: [
                  1,
                  {
                    $divide: [
                      { $convert: { input: "$$this.fee", to: "double", onError: 0, onNull: 0 } },
                      100,
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

function cleanFinanceKey(value) {
  return String(value || "").trim();
}

function addFinanceCategory(target, category, values) {
  if (!target[category]) target[category] = { jumlah_in: 0, jumlah_out: 0, fee: 0, count: 0, jenis: {} };
  target[category].jumlah_in += numberValue(values?.jumlah_in);
  target[category].jumlah_out += numberValue(values?.jumlah_out);
  target[category].fee += numberValue(values?.fee);
  target[category].count += numberValue(values?.count || 1);
  const jenis = cleanFinanceKey(values?.jenis).toUpperCase() || "UNKNOWN";
  target[category].jenis[jenis] = (target[category].jenis[jenis] || 0) + 1;
}

function classifySalesCashFinding({ sales, cash, paymentTotal, saleCashIn, cancelCashOut, adjustmentIn, adjustmentOut }) {
  const hasSale = Boolean(sales);
  const hasCash = Boolean(cash);
  const grossSales = numberValue(sales?.gross_sales);
  const expectedPayment = numberValue(paymentTotal);
  const netCash = saleCashIn - cancelCashOut + adjustmentIn - adjustmentOut;
  const difference = netCash - expectedPayment;
  const hasCancellation = cancelCashOut > FINANCE_AMOUNT_TOLERANCE;
  const hasAdjustment = adjustmentIn > FINANCE_AMOUNT_TOLERANCE || adjustmentOut > FINANCE_AMOUNT_TOLERANCE;

  if (!hasSale && hasCash) {
    return {
      code: "MISSING_SALE",
      message: "Cash penjualan ditemukan, tetapi faktur penjualan yang masuk scope laporan tidak ditemukan.",
      difference,
    };
  }
  if (hasSale && !hasCash && expectedPayment > FINANCE_AMOUNT_TOLERANCE) {
    return {
      code: "MISSING_CASH",
      message: "Penjualan dan pembayaran ditemukan, tetapi cash PENJUALAN tidak ditemukan.",
      difference: -expectedPayment,
    };
  }
  if (hasSale && expectedPayment <= FINANCE_AMOUNT_TOLERANCE && grossSales > FINANCE_AMOUNT_TOLERANCE && !hasCash) {
    return {
      code: "PAYMENT_NOT_EMBEDDED",
      message: "Nilai penjualan ada, tetapi detail pembayaran tidak terbentuk atau tidak terbaca.",
      difference: -grossSales,
    };
  }
  if (Math.abs(difference) <= FINANCE_AMOUNT_TOLERANCE) {
    if (hasCancellation || hasAdjustment) {
      return {
        code: "MATCH_WITH_ADJUSTMENT",
        message: "Nominal cocok setelah memperhitungkan pembatalan atau adjustment.",
        difference: 0,
      };
    }
    return null;
  }
  if (hasCancellation) {
    return {
      code: "CANCELLATION_NOT_OFFSET",
      message: "Cash penjualan memiliki pembatalan, tetapi hasil netonya belum cocok dengan pembayaran.",
      difference,
    };
  }
  return {
    code: "AMOUNT_DIFFERENCE",
    message: "Nominal pembayaran penjualan berbeda dari cash setelah adjustment.",
    difference,
  };
}

function compactFinanceFinding({ key, sales, cash, cancellation, paymentTotal, paymentByType, saleCashIn, cancelCashOut, adjustmentIn, adjustmentOut, classification }) {
  return {
    code: classification.code,
    message: classification.message,
    no_faktur_group: key,
    no_faktur_jual: sales?.no_faktur_jual || [],
    tanggal_penjualan: sales?.tanggal_penjualan || [],
    gross_sales: numberValue(sales?.gross_sales),
    total_dp: numberValue(sales?.total_dp),
    expected_payment: numberValue(paymentTotal),
    payment_by_type: paymentByType,
    cash_penjualan: numberValue(saleCashIn),
    cash_batal_penjualan: numberValue(cancelCashOut),
    adjustment_in: numberValue(adjustmentIn),
    adjustment_out: numberValue(adjustmentOut),
    net_cash: numberValue(saleCashIn - cancelCashOut + adjustmentIn - adjustmentOut),
    difference: numberValue(classification.difference),
    cash_categories: cash || {},
    cancellation: cancellation || null,
    status_scope: {
      penjualan_status_valid: "DONE",
      penjualan_status_kembali: "OPEN",
      cash_status: "OPEN",
    },
  };
}

function normalizeKnownCashCategory(value) {
  const category = clean(value, 80).toUpperCase();
  return BUYBACK_CASH_CATEGORIES.has(category) ? category : "UNKNOWN";
}

function classifyBuybackCashFinding({ buyback, cash, expectedPayment, buybackTotal, cancellationTotal }) {
  const hasBuyback = Boolean(buyback);
  const hasCash = Boolean(cash);
  const cashOut = numberValue(cash?.cash_out);
  const cashIn = numberValue(cash?.cash_in);
  const netCashOut = cashOut - cashIn;
  const expected = expectedPayment > FINANCE_AMOUNT_TOLERANCE ? expectedPayment : buybackTotal;
  const difference = netCashOut - expected;

  if (!hasBuyback && hasCash) {
    return {
      code: "MISSING_BUYBACK",
      message: "Cash terkait buyback ditemukan, tetapi transaksi buyback tidak ditemukan dalam scope tanggal/status yang diperiksa.",
      difference: netCashOut,
    };
  }
  if (hasBuyback && !hasCash && expected > FINANCE_AMOUNT_TOLERANCE) {
    return {
      code: cancellationTotal > FINANCE_AMOUNT_TOLERANCE ? "CANCELED_BUYBACK_REQUIRES_CASH_REVIEW" : "MISSING_BUYBACK_CASH",
      message: cancellationTotal > FINANCE_AMOUNT_TOLERANCE
        ? "Buyback ditemukan dan memiliki pembatalan, tetapi pasangan cash berdasarkan nomor transaksi belum ditemukan."
        : "Buyback ditemukan, tetapi cash keluar yang berelasi belum ditemukan.",
      difference: -expected,
    };
  }
  if (hasBuyback && expectedPayment <= FINANCE_AMOUNT_TOLERANCE && buybackTotal > FINANCE_AMOUNT_TOLERANCE && !hasCash) {
    return {
      code: "BUYBACK_PAYMENT_NOT_EMBEDDED",
      message: "Nilai buyback ada, tetapi detail pembayaran tidak terbentuk atau tidak terbaca.",
      difference: -buybackTotal,
    };
  }
  if (Math.abs(difference) <= FINANCE_AMOUNT_TOLERANCE) return null;
  return {
    code: cancellationTotal > FINANCE_AMOUNT_TOLERANCE ? "CANCELLATION_NOT_OFFSET" : "BUYBACK_AMOUNT_DIFFERENCE",
    message: cancellationTotal > FINANCE_AMOUNT_TOLERANCE
      ? "Nominal buyback belum cocok setelah memperhitungkan arus pembatalan."
      : "Nominal buyback/pembayaran berbeda dari cash keluar bersih.",
    difference,
  };
}

function compactBuybackFinding({ key, buyback, cash, cancellation, expectedPayment, classification }) {
  return {
    code: classification.code,
    message: classification.message,
    no_faktur_group: key,
    no_faktur_beli: buyback?.no_faktur_beli || [],
    kode_barcode: buyback?.kode_barcode || [],
    kode_gudang: buyback?.kode_gudang || [],
    buyback_total: numberValue(buyback?.buyback_total),
    expected_payment: numberValue(expectedPayment),
    payment_by_type: buyback?.payment_by_type || {},
    cash_out: numberValue(cash?.cash_out),
    cash_in: numberValue(cash?.cash_in),
    net_cash_out: numberValue(numberValue(cash?.cash_out) - numberValue(cash?.cash_in)),
    cash_categories: cash?.categories || {},
    cash_category_unreadable_count: numberValue(cash?.unknown_category_count),
    cancellation: cancellation || null,
    difference: numberValue(classification.difference),
    status_scope: {
      buyback_status_valid: "DONE",
      cash_status: "OPEN",
    },
  };
}

function classifyServiceCashFinding({ service, cash, expectedCash }) {
  const hasService = Boolean(service);
  const hasCash = Boolean(cash);
  const cashIn = numberValue(cash?.cash_in);
  const cashOut = numberValue(cash?.cash_out);
  const serviceCashIn = numberValue(cash?.service_cash_in) + numberValue(cash?.service_ambil_cash_in);
  const cancellationCashOut = numberValue(cash?.cancel_service_cash_out);
  const isCanceled = (service?.status_proses || []).some((status) => String(status).toUpperCase() === "CANC");
  const expectedNetCash = isCanceled ? 0 : numberValue(expectedCash);
  const netCash = serviceCashIn - cancellationCashOut;
  const difference = netCash - expectedNetCash;
  const knownCash = serviceCashIn > FINANCE_AMOUNT_TOLERANCE || cancellationCashOut > FINANCE_AMOUNT_TOLERANCE;

  if (!hasService && hasCash && knownCash) {
    return {
      code: "MISSING_SERVICE",
      message: "Cash service ditemukan, tetapi nomor service tidak ditemukan pada tt_service_detail dalam scope yang diperiksa.",
      difference: netCash,
    };
  }
  if (hasService && !hasCash && !isCanceled && numberValue(expectedCash) > FINANCE_AMOUNT_TOLERANCE) {
    return {
      code: "MISSING_SERVICE_CASH",
      message: "Data service dan pembayaran ditemukan, tetapi cash SERVICE/SERVICE AMBIL belum ditemukan.",
      difference: -numberValue(expectedCash),
    };
  }
  if (isCanceled && cancellationCashOut <= FINANCE_AMOUNT_TOLERANCE && numberValue(expectedCash) > FINANCE_AMOUNT_TOLERANCE) {
    return {
      code: "CANCELED_SERVICE_WITHOUT_REFUND",
      message: "Service berstatus CANC, tetapi cash BATAL SERVICE belum ditemukan.",
      difference: netCash,
    };
  }
  if (!isCanceled && cancellationCashOut > FINANCE_AMOUNT_TOLERANCE) {
    return {
      code: "ACTIVE_SERVICE_HAS_CANCELLATION",
      message: "Cash BATAL SERVICE ditemukan, tetapi status service belum CANC.",
      difference,
    };
  }
  if (hasService && knownCash && Math.abs(difference) > FINANCE_AMOUNT_TOLERANCE) {
    return {
      code: "SERVICE_AMOUNT_DIFFERENCE",
      message: "Nominal pembayaran service berbeda dari cash service setelah memperhitungkan pembatalan.",
      difference,
    };
  }
  return null;
}

function compactServiceFinding({ key, service, cash, expectedCash, classification }) {
  return {
    code: classification.code,
    message: classification.message,
    no_faktur_service: key,
    no_faktur_group: service?.no_faktur_group || "",
    tgl_system: service?.tgl_system || [],
    tgl_selesai: service?.tgl_selesai || [],
    tgl_ambil: service?.tgl_ambil || [],
    tgl_batal: service?.tgl_batal || [],
    status_proses: service?.status_proses || [],
    status_valid: service?.status_valid || [],
    service_total: numberValue(service?.service_total),
    total_bayar: numberValue(service?.total_bayar),
    expected_payment: numberValue(service?.expected_payment),
    expected_cash: numberValue(expectedCash),
    cash_service: numberValue(cash?.service_cash_in),
    cash_service_ambil: numberValue(cash?.service_ambil_cash_in),
    cash_batal_service: numberValue(cash?.cancel_service_cash_out),
    cash_in: numberValue(cash?.cash_in),
    cash_out: numberValue(cash?.cash_out),
    net_cash: numberValue(numberValue(cash?.service_cash_in) + numberValue(cash?.service_ambil_cash_in) - numberValue(cash?.cancel_service_cash_out)),
    difference: numberValue(classification.difference),
    cash_categories: cash?.categories || {},
    unknown_category_count: numberValue(cash?.unknown_category_count),
    status_scope: { cash_status: "OPEN", service_source: "tt_service_detail.tgl_system" },
  };
}

function sumCashCategories(categories = {}, names = []) {
  return names.reduce((total, name) => {
    const item = categories[name] || {};
    return total + numberValue(item.jumlah_in) - numberValue(item.jumlah_out);
  }, 0);
}

function classifyOpnameSaldoFinding({ opname, saldo }) {
  if (!opname) return { code: "OPNAME_NOT_FOUND", message: "Data stock opname tidak ditemukan pada scope yang diperiksa." };
  if (!saldo) return { code: "SALDO_NOT_FOUND", message: "Saldo barang tidak ditemukan pada tanggal dan lokasi yang sama." };
  if (opname.status_barang === "OPEN") return { code: "OPNAME_NOT_SCANNED", message: "Baris opname masih berstatus OPEN; barang belum terkonfirmasi pada proses stock opname." };
  const stockDifference = numberValue(opname.stock_on_hand) - numberValue(saldo.stock_akhir);
  const weightDifference = numberValue(opname.berat) - numberValue(saldo.berat_akhir);
  if (Math.abs(stockDifference) > 0.000001 || Math.abs(weightDifference) > 0.000001) {
    return {
      code: "OPNAME_SALDO_MISMATCH",
      message: "Nilai stock/berat pada data opname berbeda dari saldo akhir pada lokasi dan tanggal yang sama.",
      stock_difference: stockDifference,
      weight_difference: weightDifference,
    };
  }
  return null;
}

function classifyHancurSaldoFinding({ hancur, saldo }) {
  if (!hancur) return { code: "HANCUR_NOT_FOUND", message: "Transaksi hancur barang tidak ditemukan pada scope yang diperiksa." };
  if (!saldo) return { code: "SALDO_NOT_FOUND", message: "Saldo manual barang tidak ditemukan pada tanggal dan lokasi yang sama." };
  const stockDifference = numberValue(hancur.stock) - numberValue(saldo.stock_hancur);
  const weightDifference = numberValue(hancur.berat) - numberValue(saldo.berat_hancur);
  const remainingStock = numberValue(saldo.stock_akhir);
  const remainingWeight = numberValue(saldo.berat_akhir);
  if (Math.abs(stockDifference) > 0.000001 || Math.abs(weightDifference) > 0.000001 || Math.abs(remainingStock) > 0.000001 || Math.abs(remainingWeight) > 0.000001) {
    return {
      code: "HANCUR_SALDO_MISMATCH",
      message: "Jumlah hancur pada transaksi belum tercermin pada movement hancur atau saldo akhir belum menjadi nol.",
      stock_difference: stockDifference,
      weight_difference: weightDifference,
      remaining_stock: remainingStock,
      remaining_weight: remainingWeight,
    };
  }
  return null;
}

function classifyDebtCashFinding({ source, kind, cash }) {
  if (!source) return { code: "SOURCE_NOT_FOUND", message: "Data hutang/cicilan tidak ditemukan pada scope yang diperiksa." };
  const categories = cash?.categories || {};
  const isCanceled = kind === "hutang"
    ? ["CANC", "BATAL", "CANCEL"].includes(String(source.status_hutang || "").toUpperCase())
    : String(source.status || "").toUpperCase() === "CANC";

  if (kind === "hutang") {
    const initialExpected = numberValue(source.jumlah_hutang);
    const initialActual = sumCashCategories(categories, ["HUTANG"]) - Math.max(0, sumCashCategories(categories, ["HUTANG BATAL"]));
    const settlementExpected = numberValue(source.total_bayar);
    const settlementActual = sumCashCategories(categories, ["HUTANG LUNAS"]);
    const interestActual = sumCashCategories(categories, ["BAYAR BUNGA"]);
    if (!isCanceled && initialExpected > FINANCE_AMOUNT_TOLERANCE && Math.abs(initialActual - initialExpected) > FINANCE_AMOUNT_TOLERANCE) {
      return { code: initialActual === 0 ? "MISSING_HUTANG_CASH" : "HUTANG_CASH_AMOUNT_DIFFERENCE", message: "Cash pembentukan hutang tidak sama dengan jumlah_hutang setelah memperhitungkan pembatalan.", expected: initialExpected, actual: initialActual, difference: initialActual - initialExpected };
    }
    if (settlementExpected > FINANCE_AMOUNT_TOLERANCE && Math.abs(settlementActual - settlementExpected) > FINANCE_AMOUNT_TOLERANCE && settlementActual > 0) {
      return { code: "HUTANG_SETTLEMENT_AMOUNT_DIFFERENCE", message: "Cash HUTANG LUNAS berbeda dari total_bayar pada data hutang.", expected: settlementExpected, actual: settlementActual, interest_cash: interestActual, difference: settlementActual - settlementExpected };
    }
    if (settlementExpected > FINANCE_AMOUNT_TOLERANCE && settlementActual === 0 && interestActual === 0 && !isCanceled) {
      return { code: "MISSING_HUTANG_SETTLEMENT_CASH", message: "Data hutang memiliki total_bayar, tetapi cash HUTANG LUNAS/BAYAR BUNGA tidak ditemukan." , expected: settlementExpected, actual: 0, difference: -settlementExpected };
    }
    return null;
  }

  const expectedPaid = Math.max(0, numberValue(source.harga_jual_cicil) - numberValue(source.sisa_bayar));
  const actualPaid = sumCashCategories(categories, ["DP CICILAN", "BAYAR CICILAN", "PELUNASAN CEPAT CICILAN"]) - Math.max(0, sumCashCategories(categories, ["BATAL CICILAN"]));
  if (isCanceled && Math.abs(actualPaid) > FINANCE_AMOUNT_TOLERANCE) {
    return { code: "CANCELED_CICILAN_HAS_CASH", message: "Cicilan berstatus CANC tetapi cash cicilan masih memiliki nilai bersih.", expected: 0, actual: actualPaid, difference: actualPaid };
  }
  if (!isCanceled && expectedPaid > FINANCE_AMOUNT_TOLERANCE && Math.abs(actualPaid - expectedPaid) > FINANCE_AMOUNT_TOLERANCE) {
    return { code: actualPaid === 0 ? "MISSING_CICILAN_CASH" : "CICILAN_CASH_AMOUNT_DIFFERENCE", message: "Total pembayaran cicilan tidak sama dengan harga cicilan dikurangi sisa bayar.", expected: expectedPaid, actual: actualPaid, difference: actualPaid - expectedPaid };
  }
  return null;
}

function compactDebtCashFinding({ key, kind, source, cash, classification }) {
  return {
    code: classification.code,
    message: classification.message,
    type: kind,
    identifier: key,
    status: source?.status_hutang || source?.status || "",
    expected: numberValue(classification.expected),
    actual: numberValue(classification.actual),
    difference: numberValue(classification.difference),
    cash_categories: cash?.categories || {},
    source: kind === "hutang"
      ? { jumlah_hutang: numberValue(source?.jumlah_hutang), total_bayar: numberValue(source?.total_bayar), bunga_terbayar: numberValue(source?.bunga_terbayar), tgl_system: source?.tgl_system || "", tgl_lunas: source?.tgl_lunas || "" }
      : { dp_rp: numberValue(source?.dp_rp), harga_jual_cicil: numberValue(source?.harga_jual_cicil), sisa_bayar: numberValue(source?.sisa_bayar), nilai_angsuran: numberValue(source?.nilai_angsuran), cicilan_terbayar: numberValue(source?.cicilan_terbayar), tgl_system: source?.tgl_system || "" },
  };
}

function compactStockRow(row) {
  if (!row) return null;
  const compact = Object.fromEntries(
    ["tanggal", "kode_barcode", "kode_toko", "kode_gudang", ...STOCK_FIELDS]
      .filter((field) => row[field] !== undefined)
      .map((field) => [field, row[field]]),
  );
  if (compact.kode_toko !== undefined) compact.kode_baki = compact.kode_toko;
  return compact;
}

function compactMasterRow(row) {
  if (!row) return null;
  const compact = Object.fromEntries(
    ["kode_barcode", "kode_barang", "kode_group", "kode_dept", "kode_toko", "kode_gudang", "stock_on_hand", "berat", "status_hancur", "tgl_last_beli", "tgl_last_jual"]
      .filter((field) => row[field] !== undefined)
      .map((field) => [field, row[field]]),
  );
  if (compact.kode_toko !== undefined) compact.kode_baki = compact.kode_toko;
  return compact;
}

function buildDifferences({ barcodeTotals, scopeTotals, summary, master, scopeComplete }) {
  const differences = [];
  if (!master) differences.push({ code: "MASTER_NOT_FOUND", message: "Barcode tidak ditemukan pada tm_barang." });
  if (!barcodeTotals.count) differences.push({ code: "SALDO_NOT_FOUND", message: "Saldo barcode pada tt_barang_saldo tidak ditemukan untuk filter yang dipilih." });
  if (!scopeComplete) {
    differences.push({
      code: "SUMMARY_SCOPE_REQUIRED",
      message: "Perbandingan dengan tt_barang_summary membutuhkan kode_baki/posisi (field kode_toko) dan kode_gudang yang spesifik.",
    });
  } else if (!summary) {
    differences.push({ code: "SUMMARY_NOT_FOUND", message: "Ringkasan tt_barang_summary tidak ditemukan untuk tanggal, kode baki/posisi, dan kode gudang tersebut." });
  } else {
    for (const field of STOCK_FIELDS) {
      const saldoValue = Number(scopeTotals[field] || 0);
      const summaryValue = Number(summary[field] || 0);
      const difference = saldoValue - summaryValue;
      if (Math.abs(difference) > 0.000001) {
        differences.push({
          code: "SUMMARY_METRIC_MISMATCH",
          field,
          saldo_value: saldoValue,
          summary_value: summaryValue,
          difference,
        });
      }
    }
  }

  if (scopeComplete && master && master.stock_on_hand !== undefined && barcodeTotals.count) {
    const masterStock = Number(master.stock_on_hand || 0);
    const saldoStock = Number(barcodeTotals.stock_akhir || 0);
    if (Math.abs(masterStock - saldoStock) > 0.000001) {
      differences.push({
        code: "MASTER_SALDO_MISMATCH",
        field: "stock_akhir",
        master_value: masterStock,
        saldo_value: saldoStock,
        difference: saldoStock - masterStock,
      });
    }
  }

  return differences;
}

function buildQueryHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function buildInvestigationStatus(findings) {
  if (findings.some((item) => item.code !== "SUMMARY_SCOPE_REQUIRED")) return "difference_found";
  if (findings.some((item) => item.code === "SUMMARY_SCOPE_REQUIRED")) return "insufficient_scope";
  return "no_difference";
}

function numericOrNull(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactRolloverRow(row) {
  const previous = row?.previous || null;
  const current = row?.current || null;
  const previousStock = numericOrNull(previous?.stock_akhir);
  const currentStock = numericOrNull(current?.stock_awal);
  const previousWeight = numericOrNull(previous?.berat_akhir);
  const currentWeight = numericOrNull(current?.berat_awal);
  return {
    kode_barcode: row?._id?.kode_barcode || "",
    kode_toko: row?._id?.kode_toko || "",
    kode_baki: row?._id?.kode_toko || "",
    kode_gudang: row?._id?.kode_gudang || "",
    previous: previous ? {
      tanggal: previous.tanggal,
      stock_akhir: previousStock,
      berat_akhir: previousWeight,
      row_count: previous.row_count || 0,
    } : null,
    current: current ? {
      tanggal: current.tanggal,
      stock_awal: currentStock,
      berat_awal: currentWeight,
      stock_akhir: numericOrNull(current.stock_akhir),
      berat_akhir: numericOrNull(current.berat_akhir),
      movements: Object.fromEntries(ROLLOVER_MOVEMENT_FIELDS.map((field) => [field, numericOrNull(current[field]) ?? 0])),
      row_count: current.row_count || 0,
    } : null,
    stock_difference: previousStock !== null && currentStock !== null ? currentStock - previousStock : null,
    weight_difference: previousWeight !== null && currentWeight !== null ? currentWeight - previousWeight : null,
    mismatch_type: !previous ? "PREVIOUS_DATE_MISSING"
      : !current ? "CURRENT_DATE_MISSING"
        : previous.row_count !== 1 || current.row_count !== 1 ? "DUPLICATE_DATE_ROWS"
          : "OPENING_CLOSING_MISMATCH",
  };
}

function hasNonZeroMovement(row) {
  const movementSource = row?.movements || row;
  return ROLLOVER_MOVEMENT_FIELDS.some((field) => Math.abs(Number(movementSource?.[field] || 0)) > 0.000001);
}

function buildRolloverCorrectionCandidate(row) {
  const previous = row?.previous;
  const current = row?.current;
  if (!previous || !current) return null;
  if (previous.row_count !== 1 || current.row_count !== 1) return null;

  const previousStock = numericOrNull(previous.stock_akhir);
  const currentOpeningStock = numericOrNull(current.stock_awal);
  const previousWeight = numericOrNull(previous.berat_akhir);
  const currentOpeningWeight = numericOrNull(current.berat_awal);
  if (previousStock === null || currentOpeningStock === null) return null;

  const hasMovement = hasNonZeroMovement(current);
  const stockMismatch = Math.abs(currentOpeningStock - previousStock) > 0.000001;
  const weightMismatch = previousWeight !== null && currentOpeningWeight !== null
    ? Math.abs(currentOpeningWeight - previousWeight) > 0.000001
    : false;
  if (!stockMismatch && !weightMismatch) return null;

  const candidate = {
    type: hasMovement ? "opening_carry_forward_mismatch_with_movements" : "opening_carry_forward_mismatch",
    confidence: hasMovement ? "needs_verification" : "high",
    reason: hasMovement
      ? "Saldo awal berbeda dari saldo akhir hari sebelumnya dan tanggal berjalan memiliki mutasi. Periksa mutasi sebelum menentukan nilai koreksi."
      : "Saldo awal berbeda dari saldo akhir hari sebelumnya, sementara seluruh field mutasi tanggal berjalan bernilai nol.",
    requires_human_confirmation: true,
    target_date: current.tanggal,
    source: {
      previous_date: previous.tanggal,
      previous_stock_akhir: previousStock,
      previous_berat_akhir: previousWeight,
    },
    current: {
      stock_awal: currentOpeningStock,
      berat_awal: currentOpeningWeight,
      stock_akhir: numericOrNull(current.stock_akhir),
      berat_akhir: numericOrNull(current.berat_akhir),
      has_movement: hasMovement,
    },
    expected: {
      stock_awal: previousStock,
      berat_awal: previousWeight,
      // Jika tidak ada mutasi, stock akhir juga harus tetap sama dengan
      // saldo awal yang sudah dikoreksi. Jangan mengisi ini jika ada mutasi.
      ...(hasMovement ? {} : {
        stock_akhir: previousStock,
        berat_akhir: previousWeight,
      }),
    },
  };

  return candidate;
}

async function recordRun({ trainingId, helpdeskUser, domain, operationId, filters, result, error }) {
  try {
    const db = await getDb();
    await db.collection(env.investigationRunCollection).insertOne({
      training_id: trainingId || "",
      helpdesk_id: helpdeskUser?.helpdesk_id || "",
      helpdesk_name: helpdeskUser?.name || "",
      domain,
      operation_id: operationId,
      filters,
      status: error ? "failed" : result?.status || "completed",
      collections_used: result?.collections_used || [],
      summary: result?.summary || null,
      findings: (result?.findings || []).slice(0, 20),
      warnings: (result?.warnings || []).slice(0, 20),
      query_hash: result?.query_hash || "",
      duration_ms: result?.duration_ms || null,
      error_code: error?.code || null,
      created_at: now(),
    });
  } catch (auditError) {
    console.warn("Audit investigasi gagal disimpan: " + (auditError?.message || auditError));
  }
}

export async function inspectStockDifference({ domain, params = {}, trainingId = "", helpdeskUser }) {
  const startedAt = Date.now();
  const operationId = "stock.detail_vs_summary";
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const kode_barcode = clean(params.kode_barcode, 120);
  const tanggal = normalizeDate(params.tanggal);
  const kode_toko = resolveKodeBaki(params);
  const kode_gudang = clean(params.kode_gudang, 80);
  if (!kode_barcode) throw investigationError("Kode barcode wajib diisi untuk mencari selisih barang.", "INVESTIGATION_BARCODE_REQUIRED");

  const filters = { kode_barcode, tanggal, ...(kode_toko ? { kode_toko } : {}), ...(kode_gudang ? { kode_gudang } : {}) };
  let result;

  try {
    const target = await findTarget(normalizedDomain);
    const client = await getInvestigationClient(target.connection_profile);
    const targetDb = client.db(target.database_name || env.investigationMongoDb);
    const timeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
    const maxRows = Math.min(Math.max(env.investigationMaxRows, 1), 100);

    const masterFilter = {
      kode_barcode,
      ...(kode_toko ? { kode_toko } : {}),
      ...(kode_gudang ? { kode_gudang } : {}),
    };
    const master = await targetDb.collection("tm_barang").findOne(
      masterFilter,
      {
        projection: projectionFor(["kode_barcode", "kode_barang", "kode_group", "kode_dept", "kode_toko", "kode_gudang", "stock_on_hand", "berat", "status_hancur", "tgl_last_beli", "tgl_last_jual"]),
        maxTimeMS: timeout,
      },
    );

    const saldoRows = await targetDb.collection("tt_barang_saldo")
      .find(scopeFilter({ kode_barcode, kode_toko, kode_gudang, tanggal }), {
        projection: projectionFor(["tanggal", "kode_barcode", "kode_toko", "kode_gudang", ...STOCK_FIELDS]),
        maxTimeMS: timeout,
      })
      .limit(maxRows)
      .toArray();

    const historyRows = await targetDb.collection("th_barang_saldo")
      .find(scopeFilter({ kode_barcode, kode_toko, kode_gudang, tanggal }), {
        projection: projectionFor(["tanggal", "kode_barcode", "kode_toko", "kode_gudang", ...STOCK_FIELDS]),
        maxTimeMS: timeout,
      })
      .limit(maxRows)
      .toArray();

    const resolvedToko = kode_toko || clean(master?.kode_toko, 80);
    const resolvedGudang = kode_gudang || clean(master?.kode_gudang, 80);
    const scopeComplete = Boolean(resolvedToko && resolvedGudang);
    const summary = scopeComplete
      ? await targetDb.collection("tt_barang_summary").findOne(
          { tanggal, kode_toko: resolvedToko, kode_gudang: resolvedGudang },
          {
            projection: projectionFor(["tanggal", "kode_toko", "kode_gudang", ...STOCK_FIELDS]),
            maxTimeMS: timeout,
          },
        )
      : null;

    const barcodeTotals = Object.fromEntries(STOCK_FIELDS.map((field) => [field, numericSum(saldoRows, field)]));
    barcodeTotals.count = saldoRows.length;
    const scopeTotalsRows = scopeComplete
      ? await targetDb.collection("tt_barang_saldo").aggregate([
          { $match: stockScopeFilter({ kode_toko: resolvedToko, kode_gudang: resolvedGudang, tanggal }) },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              ...Object.fromEntries(STOCK_FIELDS.map((field) => [field, { $sum: { $ifNull: ["$" + field, 0] } }])),
            },
          },
        ], { maxTimeMS: timeout, allowDiskUse: false }).toArray()
      : [];
    const scopeTotals = scopeTotalsRows[0] || Object.fromEntries([["count", 0], ...STOCK_FIELDS.map((field) => [field, 0])]);
    const differences = buildDifferences({ barcodeTotals, scopeTotals, summary, master, scopeComplete });
    const warnings = [];
    if (saldoRows.length >= maxRows) warnings.push("Hasil tt_barang_saldo dibatasi " + maxRows + " baris.");
    if (historyRows.length >= maxRows) warnings.push("Hasil th_barang_saldo dibatasi " + maxRows + " baris.");

    const queryHash = buildQueryHash({ operationId, domain: normalizedDomain, filters });
    result = {
      read_only: true,
      status: buildInvestigationStatus(differences),
      operation_id: operationId,
      target: {
        domain: normalizedDomain,
        tenant_id: target.tenant_id || normalizedDomain,
        connection_profile: target.connection_profile || env.investigationMongoDefaultProfile,
        database_name: target.database_name || "",
      },
      collections_used: ["tm_barang", "tt_barang_saldo", "th_barang_saldo", "tt_barang_summary"],
      filters,
      summary: {
        master: compactMasterRow(master),
        saldo: { count: barcodeTotals.count, ...barcodeTotals },
        scope_saldo: scopeTotals,
        history: historyRows.length ? compactStockRow(historyRows[historyRows.length - 1]) : null,
        report_summary: summary ? compactStockRow(summary) : null,
        resolved_scope: {
          kode_toko: resolvedToko || null,
          kode_baki: resolvedToko || null,
          kode_gudang: resolvedGudang || null,
        },
      },
      evidence: {
        master: compactMasterRow(master),
        saldo_rows: saldoRows.slice(0, maxRows).map(compactStockRow),
        history_rows: historyRows.slice(0, maxRows).map(compactStockRow),
        summary: compactStockRow(summary),
      },
      findings: differences,
      warnings,
      query_hash: queryHash,
      duration_ms: Date.now() - startedAt,
      instruction_to_agent: differences.length
        ? "Jelaskan temuan sebagai indikasi berbasis data read-only. Jangan mengubah database dan jangan mengklaim patch sudah diterapkan. Minta Helpdesk memverifikasi prosedur NAGAGOLD sebelum memperbaiki data."
        : "Tidak ditemukan selisih pada data yang dapat dibandingkan. Jelaskan batasan scope bila ada.",
    };
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, result });
    return result;
  } catch (error) {
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, error });
    throw error;
  }
}

export async function inspectDailyRolloverDifference({ domain, params = {}, trainingId = "", helpdeskUser }) {
  const startedAt = Date.now();
  const operationId = "stock.opening_vs_previous_closing";
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const previousDate = normalizeDate(params.tanggal_sebelumnya);
  const currentDate = normalizeDate(params.tanggal_sesudahnya);
  if (previousDate >= currentDate) {
    throw investigationError("Tanggal sebelumnya harus lebih kecil dari tanggal sesudahnya.", "INVESTIGATION_DATE_ORDER_INVALID");
  }

  const kode_toko = resolveKodeBaki(params);
  const kode_gudang = clean(params.kode_gudang, 80);
  const filters = {
    tanggal_sebelumnya: previousDate,
    tanggal_sesudahnya: currentDate,
    ...(kode_toko ? { kode_toko } : {}),
    ...(kode_gudang ? { kode_gudang } : {}),
  };
  let result;

  try {
    const target = await findTarget(normalizedDomain);
    const client = await getInvestigationClient(target.connection_profile);
    const targetDb = client.db(target.database_name || env.investigationMongoDb);
    const timeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
    const maxRows = Math.min(Math.max(env.investigationMaxRows, 1), 100);
    const historyFilter = {
      tanggal: { $in: [previousDate, currentDate] },
      ...(kode_toko ? { kode_toko } : {}),
      ...(kode_gudang ? { kode_gudang } : {}),
    };
    const historyRows = await targetDb.collection("th_barang_saldo").aggregate([
      { $match: historyFilter },
      {
        $project: {
          tanggal: 1,
          kode_barcode: 1,
          kode_toko: 1,
          kode_gudang: 1,
          stock_awal: 1,
          berat_awal: 1,
          stock_tambah: 1,
          berat_tambah: 1,
          stock_in: 1,
          berat_in: 1,
          stock_out: 1,
          berat_out: 1,
          stock_jual: 1,
          berat_jual: 1,
          stock_beli: 1,
          berat_beli: 1,
          stock_hancur: 1,
          berat_hancur: 1,
          stock_akhir: 1,
          berat_akhir: 1,
        },
      },
      {
        $group: {
          _id: {
            kode_barcode: "$kode_barcode",
            kode_toko: "$kode_toko",
            kode_gudang: "$kode_gudang",
          },
          previous_count: { $sum: { $cond: [{ $eq: ["$tanggal", previousDate] }, 1, 0] } },
          current_count: { $sum: { $cond: [{ $eq: ["$tanggal", currentDate] }, 1, 0] } },
          previous_stock_akhir: { $sum: { $cond: [{ $eq: ["$tanggal", previousDate] }, "$stock_akhir", 0] } },
          current_stock_awal: { $sum: { $cond: [{ $eq: ["$tanggal", currentDate] }, "$stock_awal", 0] } },
          previous_berat_akhir: { $sum: { $cond: [{ $eq: ["$tanggal", previousDate] }, "$berat_akhir", 0] } },
          current_berat_awal: { $sum: { $cond: [{ $eq: ["$tanggal", currentDate] }, "$berat_awal", 0] } },
          current_stock_akhir: { $sum: { $cond: [{ $eq: ["$tanggal", currentDate] }, "$stock_akhir", 0] } },
          current_berat_akhir: { $sum: { $cond: [{ $eq: ["$tanggal", currentDate] }, "$berat_akhir", 0] } },
          ...Object.fromEntries(ROLLOVER_MOVEMENT_FIELDS.map((field) => [
            `current_${field}`,
            { $sum: { $cond: [{ $eq: ["$tanggal", currentDate] }, `$${field}`, 0] } },
          ])),
        },
      },
      {
        $project: {
          _id: 1,
          previous: {
            $cond: [
              { $gt: ["$previous_count", 0] },
              {
                tanggal: previousDate,
                stock_akhir: "$previous_stock_akhir",
                berat_akhir: "$previous_berat_akhir",
                row_count: "$previous_count",
              },
              null,
            ],
          },
          current: {
            $cond: [
              { $gt: ["$current_count", 0] },
              {
                tanggal: currentDate,
                stock_awal: "$current_stock_awal",
                berat_awal: "$current_berat_awal",
                stock_akhir: "$current_stock_akhir",
                berat_akhir: "$current_berat_akhir",
                movements: Object.fromEntries(ROLLOVER_MOVEMENT_FIELDS.map((field) => [field, `$current_${field}`])),
                row_count: "$current_count",
              },
              null,
            ],
          },
        },
      },
      {
        $facet: {
          mismatches: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: [{ $ifNull: ["$previous.row_count", 0] }, 1] },
                    { $eq: [{ $ifNull: ["$current.row_count", 0] }, 1] },
                    {
                      $or: [
                        { $ne: [{ $ifNull: ["$previous.stock_akhir", 0] }, { $ifNull: ["$current.stock_awal", 0] }] },
                        { $ne: [{ $ifNull: ["$previous.berat_akhir", 0] }, { $ifNull: ["$current.berat_awal", 0] }] },
                      ],
                    },
                  ],
                },
              },
            },
            { $sort: { "_id.kode_barcode": 1, "_id.kode_toko": 1, "_id.kode_gudang": 1 } },
            { $limit: maxRows + 1 },
          ],
          unpaired_count: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $ne: [{ $ifNull: ["$previous.row_count", 0] }, 1] },
                    { $ne: [{ $ifNull: ["$current.row_count", 0] }, 1] },
                  ],
                },
              },
            },
            { $count: "count" },
          ],
        },
      },
    ], { maxTimeMS: timeout, allowDiskUse: true }).toArray();

    const aggregateResult = historyRows[0] || {};
    const mismatchRows = aggregateResult.mismatches || [];
    const unpairedCount = aggregateResult.unpaired_count?.[0]?.count || 0;
    const truncated = mismatchRows.length > maxRows;
    const evidenceRows = mismatchRows.slice(0, maxRows).map(compactRolloverRow);
    const findings = evidenceRows.map((row) => ({
      code: row.mismatch_type,
      kode_barcode: row.kode_barcode,
      kode_toko: row.kode_toko,
      kode_baki: row.kode_toko,
      kode_gudang: row.kode_gudang,
      previous_stock_akhir: row.previous?.stock_akhir ?? null,
      current_stock_awal: row.current?.stock_awal ?? null,
      stock_difference: row.stock_difference,
      previous_berat_akhir: row.previous?.berat_akhir ?? null,
      current_berat_awal: row.current?.berat_awal ?? null,
      weight_difference: row.weight_difference,
      correction_candidate: buildRolloverCorrectionCandidate(row),
      message: row.mismatch_type === "PREVIOUS_DATE_MISSING"
        ? `Data histori ${previousDate} tidak ditemukan untuk barcode ini.`
        : row.mismatch_type === "CURRENT_DATE_MISSING"
          ? `Data histori ${currentDate} tidak ditemukan untuk barcode ini.`
          : row.mismatch_type === "DUPLICATE_DATE_ROWS"
            ? `Ditemukan lebih dari satu baris histori pada salah satu tanggal untuk barcode ini; nilai belum aman dijadikan kandidat koreksi.`
          : `Stock awal ${currentDate} tidak sama dengan stock akhir ${previousDate}.`,
    }));
    const warnings = [];
    if (truncated) warnings.push("Hasil dibatasi " + maxRows + " barcode pertama. Persempit dengan kode_baki (field kode_toko) atau kode_gudang untuk melihat hasil lebih lengkap.");
    if (unpairedCount) {
      warnings.push(
        unpairedCount + " kombinasi barcode/kode_baki/kode_gudang hanya memiliki data pada salah satu tanggal atau memiliki baris ganda. Data ini tidak dihitung sebagai mismatch angka.",
      );
    }
    if (!evidenceRows.length) {
      const anyHistory = await targetDb.collection("th_barang_saldo").findOne(historyFilter, { projection: { _id: 1 }, maxTimeMS: timeout });
      if (!anyHistory) warnings.push("Tidak ditemukan data th_barang_saldo pada salah satu dari dua tanggal yang diperiksa.");
    }

    const queryHash = buildQueryHash({ operationId, domain: normalizedDomain, filters });
    result = {
      read_only: true,
      status: evidenceRows.length ? "difference_found" : "no_difference",
      operation_id: operationId,
      target: {
        domain: normalizedDomain,
        tenant_id: target.tenant_id || normalizedDomain,
        connection_profile: target.connection_profile || env.investigationMongoDefaultProfile,
        database_name: target.database_name || "",
      },
      collections_used: ["th_barang_saldo"],
      filters,
      summary: {
        previous_date: previousDate,
        current_date: currentDate,
        compared_field: "th_barang_saldo.stock_akhir(previous) ↔ stock_awal(current)",
        difference_count: findings.length,
        unpaired_count: unpairedCount,
        high_confidence_correction_count: findings.filter((item) => item.correction_candidate?.confidence === "high").length,
      },
      evidence: { rows: evidenceRows },
      findings,
      correction_candidates: findings
        .map((item) => item.correction_candidate)
        .filter(Boolean),
      warnings,
      query_hash: queryHash,
      duration_ms: Date.now() - startedAt,
      instruction_to_agent: findings.length
        ? "Jelaskan barcode, kode baki/posisi, kode gudang, nilai stock_akhir tanggal sebelumnya, nilai stock_awal dan stock_akhir tanggal sesudahnya, mutasi tanggal berjalan, serta selisihnya. Jika correction_candidate confidence=high, jelaskan sebagai kandidat carry-forward yang perlu diverifikasi Helpdesk; jika confidence=needs_verification, jangan menyarankan nilai final sebelum mutasi diperiksa. Jangan mengubah database."
        : unpairedCount
          ? "Tidak ditemukan mismatch angka pada pasangan data yang lengkap. Jelaskan bahwa ada kombinasi barcode/kode_baki/kode_gudang yang hanya memiliki data pada salah satu tanggal atau memiliki baris ganda, tetapi itu tidak boleh disebut sebagai selisih stock_akhir versus stock_awal."
        : "Jelaskan bahwa tidak ditemukan perbedaan pada data histori yang tersedia, atau minta scope/tanggal diperiksa kembali jika warning menunjukkan data tidak tersedia.",
    };
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, result });
    return result;
  } catch (error) {
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, error });
    throw error;
  }
}

/**
 * Reconciliation read-only yang mengikuti report penjualan dan cash NAGAGOLD.
 *
 * Sumber report NAGAGOLD memakai tgl_system + status_valid DONE +
 * status_kembali OPEN pada tt_jual_detail, lalu menghubungkan
 * no_faktur_group ke tt_cash_daily.deskripsi. Cash report memakai tanggal
 * + status OPEN. Karena itu fungsi ini tidak membandingkan harga_total secara
 * buta dengan jumlah_in; pembayaran, fee, pembatalan, dan adjustment dihitung
 * terpisah lalu diberikan evidence per nomor faktur group.
 */
export async function inspectSalesVsCash({ domain, params = {}, trainingId = "", helpdeskUser }) {
  const startedAt = Date.now();
  const operationId = "finance.sales_vs_cash";
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const tanggal_awal = normalizeDate(params.tanggal_awal);
  const tanggal_akhir = normalizeDate(params.tanggal_akhir);
  if (tanggal_awal > tanggal_akhir) {
    throw investigationError("tanggal_awal harus lebih kecil atau sama dengan tanggal_akhir.", "INVESTIGATION_DATE_ORDER_INVALID");
  }
  const no_faktur_group = clean(params.no_faktur_group, 160);
  const jenis_pembayaran = clean(params.jenis_pembayaran, 80).toUpperCase();
  const maxRows = Math.min(Math.max(Number(params.max_rows) || env.investigationMaxRows, 1), 200);
  const filters = {
    tanggal_awal,
    tanggal_akhir,
    ...(no_faktur_group ? { no_faktur_group } : {}),
    ...(jenis_pembayaran ? { jenis_pembayaran } : {}),
  };

  try {
    const target = await findTarget(normalizedDomain);
    const client = await getInvestigationClient(target.connection_profile);
    const targetDb = client.db(target.database_name || env.investigationMongoDb);
    const timeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
    const salesMatch = {
      tgl_system: { $gte: tanggal_awal, $lte: tanggal_akhir },
      status_valid: "DONE",
      status_kembali: "OPEN",
      ...(no_faktur_group ? { no_faktur_group } : {}),
    };
    const paymentMatch = jenis_pembayaran ? { "pembayaran.jenis": jenis_pembayaran } : null;

    const [salesAggregate, cashRows, cancellationRows, statusRows] = await Promise.all([
      targetDb.collection("tt_jual_detail").aggregate([
        { $match: salesMatch },
        {
          $facet: {
            invoices: [
              {
                $group: {
                  _id: "$no_faktur_group",
                  gross_sales: { $sum: amountExpression("$harga_total") },
                  total_dp: { $sum: amountExpression("$bayar_dp") },
                  detail_count: { $sum: 1 },
                  no_faktur_jual: { $addToSet: "$no_faktur_jual" },
                  tanggal_penjualan: { $addToSet: "$tgl_system" },
                  kode_gudang: { $addToSet: "$kode_gudang" },
                },
              },
              { $match: { _id: { $nin: [null, ""] } } },
            ],
            payments: [
              { $unwind: { path: "$pembayaran", preserveNullAndEmptyArrays: false } },
              ...(paymentMatch ? [{ $match: paymentMatch }] : []),
              {
                $group: {
                  _id: { group: "$no_faktur_group", jenis: "$pembayaran.jenis" },
                  total_payment: { $sum: amountExpression("$pembayaran.jumlah_rp") },
                  total_fee: { $sum: amountExpression("$pembayaran.fee") },
                  payment_count: { $sum: 1 },
                },
              },
              { $match: { "_id.group": { $nin: [null, ""] } } },
            ],
          },
        },
      ], { maxTimeMS: timeout, allowDiskUse: true }).toArray(),
      targetDb.collection("tt_cash_daily").aggregate([
        {
          $match: {
            tanggal: { $gte: tanggal_awal, $lte: tanggal_akhir },
            status: "OPEN",
            kategori: { $in: SALES_CASH_CATEGORIES },
            ...(no_faktur_group ? { deskripsi: no_faktur_group } : {}),
            ...(jenis_pembayaran ? { jenis: jenis_pembayaran } : {}),
          },
        },
        {
          $group: {
            _id: { group: "$deskripsi", kategori: "$kategori", jenis: "$jenis" },
            jumlah_in: { $sum: amountExpression("$jumlah_in") },
            jumlah_out: { $sum: amountExpression("$jumlah_out") },
            fee: { $sum: amountExpression("$fee") },
            count: { $sum: 1 },
          },
        },
        { $match: { "_id.group": { $nin: [null, ""] } } },
      ], { maxTimeMS: timeout, allowDiskUse: true }).toArray(),
      targetDb.collection("tt_jual_batal").aggregate([
        {
          $match: {
            tgl_system: { $gte: tanggal_awal, $lte: tanggal_akhir },
            ...(no_faktur_group ? { no_faktur_group } : {}),
          },
        },
        {
          $group: {
            _id: "$no_faktur_group",
            count: { $sum: 1 },
            total_batal: { $sum: amountExpression("$harga_total") },
            status_valid: { $addToSet: "$status_valid" },
          },
        },
        { $match: { _id: { $nin: [null, ""] } } },
      ], { maxTimeMS: timeout, allowDiskUse: true }).toArray(),
      targetDb.collection("tt_jual_detail").aggregate([
        {
          $match: {
            tgl_system: { $gte: tanggal_awal, $lte: tanggal_akhir },
            ...(no_faktur_group ? { no_faktur_group } : {}),
          },
        },
        { $group: { _id: { status_valid: "$status_valid", status_kembali: "$status_kembali" }, count: { $sum: 1 } } },
      ], { maxTimeMS: timeout, allowDiskUse: true }).toArray(),
    ]);

    const facet = salesAggregate[0] || {};
    const salesByGroup = new Map();
    for (const row of facet.invoices || []) {
      const key = cleanFinanceKey(row._id);
      if (key) salesByGroup.set(key, row);
    }

    const paymentsByGroup = new Map();
    for (const row of facet.payments || []) {
      const key = cleanFinanceKey(row?._id?.group);
      if (!key) continue;
      const item = paymentsByGroup.get(key) || { total: 0, fee: 0, by_type: {} };
      const jenis = cleanFinanceKey(row?._id?.jenis).toUpperCase() || "UNKNOWN";
      item.total += numberValue(row.total_payment);
      item.fee += numberValue(row.total_fee);
      item.by_type[jenis] = (item.by_type[jenis] || 0) + numberValue(row.total_payment);
      paymentsByGroup.set(key, item);
    }

    const cashByGroup = new Map();
    for (const row of cashRows) {
      const key = cleanFinanceKey(row?._id?.group);
      const category = cleanFinanceKey(row?._id?.kategori).toUpperCase();
      if (!key || !category) continue;
      const item = cashByGroup.get(key) || {};
      addFinanceCategory(item, category, {
        jumlah_in: row.jumlah_in,
        jumlah_out: row.jumlah_out,
        fee: row.fee,
        count: row.count,
        jenis: row?._id?.jenis,
      });
      cashByGroup.set(key, item);
    }

    const cancellationByGroup = new Map();
    for (const row of cancellationRows || []) {
      const key = cleanFinanceKey(row?._id);
      if (key) cancellationByGroup.set(key, {
        count: numberValue(row.count),
        total_batal: numberValue(row.total_batal),
        status_valid: row.status_valid || [],
      });
    }

    const keys = new Set([...salesByGroup.keys(), ...cashByGroup.keys()]);
    const findings = [];
    let totals = {
      gross_sales: 0,
      expected_payment: 0,
      cash_penjualan: 0,
      cash_batal_penjualan: 0,
      adjustment_in: 0,
      adjustment_out: 0,
      net_cash: 0,
    };

    for (const key of [...keys].sort()) {
      const sales = salesByGroup.get(key) || null;
      const cash = cashByGroup.get(key) || null;
      const payment = paymentsByGroup.get(key) || { total: 0, fee: 0, by_type: {} };
      const saleCashIn = numberValue(cash?.PENJUALAN?.jumlah_in);
      const cancelCashOut = numberValue(cash?.["BATAL PENJUALAN"]?.jumlah_out);
      const adjustmentIn = Object.entries(cash || {})
        .filter(([category]) => SALES_ADJUSTMENT_CATEGORIES.has(category))
        .reduce((sum, [, value]) => sum + numberValue(value?.jumlah_in), 0);
      const adjustmentOut = Object.entries(cash || {})
        .filter(([category]) => SALES_ADJUSTMENT_CATEGORIES.has(category))
        .reduce((sum, [, value]) => sum + numberValue(value?.jumlah_out), 0) - cancelCashOut;
      const classification = classifySalesCashFinding({
        sales,
        cash,
        paymentTotal: payment.total,
        saleCashIn,
        cancelCashOut,
        adjustmentIn,
        adjustmentOut,
      });

      totals.gross_sales += numberValue(sales?.gross_sales);
      totals.expected_payment += payment.total;
      totals.cash_penjualan += saleCashIn;
      totals.cash_batal_penjualan += cancelCashOut;
      totals.adjustment_in += adjustmentIn;
      totals.adjustment_out += adjustmentOut;
      totals.net_cash += saleCashIn - cancelCashOut + adjustmentIn - adjustmentOut;

      if (classification && classification.code !== "MATCH_WITH_ADJUSTMENT") {
        findings.push(compactFinanceFinding({
          key,
          sales,
          cash,
          cancellation: cancellationByGroup.get(key) || null,
          paymentTotal: payment.total,
          paymentByType: payment.by_type,
          saleCashIn,
          cancelCashOut,
          adjustmentIn,
          adjustmentOut,
          classification,
        }));
      }
    }

    const truncated = findings.length > maxRows;
    const visibleFindings = findings.slice(0, maxRows);
    const status = findings.length ? "difference_found" : "no_difference";
    const result = {
      read_only: true,
      status,
      operation_id: operationId,
      operation_name: "Selisih Penjualan dan Keuangan",
      target: {
        domain: normalizedDomain,
        tenant_id: target.tenant_id || normalizedDomain,
        connection_profile: target.connection_profile || env.investigationMongoDefaultProfile,
        database_name: target.database_name || "",
      },
      collections_used: ["tt_jual_detail", "tt_cash_daily", "tt_jual_batal"],
      filters,
      summary: {
        report_profile: "nagagold_eod_default",
        difference_count: findings.length,
        returned_count: visibleFindings.length,
        truncated,
        sales_group_count: salesByGroup.size,
        cash_group_count: cashByGroup.size,
        totals,
        status_scope: statusRows,
      },
      evidence: { rows: visibleFindings },
      findings: visibleFindings,
      warnings: [
        ...(truncated ? [`Hasil dibatasi ${maxRows} faktur group. Persempit periode atau isi no_faktur_group.`] : []),
        "Perbandingan mengikuti scope report EOD NAGAGOLD: penjualan status_valid=DONE dan status_kembali=OPEN, cash status=OPEN.",
        "Tanggal penjualan memakai tgl_system, sedangkan cash memakai tanggal. Perbedaan tanggal dapat menjadi DATE_SHIFT dan perlu ditelusuri manual.",
      ],
      query_hash: buildQueryHash({ operationId, domain: normalizedDomain, filters }),
      duration_ms: Date.now() - startedAt,
      instruction_to_agent: findings.length
        ? "Jelaskan hanya faktur group yang ditemukan sebagai mismatch. Gunakan heading TEMUAN, EVIDENCE, KEMUNGKINAN PENYEBAB, dan SARAN PERBAIKAN. Tampilkan expected_payment, cash_penjualan, pembatalan/adjustment, net_cash, difference, dan status mismatch. Jangan mengubah database."
        : "Jelaskan bahwa tidak ditemukan selisih pada scope report yang diperiksa. Jangan menyimpulkan semua laporan pasti benar di luar tanggal dan status scope tersebut.",
    };

    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, result });
    return result;
  } catch (error) {
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, error });
    throw error;
  }
}

/**
 * Reconciliation read-only untuk service NAGAGOLD.
 * Service membuat cash kategori SERVICE saat masuk, SERVICE AMBIL saat barang
 * diambil, dan BATAL SERVICE saat transaksi dibatalkan. Semua cash dirujuk
 * melalui tt_cash_daily.deskripsi = tt_service_detail.no_faktur_service.
 */
export async function inspectServiceVsCash({ domain, params = {}, trainingId = "", helpdeskUser }) {
  const startedAt = Date.now();
  const operationId = "service.status_vs_cash";
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const tanggal_awal = normalizeDate(params.tanggal_awal);
  const tanggal_akhir = normalizeDate(params.tanggal_akhir);
  if (tanggal_awal > tanggal_akhir) {
    throw investigationError("tanggal_awal harus lebih kecil atau sama dengan tanggal_akhir.", "INVESTIGATION_DATE_ORDER_INVALID");
  }
  const no_faktur_service = clean(params.no_faktur_service, 160);
  const status_proses = clean(params.status_proses, 20).toUpperCase();
  const maxRows = Math.min(Math.max(Number(params.max_rows) || env.investigationMaxRows, 1), 200);
  const filters = {
    tanggal_awal,
    tanggal_akhir,
    ...(no_faktur_service ? { no_faktur_service } : {}),
    ...(status_proses ? { status_proses } : {}),
  };

  try {
    const target = await findTarget(normalizedDomain);
    const client = await getInvestigationClient(target.connection_profile);
    const targetDb = client.db(target.database_name || env.investigationMongoDb);
    const timeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
    const serviceMatch = {
      tgl_system: { $gte: tanggal_awal, $lte: tanggal_akhir },
      ...(no_faktur_service ? { no_faktur_service } : {}),
      ...(status_proses ? { status_proses } : {}),
    };
    const serviceRows = await targetDb.collection("tt_service_detail").aggregate([
      { $match: serviceMatch },
      {
        $group: {
          _id: "$no_faktur_service",
          no_faktur_group: { $first: "$no_faktur_group" },
          tgl_system: { $addToSet: "$tgl_system" },
          tgl_selesai: { $addToSet: "$tgl_selesai" },
          tgl_ambil: { $addToSet: "$tgl_ambil" },
          tgl_batal: { $addToSet: "$tgl_batal" },
          status_proses: { $addToSet: "$status_proses" },
          status_valid: { $addToSet: "$status_valid" },
          service_total: { $sum: amountExpression("$total") },
          total_bayar: { $sum: amountExpression("$total_bayar") },
          expected_payment: { $sum: servicePaymentTotalExpression() },
          expected_cash: { $sum: serviceExpectedCashExpression() },
        },
      },
      { $match: { _id: { $nin: [null, ""] } } },
      { $sort: { _id: 1 } },
      { $limit: maxRows + 1 },
    ], { maxTimeMS: timeout, allowDiskUse: true }).toArray();

    const serviceByKey = new Map(serviceRows.map((row) => [cleanFinanceKey(row._id), row]));
    const serviceKeys = [...serviceByKey.keys()];
    const cashDescriptions = serviceKeys.length ? serviceKeys : (no_faktur_service ? [no_faktur_service] : []);
    const cashRows = cashDescriptions.length
      ? await targetDb.collection("tt_cash_daily").aggregate([
        {
          $match: {
            tanggal: { $gte: tanggal_awal, $lte: tanggal_akhir },
            status: "OPEN",
            deskripsi: { $in: cashDescriptions },
          },
        },
        {
          $group: {
            _id: { service: "$deskripsi", kategori: "$kategori" },
            jumlah_in: { $sum: amountExpression("$jumlah_in") },
            jumlah_out: { $sum: amountExpression("$jumlah_out") },
            fee: { $sum: amountExpression("$fee") },
            count: { $sum: 1 },
            tanggal: { $addToSet: "$tanggal" },
          },
        },
      ], { maxTimeMS: timeout, allowDiskUse: true }).toArray()
      : [];

    const cashByKey = new Map();
    for (const row of cashRows) {
      const key = cleanFinanceKey(row?._id?.service);
      if (!key) continue;
      const category = clean(row?._id?.kategori, 100).toUpperCase() || "UNKNOWN";
      const item = cashByKey.get(key) || {
        cash_in: 0,
        cash_out: 0,
        service_cash_in: 0,
        service_ambil_cash_in: 0,
        cancel_service_cash_out: 0,
        unknown_category_count: 0,
        categories: {},
      };
      const jumlahIn = numberValue(row.jumlah_in);
      const jumlahOut = numberValue(row.jumlah_out);
      item.cash_in += jumlahIn;
      item.cash_out += jumlahOut;
      item.categories[category] = item.categories[category] || { jumlah_in: 0, jumlah_out: 0, count: 0, tanggal: row.tanggal || [] };
      item.categories[category].jumlah_in += jumlahIn;
      item.categories[category].jumlah_out += jumlahOut;
      item.categories[category].count += numberValue(row.count);
      if (category === "SERVICE") item.service_cash_in += jumlahIn;
      else if (category === "SERVICE AMBIL") item.service_ambil_cash_in += jumlahIn;
      else if (category === "BATAL SERVICE") item.cancel_service_cash_out += jumlahOut;
      else item.unknown_category_count += numberValue(row.count);
      cashByKey.set(key, item);
    }

    const keys = [...new Set([...serviceByKey.keys(), ...cashByKey.keys()])].sort();
    const findings = [];
    let unknownCategoryCount = 0;
    for (const key of keys) {
      const service = serviceByKey.get(key) || null;
      const cash = cashByKey.get(key) || null;
      unknownCategoryCount += numberValue(cash?.unknown_category_count);
      const expectedCash = numberValue(service?.expected_cash);
      const classification = classifyServiceCashFinding({ service, cash, expectedCash });
      if (classification) findings.push(compactServiceFinding({ key, service, cash, expectedCash, classification }));
    }

    const truncated = findings.length > maxRows;
    const visibleFindings = findings.slice(0, maxRows);
    const warnings = [
      "Service memakai relasi tt_service_detail.no_faktur_service = tt_cash_daily.deskripsi.",
      "Pembayaran awal memakai kategori SERVICE, pembayaran saat barang diambil memakai SERVICE AMBIL, dan pembatalan memakai BATAL SERVICE.",
      "Tanggal sumber service memakai tgl_system, sedangkan cash memakai tanggal.",
      ...(unknownCategoryCount ? ["Sebagian kategori cash tidak terbaca sebagai kategori service; hasil tersebut tidak dipaksakan menjadi mismatch."] : []),
      ...(truncated ? [`Hasil dibatasi ${maxRows} nomor service. Persempit periode atau isi no_faktur_service.`] : []),
    ];
    const result = {
      read_only: true,
      status: visibleFindings.length ? "difference_found" : "no_difference",
      operation_id: operationId,
      operation_name: "Status Service dan Cash NAGAGOLD",
      target: {
        domain: normalizedDomain,
        tenant_id: target.tenant_id || normalizedDomain,
        connection_profile: target.connection_profile || env.investigationMongoDefaultProfile,
        database_name: target.database_name || "",
      },
      collections_used: ["tt_service_detail", "tt_cash_daily"],
      filters,
      summary: {
        report_profile: "nagagold_service_cash",
        service_count: serviceByKey.size,
        cash_count: cashByKey.size,
        difference_count: findings.length,
        returned_count: visibleFindings.length,
        truncated,
      },
      evidence: { rows: visibleFindings },
      findings: visibleFindings,
      warnings,
      query_hash: buildQueryHash({ operationId, domain: normalizedDomain, filters }),
      duration_ms: Date.now() - startedAt,
      instruction_to_agent: visibleFindings.length
        ? "Gunakan heading TEMUAN, EVIDENCE, KEMUNGKINAN PENYEBAB, dan SARAN PERBAIKAN. Tampilkan nomor service, status service, kategori cash, expected cash, cash aktual, selisih, dan tanggal. Jangan mengubah database."
        : "Jelaskan bahwa tidak ditemukan ketidaksesuaian service dan cash pada scope tanggal/status yang diperiksa.",
    };
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, result });
    return result;
  } catch (error) {
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, error });
    throw error;
  }
}

/**
 * Reconciliation read-only untuk pindah barang internal NAGAGOLD.
 * Ini bukan kirim barang antar-cabang. Report tt_pindah_barang_manual mencatat
 * perpindahan antar-baki/gudang, sedangkan saldo manual memakai stock_out di
 * lokasi asal dan stock_tambah di lokasi tujuan.
 */
export async function inspectInternalTransferVsSaldo({ domain, params = {}, trainingId = "", helpdeskUser }) {
  const startedAt = Date.now();
  const operationId = "stock.internal_transfer_vs_saldo";
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const tanggal_awal = normalizeDate(params.tanggal_awal);
  const tanggal_akhir = normalizeDate(params.tanggal_akhir);
  if (tanggal_awal > tanggal_akhir) {
    throw investigationError("tanggal_awal harus lebih kecil atau sama dengan tanggal_akhir.", "INVESTIGATION_DATE_ORDER_INVALID");
  }
  const no_pindah = clean(params.no_pindah, 160);
  const kode_dept = clean(params.kode_dept, 120);
  const kode_gudang_asal = clean(params.kode_gudang_asal, 80);
  const kode_toko_asal = clean(params.kode_toko_asal || params.kode_baki_asal, 80);
  const kode_gudang_tujuan = clean(params.kode_gudang_tujuan, 80);
  const kode_toko_tujuan = clean(params.kode_toko_tujuan || params.kode_baki_tujuan, 80);
  const maxRows = Math.min(Math.max(Number(params.max_rows) || env.investigationMaxRows, 1), 200);
  const filters = {
    tanggal_awal,
    tanggal_akhir,
    ...(no_pindah ? { no_pindah } : {}),
    ...(kode_dept ? { kode_dept } : {}),
    ...(kode_gudang_asal ? { kode_gudang_asal } : {}),
    ...(kode_toko_asal ? { kode_baki_asal: kode_toko_asal } : {}),
    ...(kode_gudang_tujuan ? { kode_gudang_tujuan } : {}),
    ...(kode_toko_tujuan ? { kode_baki_tujuan: kode_toko_tujuan } : {}),
  };

  try {
    const target = await findTarget(normalizedDomain);
    const client = await getInvestigationClient(target.connection_profile);
    const targetDb = client.db(target.database_name || env.investigationMongoDb);
    const timeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
    const transferMatch = {
      tgl_system: { $gte: tanggal_awal, $lte: tanggal_akhir },
      ...(no_pindah ? { no_pindah } : {}),
      ...(kode_dept ? { kode_dept } : {}),
      ...(kode_gudang_asal ? { kode_gudang_asal } : {}),
      ...(kode_toko_asal ? { kode_toko_asal } : {}),
      ...(kode_gudang_tujuan ? { kode_gudang_tujuan } : {}),
      ...(kode_toko_tujuan ? { kode_toko_tujuan } : {}),
    };
    const transferRows = await targetDb.collection("tt_pindah_barang_manual").aggregate([
      { $match: transferMatch },
      {
        $group: {
          _id: {
            no_pindah: "$no_pindah",
            tgl_system: "$tgl_system",
            kode_dept: "$kode_dept",
            kode_gudang_asal: "$kode_gudang_asal",
            kode_toko_asal: "$kode_toko_asal",
            kode_gudang_tujuan: "$kode_gudang_tujuan",
            kode_toko_tujuan: "$kode_toko_tujuan",
          },
          expected_stock: { $sum: amountExpression("$stock") },
          expected_weight: { $sum: amountExpression("$berat") },
          report_row_count: { $sum: 1 },
        },
      },
      { $sort: { "_id.tgl_system": 1, "_id.no_pindah": 1 } },
      { $limit: maxRows + 1 },
    ], { maxTimeMS: timeout, allowDiskUse: true }).toArray();

    const locationPairs = [];
    for (const row of transferRows.slice(0, maxRows)) {
      const id = row._id;
      for (const [kode_gudang, kode_toko] of [[id.kode_gudang_asal, id.kode_toko_asal], [id.kode_gudang_tujuan, id.kode_toko_tujuan]]) {
        locationPairs.push({ tanggal: id.tgl_system, kode_barcode: id.kode_dept, kode_gudang, kode_toko });
      }
    }
    const uniqueLocationPairs = [...new Map(locationPairs.map((item) => [JSON.stringify(item), item])).values()];
    const saldoRows = uniqueLocationPairs.length
      ? await targetDb.collection("tt_barang_saldo_manual").find(
        { $or: uniqueLocationPairs },
        { projection: { _id: 0, tanggal: 1, kode_barcode: 1, kode_gudang: 1, kode_toko: 1, stock_out: 1, berat_out: 1, stock_tambah: 1, berat_tambah: 1, stock_akhir: 1, berat_akhir: 1 } },
      ).maxTimeMS(timeout).toArray()
      : [];

    const saldoByLocation = new Map();
    for (const row of saldoRows) {
      const key = JSON.stringify({ tanggal: row.tanggal, kode_barcode: row.kode_barcode, kode_gudang: row.kode_gudang, kode_toko: row.kode_toko });
      const current = saldoByLocation.get(key) || { ...row, row_count: 0 };
      current.row_count += 1;
      for (const field of ["stock_out", "berat_out", "stock_tambah", "berat_tambah", "stock_akhir", "berat_akhir"]) current[field] = numberValue(current[field]) + numberValue(row[field]);
      saldoByLocation.set(key, current);
    }

    const findings = [];
    for (const row of transferRows.slice(0, maxRows)) {
      const id = row._id;
      const sourceKey = JSON.stringify({ tanggal: id.tgl_system, kode_barcode: id.kode_dept, kode_gudang: id.kode_gudang_asal, kode_toko: id.kode_toko_asal });
      const targetKey = JSON.stringify({ tanggal: id.tgl_system, kode_barcode: id.kode_dept, kode_gudang: id.kode_gudang_tujuan, kode_toko: id.kode_toko_tujuan });
      const source = saldoByLocation.get(sourceKey) || null;
      const destination = saldoByLocation.get(targetKey) || null;
      const expectedStock = numberValue(row.expected_stock);
      const expectedWeight = numberValue(row.expected_weight);
      const sourceStock = numberValue(source?.stock_out);
      const sourceWeight = numberValue(source?.berat_out);
      const destinationStock = numberValue(destination?.stock_tambah);
      const destinationWeight = numberValue(destination?.berat_tambah);
      const reasons = [];
      if (!source) reasons.push("SOURCE_SALDO_NOT_FOUND");
      else if (sourceStock + FINANCE_AMOUNT_TOLERANCE < expectedStock || sourceWeight + FINANCE_AMOUNT_TOLERANCE < expectedWeight) reasons.push("SOURCE_SALDO_MOVEMENT_SHORT");
      if (!destination) reasons.push("DESTINATION_SALDO_NOT_FOUND");
      else if (destinationStock + FINANCE_AMOUNT_TOLERANCE < expectedStock || destinationWeight + FINANCE_AMOUNT_TOLERANCE < expectedWeight) reasons.push("DESTINATION_SALDO_MOVEMENT_SHORT");
      if (!reasons.length) continue;
      findings.push({
        code: reasons.join(","),
        no_pindah: id.no_pindah,
        tanggal: id.tgl_system,
        kode_dept: id.kode_dept,
        kode_gudang_asal: id.kode_gudang_asal,
        kode_baki_asal: id.kode_toko_asal,
        kode_toko_asal: id.kode_toko_asal,
        kode_gudang_tujuan: id.kode_gudang_tujuan,
        kode_baki_tujuan: id.kode_toko_tujuan,
        kode_toko_tujuan: id.kode_toko_tujuan,
        expected: { stock: expectedStock, berat: expectedWeight },
        source_saldo: source ? { stock_out: sourceStock, berat_out: sourceWeight, stock_akhir: numberValue(source.stock_akhir), berat_akhir: numberValue(source.berat_akhir), row_count: source.row_count } : null,
        destination_saldo: destination ? { stock_tambah: destinationStock, berat_tambah: destinationWeight, stock_akhir: numberValue(destination.stock_akhir), berat_akhir: numberValue(destination.berat_akhir), row_count: destination.row_count } : null,
        difference: {
          source_stock: sourceStock - expectedStock,
          source_weight: sourceWeight - expectedWeight,
          destination_stock: destinationStock - expectedStock,
          destination_weight: destinationWeight - expectedWeight,
        },
      });
    }

    const truncated = transferRows.length > maxRows;
    const visibleFindings = findings.slice(0, maxRows);
    const result = {
      read_only: true,
      status: visibleFindings.length ? "difference_found" : "no_difference",
      operation_id: operationId,
      operation_name: "Pindah Barang Internal vs Saldo Manual",
      target: {
        domain: normalizedDomain,
        tenant_id: target.tenant_id || normalizedDomain,
        connection_profile: target.connection_profile || env.investigationMongoDefaultProfile,
        database_name: target.database_name || "",
      },
      collections_used: ["tt_pindah_barang_manual", "tt_barang_saldo_manual"],
      filters,
      summary: {
        report_profile: "nagagold_internal_transfer",
        transfer_count: transferRows.length,
        difference_count: findings.length,
        returned_count: visibleFindings.length,
        truncated,
      },
      evidence: { rows: visibleFindings },
      findings: visibleFindings,
      warnings: [
        "Operation ini hanya memeriksa pindah barang internal antar-baki/gudang menggunakan tt_pindah_barang_manual.",
        "Kirim barang antar-cabang tidak termasuk dalam operation ini dan tidak diperiksa melalui tt_kirim_barang.",
        "Saldo manual dapat memuat movement lain pada tanggal yang sama; nilai movement yang lebih besar dari transfer tidak otomatis dianggap error.",
        ...(truncated ? [`Hasil dibatasi ${maxRows} transaksi pindah barang.`] : []),
      ],
      query_hash: buildQueryHash({ operationId, domain: normalizedDomain, filters }),
      duration_ms: Date.now() - startedAt,
      instruction_to_agent: visibleFindings.length
        ? "Gunakan heading TEMUAN, EVIDENCE, KEMUNGKINAN PENYEBAB, dan SARAN PERBAIKAN. Sebutkan nomor pindah, kode dept/barang, kode baki asal/tujuan, gudang asal/tujuan, expected movement, movement saldo aktual, dan alasan mismatch. Jangan menyebutnya kirim antar-cabang dan jangan mengubah database."
        : "Jelaskan bahwa tidak ditemukan kekurangan movement saldo manual untuk transaksi pindah barang internal pada scope yang diperiksa.",
    };
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, result });
    return result;
  } catch (error) {
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, error });
    throw error;
  }
}

/**
 * Reconciliation read-only untuk hasil stock opname terhadap saldo akhir.
 * tt_opname dibuat dari data barang saat proses opname dimulai. Status OPEN
 * berarti barcode belum terkonfirmasi/ter-scan, sedangkan status DONE berarti
 * barcode sudah ditemukan pada proses tersebut. Nilai stock_on_hand dan berat
 * kemudian dibandingkan dengan tt_barang_saldo pada tanggal dan lokasi yang
 * sama.
 */
export async function inspectOpnameVsSaldo({ domain, params = {}, trainingId = "", helpdeskUser }) {
  const startedAt = Date.now();
  const operationId = "stock.opname_vs_saldo";
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const tanggal_awal = normalizeDate(params.tanggal_awal);
  const tanggal_akhir = normalizeDate(params.tanggal_akhir);
  if (tanggal_awal > tanggal_akhir) throw investigationError("tanggal_awal harus lebih kecil atau sama dengan tanggal_akhir.", "INVESTIGATION_DATE_ORDER_INVALID");
  const kode_barcode = clean(params.kode_barcode, 120);
  const kode_gudang = clean(params.kode_gudang, 80);
  const kode_toko = resolveKodeBaki(params);
  const maxRows = Math.min(Math.max(Number(params.max_rows) || env.investigationMaxRows, 1), 200);
  const filters = { tanggal_awal, tanggal_akhir, ...(kode_barcode ? { kode_barcode } : {}), ...(kode_gudang ? { kode_gudang } : {}), ...(kode_toko ? { kode_baki: kode_toko } : {}) };

  try {
    const target = await findTarget(normalizedDomain);
    const client = await getInvestigationClient(target.connection_profile);
    const targetDb = client.db(target.database_name || env.investigationMongoDb);
    const timeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
    const opnameRows = await targetDb.collection("tt_opname").aggregate([
      { $match: { tgl_opname: { $gte: tanggal_awal, $lte: tanggal_akhir }, ...(kode_barcode ? { kode_barcode } : {}), ...(kode_gudang ? { kode_gudang } : {}), ...(kode_toko ? { kode_toko } : {}) } },
      {
        $group: {
          _id: { tanggal: "$tgl_opname", kode_barcode: "$kode_barcode", kode_gudang: "$kode_gudang", kode_toko: "$kode_toko" },
          stock_on_hand: { $sum: amountExpression("$stock_on_hand") },
          berat: { $sum: amountExpression("$berat") },
          status_barang: { $addToSet: "$status_barang" },
          status_opname: { $addToSet: "$status_opname" },
          no_opname: { $addToSet: "$no_opname" },
          row_count: { $sum: 1 },
        },
      },
      { $sort: { "_id.tanggal": 1, "_id.kode_barcode": 1 } },
      { $limit: maxRows + 1 },
    ], { maxTimeMS: timeout, allowDiskUse: true }).toArray();
    const visibleOpname = opnameRows.slice(0, maxRows);
    const saldoOr = visibleOpname.map((row) => ({ tanggal: row._id.tanggal, kode_barcode: row._id.kode_barcode, kode_gudang: row._id.kode_gudang, kode_toko: row._id.kode_toko }));
    const saldoRows = saldoOr.length
      ? await targetDb.collection("tt_barang_saldo").find({ $or: saldoOr }, { projection: { _id: 0, tanggal: 1, kode_barcode: 1, kode_gudang: 1, kode_toko: 1, stock_akhir: 1, berat_akhir: 1 } }).maxTimeMS(timeout).toArray()
      : [];
    const saldoByKey = new Map(saldoRows.map((row) => [JSON.stringify({ tanggal: row.tanggal, kode_barcode: row.kode_barcode, kode_gudang: row.kode_gudang, kode_toko: row.kode_toko }), row]));
    const findings = [];
    for (const row of visibleOpname) {
      const id = row._id;
      const saldo = saldoByKey.get(JSON.stringify({ tanggal: id.tanggal, kode_barcode: id.kode_barcode, kode_gudang: id.kode_gudang, kode_toko: id.kode_toko })) || null;
      const opname = { stock_on_hand: row.stock_on_hand, berat: row.berat, status_barang: row.status_barang?.length === 1 ? row.status_barang[0] : row.status_barang?.join(",") || "", status_opname: row.status_opname, no_opname: row.no_opname, tanggal: id.tanggal, kode_barcode: id.kode_barcode, kode_gudang: id.kode_gudang, kode_toko: id.kode_toko };
      const classification = classifyOpnameSaldoFinding({ opname, saldo });
      if (classification) findings.push({ ...classification, tanggal: id.tanggal, kode_barcode: id.kode_barcode, kode_gudang: id.kode_gudang, kode_baki: id.kode_toko, opname, saldo: saldo ? { stock_akhir: numberValue(saldo.stock_akhir), berat_akhir: numberValue(saldo.berat_akhir) } : null });
    }
    const result = {
      read_only: true,
      status: findings.length ? "difference_found" : "no_difference",
      operation_id: operationId,
      operation_name: "Stock Opname vs Saldo",
      target: { domain: normalizedDomain, tenant_id: target.tenant_id || normalizedDomain, connection_profile: target.connection_profile || env.investigationMongoDefaultProfile, database_name: target.database_name || "" },
      collections_used: ["tt_opname", "tt_barang_saldo"],
      filters,
      summary: { report_profile: "nagagold_stock_opname", opname_count: opnameRows.length, saldo_count: saldoRows.length, difference_count: findings.length, returned_count: findings.length, truncated: opnameRows.length > maxRows },
      evidence: { rows: findings.slice(0, maxRows) },
      findings: findings.slice(0, maxRows),
      warnings: ["tt_opname.status_barang OPEN berarti barcode belum terkonfirmasi pada proses opname.", "Perbandingan ini memakai tanggal opname, kode_gudang, dan kode_toko sebagai kode baki/posisi; kode_toko bukan nama cabang.", ...(opnameRows.length > maxRows ? [`Hasil dibatasi ${maxRows} baris.`] : [])],
      query_hash: buildQueryHash({ operationId, domain: normalizedDomain, filters }),
      duration_ms: Date.now() - startedAt,
      instruction_to_agent: findings.length ? "Gunakan heading TEMUAN, EVIDENCE, KEMUNGKINAN PENYEBAB, dan SARAN PERBAIKAN. Sebutkan barcode, tanggal, gudang, baki, status opname, nilai opname, nilai saldo, dan selisih. Jangan mengubah database." : "Jelaskan bahwa tidak ditemukan ketidaksesuaian opname dan saldo pada scope yang diperiksa.",
    };
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, result });
    return result;
  } catch (error) {
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, error });
    throw error;
  }
}

/**
 * Reconciliation read-only untuk hancur barang manual. NAGAGOLD menyimpan
 * transaksi pada tt_hancur_barang_manual dan controller mengisi saldo manual
 * pada tt_barang_saldo_manual melalui field stock_hancur/berat_hancur serta
 * mengosongkan stock_akhir/berat_akhir.
 */
export async function inspectHancurVsSaldo({ domain, params = {}, trainingId = "", helpdeskUser }) {
  const startedAt = Date.now();
  const operationId = "stock.hancur_vs_saldo";
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const tanggal_awal = normalizeDate(params.tanggal_awal);
  const tanggal_akhir = normalizeDate(params.tanggal_akhir);
  if (tanggal_awal > tanggal_akhir) throw investigationError("tanggal_awal harus lebih kecil atau sama dengan tanggal_akhir.", "INVESTIGATION_DATE_ORDER_INVALID");
  const no_hancur = clean(params.no_hancur, 160);
  const kode_barcode = clean(params.kode_barcode, 120);
  const kode_gudang = clean(params.kode_gudang, 80);
  const kode_toko = resolveKodeBaki(params);
  const maxRows = Math.min(Math.max(Number(params.max_rows) || env.investigationMaxRows, 1), 200);
  const filters = { tanggal_awal, tanggal_akhir, ...(no_hancur ? { no_hancur } : {}), ...(kode_barcode ? { kode_barcode } : {}), ...(kode_gudang ? { kode_gudang } : {}), ...(kode_toko ? { kode_baki: kode_toko } : {}) };
  try {
    const target = await findTarget(normalizedDomain);
    const client = await getInvestigationClient(target.connection_profile);
    const targetDb = client.db(target.database_name || env.investigationMongoDb);
    const timeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
    // Pada flow manual NAGAGOLD, kode_dept pada form hancur dipakai sebagai
    // kode barcode saat saldoBarangManual.hancurBy dipanggil.
    const hancurRows = await targetDb.collection("tt_hancur_barang_manual").aggregate([
      { $match: { tgl_system: { $gte: tanggal_awal, $lte: tanggal_akhir }, ...(no_hancur ? { no_hancur } : {}), ...(kode_barcode ? { kode_dept: kode_barcode } : {}), ...(kode_gudang ? { kode_gudang } : {}), ...(kode_toko ? { kode_toko } : {}) } },
      { $group: { _id: { tanggal: "$tgl_system", kode_barcode: "$kode_dept", kode_gudang: "$kode_gudang", kode_toko: "$kode_toko" }, stock: { $sum: amountExpression("$stock") }, berat: { $sum: amountExpression("$berat") }, no_hancur: { $addToSet: "$no_hancur" }, row_count: { $sum: 1 } } },
      { $sort: { "_id.tanggal": 1, "_id.kode_barcode": 1 } },
      { $limit: maxRows + 1 },
    ], { maxTimeMS: timeout, allowDiskUse: true }).toArray();
    const visibleHancur = hancurRows.slice(0, maxRows);
    const saldoOr = visibleHancur.map((row) => ({ tanggal: row._id.tanggal, kode_barcode: row._id.kode_barcode, kode_gudang: row._id.kode_gudang, kode_toko: row._id.kode_toko }));
    const saldoRows = saldoOr.length ? await targetDb.collection("tt_barang_saldo_manual").find({ $or: saldoOr }, { projection: { _id: 0, tanggal: 1, kode_barcode: 1, kode_gudang: 1, kode_toko: 1, stock_hancur: 1, berat_hancur: 1, stock_akhir: 1, berat_akhir: 1 } }).maxTimeMS(timeout).toArray() : [];
    const saldoByKey = new Map(saldoRows.map((row) => [JSON.stringify({ tanggal: row.tanggal, kode_barcode: row.kode_barcode, kode_gudang: row.kode_gudang, kode_toko: row.kode_toko }), row]));
    const findings = [];
    for (const row of visibleHancur) {
      const id = row._id;
      const saldo = saldoByKey.get(JSON.stringify({ tanggal: id.tanggal, kode_barcode: id.kode_barcode, kode_gudang: id.kode_gudang, kode_toko: id.kode_toko })) || null;
      const classification = classifyHancurSaldoFinding({ hancur: row, saldo });
      if (classification) findings.push({ ...classification, tanggal: id.tanggal, no_hancur: row.no_hancur || [], kode_barcode: id.kode_barcode, kode_gudang: id.kode_gudang, kode_baki: id.kode_toko, transaction: { stock: numberValue(row.stock), berat: numberValue(row.berat) }, saldo: saldo ? { stock_hancur: numberValue(saldo.stock_hancur), berat_hancur: numberValue(saldo.berat_hancur), stock_akhir: numberValue(saldo.stock_akhir), berat_akhir: numberValue(saldo.berat_akhir) } : null });
    }
    const result = {
      read_only: true,
      status: findings.length ? "difference_found" : "no_difference",
      operation_id: operationId,
      operation_name: "Hancur Barang vs Saldo Manual",
      target: { domain: normalizedDomain, tenant_id: target.tenant_id || normalizedDomain, connection_profile: target.connection_profile || env.investigationMongoDefaultProfile, database_name: target.database_name || "" },
      collections_used: ["tt_hancur_barang_manual", "tt_barang_saldo_manual"],
      filters,
      summary: { report_profile: "nagagold_hancur_barang_manual", hancur_count: hancurRows.length, saldo_count: saldoRows.length, difference_count: findings.length, returned_count: findings.length, truncated: hancurRows.length > maxRows },
      evidence: { rows: findings.slice(0, maxRows) },
      findings: findings.slice(0, maxRows),
      warnings: ["Flow hancur manual NAGAGOLD menghubungkan tt_hancur_barang_manual.kode_dept ke tt_barang_saldo_manual.kode_barcode.", "Saldo setelah hancur diharapkan memiliki stock_akhir dan berat_akhir nol. Hasil ini read-only; tidak ada update otomatis.", ...(hancurRows.length > maxRows ? [`Hasil dibatasi ${maxRows} baris.`] : [])],
      query_hash: buildQueryHash({ operationId, domain: normalizedDomain, filters }),
      duration_ms: Date.now() - startedAt,
      instruction_to_agent: findings.length ? "Gunakan heading TEMUAN, EVIDENCE, KEMUNGKINAN PENYEBAB, dan SARAN PERBAIKAN. Tampilkan nomor hancur, barcode, transaksi hancur, stock_hancur/berat_hancur saldo, sisa stock_akhir/berat_akhir, dan selisih. Jangan mengubah database." : "Jelaskan bahwa tidak ditemukan ketidaksesuaian transaksi hancur dengan saldo manual pada scope yang diperiksa.",
    };
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, result });
    return result;
  } catch (error) {
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, error });
    throw error;
  }
}

/**
 * Reconciliation read-only untuk hutang dan cicilan terhadap tt_cash_daily.
 * Identifier transaksi disamakan dengan tt_cash_daily.deskripsi. Kategori cash
 * mengikuti literal yang dipakai controller NAGAGOLD dan tidak mengeksekusi
 * query write atau mengubah status transaksi.
 */
export async function inspectDebtVsCash({ domain, params = {}, trainingId = "", helpdeskUser }) {
  const startedAt = Date.now();
  const operationId = "finance.debt_vs_cash";
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const tanggal_awal = normalizeDate(params.tanggal_awal);
  const tanggal_akhir = normalizeDate(params.tanggal_akhir);
  if (tanggal_awal > tanggal_akhir) throw investigationError("tanggal_awal harus lebih kecil atau sama dengan tanggal_akhir.", "INVESTIGATION_DATE_ORDER_INVALID");
  const identifier = clean(params.identifier || params.no_faktur_hutang || params.no_faktur_cicil, 160);
  const jenis_transaksi = clean(params.jenis_transaksi, 20).toLowerCase();
  const maxRows = Math.min(Math.max(Number(params.max_rows) || env.investigationMaxRows, 1), 200);
  const filters = { tanggal_awal, tanggal_akhir, ...(identifier ? { identifier } : {}), ...(jenis_transaksi ? { jenis_transaksi } : {}) };
  try {
    const target = await findTarget(normalizedDomain);
    const client = await getInvestigationClient(target.connection_profile);
    const targetDb = client.db(target.database_name || env.investigationMongoDb);
    const timeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
    const hutangMatch = { tgl_system: { $gte: tanggal_awal, $lte: tanggal_akhir }, ...(identifier && (!jenis_transaksi || jenis_transaksi === "hutang" || jenis_transaksi === "all") ? { no_faktur_hutang: identifier } : {}) };
    const cicilanMatch = { tgl_system: { $gte: tanggal_awal, $lte: tanggal_akhir }, ...(identifier && (!jenis_transaksi || jenis_transaksi === "cicilan" || jenis_transaksi === "all") ? { no_faktur_cicil: identifier } : {}) };
    const [hutangRows, cicilanRows] = await Promise.all([
      jenis_transaksi === "cicilan" ? [] : targetDb.collection("tt_hutang_detail").find(hutangMatch, { projection: { _id: 0, no_faktur_hutang: 1, tgl_system: 1, tgl_lunas: 1, jumlah_hutang: 1, total_bayar: 1, bunga_terbayar: 1, status_hutang: 1 } }).limit(maxRows + 1).maxTimeMS(timeout).toArray(),
      jenis_transaksi === "hutang" ? [] : targetDb.collection("tt_cicilan").find(cicilanMatch, { projection: { _id: 0, no_faktur_cicil: 1, tgl_system: 1, harga_jual_cicil: 1, dp_rp: 1, sisa_bayar: 1, nilai_angsuran: 1, cicilan_terbayar: 1, status: 1 } }).limit(maxRows + 1).maxTimeMS(timeout).toArray(),
    ]);
    const sourceRows = [...hutangRows.slice(0, maxRows).map((row) => ({ kind: "hutang", key: row.no_faktur_hutang, source: row })), ...cicilanRows.slice(0, maxRows).map((row) => ({ kind: "cicilan", key: row.no_faktur_cicil, source: row }))];
    const keys = sourceRows.map((row) => row.key).filter(Boolean);
    const cashRows = keys.length ? await targetDb.collection("tt_cash_daily").aggregate([
      { $match: { tanggal: { $gte: tanggal_awal, $lte: tanggal_akhir }, status: "OPEN", deskripsi: { $in: keys } } },
      { $group: { _id: { identifier: "$deskripsi", kategori: "$kategori" }, jumlah_in: { $sum: amountExpression("$jumlah_in") }, jumlah_out: { $sum: amountExpression("$jumlah_out") }, count: { $sum: 1 }, tanggal: { $addToSet: "$tanggal" } } },
    ], { maxTimeMS: timeout, allowDiskUse: true }).toArray() : [];
    const cashByKey = new Map();
    for (const row of cashRows) {
      const key = cleanFinanceKey(row?._id?.identifier);
      const category = clean(row?._id?.kategori, 100).toUpperCase() || "UNKNOWN";
      const item = cashByKey.get(key) || { categories: {} };
      item.categories[category] = { jumlah_in: numberValue(row.jumlah_in), jumlah_out: numberValue(row.jumlah_out), count: numberValue(row.count), tanggal: row.tanggal || [] };
      cashByKey.set(key, item);
    }
    const findings = [];
    for (const row of sourceRows) {
      const cash = cashByKey.get(row.key) || { categories: {} };
      const classification = classifyDebtCashFinding({ source: row.source, kind: row.kind, cash });
      if (classification) findings.push(compactDebtCashFinding({ key: row.key, kind: row.kind, source: row.source, cash, classification }));
    }
    const result = {
      read_only: true,
      status: findings.length ? "difference_found" : "no_difference",
      operation_id: operationId,
      operation_name: "Hutang/Cicilan vs Cash",
      target: { domain: normalizedDomain, tenant_id: target.tenant_id || normalizedDomain, connection_profile: target.connection_profile || env.investigationMongoDefaultProfile, database_name: target.database_name || "" },
      collections_used: ["tt_hutang_detail", "tt_cicilan", "tt_cash_daily"],
      filters,
      summary: { report_profile: "nagagold_debt_installment_cash", hutang_count: hutangRows.length, cicilan_count: cicilanRows.length, cash_identifier_count: cashByKey.size, difference_count: findings.length, returned_count: findings.length, truncated: hutangRows.length > maxRows || cicilanRows.length > maxRows },
      evidence: { rows: findings.slice(0, maxRows) },
      findings: findings.slice(0, maxRows),
      warnings: ["Relasi transaksi ke cash memakai no_faktur_hutang/no_faktur_cicil = tt_cash_daily.deskripsi.", "Kategori utama hutang: HUTANG, HUTANG LUNAS, HUTANG BATAL, BATAL HUTANG LUNAS, dan BAYAR BUNGA.", "Kategori utama cicilan: DP CICILAN, BAYAR CICILAN, PELUNASAN CEPAT CICILAN, dan BATAL CICILAN.", "Tanggal hutang/cicilan memakai tgl_system, sedangkan cash memakai tanggal; perbedaan hari perlu diperiksa sebagai date shift.", ...(hutangRows.length > maxRows || cicilanRows.length > maxRows ? [`Hasil dibatasi ${maxRows} baris per jenis transaksi.`] : [])],
      query_hash: buildQueryHash({ operationId, domain: normalizedDomain, filters }),
      duration_ms: Date.now() - startedAt,
      instruction_to_agent: findings.length ? "Gunakan heading TEMUAN, EVIDENCE, KEMUNGKINAN PENYEBAB, dan SARAN PERBAIKAN. Bedakan hutang dan cicilan, tampilkan identifier, status, expected, actual cash, kategori cash, dan selisih. Jangan mengubah database." : "Jelaskan bahwa tidak ditemukan ketidaksesuaian hutang/cicilan dan cash pada scope tanggal/status yang diperiksa.",
    };
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, result });
    return result;
  } catch (error) {
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, error });
    throw error;
  }
}

/**
 * Reconciliation read-only untuk pembelian kembali dari customer (buyback).
 * Logic ini mengikuti tt_beli_detail dan arus cash PEMBELIAN NAGAGOLD.
 * Kategori cash dapat terenkripsi pada database asli; bila tidak dapat dibaca,
 * relasi deskripsi tetap digunakan tetapi hasil diberi warning dan tidak
 * mengklaim kategori cash tertentu.
 */
export async function inspectBuybackVsCash({ domain, params = {}, trainingId = "", helpdeskUser }) {
  const startedAt = Date.now();
  const operationId = "finance.buyback_vs_cash";
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const tanggal_awal = normalizeDate(params.tanggal_awal);
  const tanggal_akhir = normalizeDate(params.tanggal_akhir);
  if (tanggal_awal > tanggal_akhir) {
    throw investigationError("tanggal_awal harus lebih kecil atau sama dengan tanggal_akhir.", "INVESTIGATION_DATE_ORDER_INVALID");
  }
  const no_faktur_group = clean(params.no_faktur_group, 160);
  const no_faktur_beli = clean(params.no_faktur_beli, 160);
  const kode_barcode = clean(params.kode_barcode, 120);
  const kode_gudang = clean(params.kode_gudang, 80);
  const maxRows = Math.min(Math.max(Number(params.max_rows) || env.investigationMaxRows, 1), 200);
  const filters = {
    tanggal_awal,
    tanggal_akhir,
    ...(no_faktur_group ? { no_faktur_group } : {}),
    ...(no_faktur_beli ? { no_faktur_beli } : {}),
    ...(kode_barcode ? { kode_barcode } : {}),
    ...(kode_gudang ? { kode_gudang } : {}),
  };

  try {
    const target = await findTarget(normalizedDomain);
    const client = await getInvestigationClient(target.connection_profile);
    const targetDb = client.db(target.database_name || env.investigationMongoDb);
    const timeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
    const buybackMatch = {
      tgl_system: { $gte: tanggal_awal, $lte: tanggal_akhir },
      status_valid: "DONE",
      ...(no_faktur_group ? { no_faktur_group } : {}),
      ...(no_faktur_beli ? { no_faktur_beli } : {}),
      ...(kode_barcode ? { kode_barcode } : {}),
      ...(kode_gudang ? { kode_gudang } : {}),
    };

    const [buybackAggregate, cancellationRows] = await Promise.all([
      targetDb.collection("tt_beli_detail").aggregate([
        { $match: buybackMatch },
        {
          $facet: {
            invoices: [
              {
                $group: {
                  _id: "$no_faktur_group",
                  buyback_total: { $sum: amountExpression("$harga") },
                  item_count: { $sum: 1 },
                  total_berat: { $sum: amountExpression("$berat") },
                  no_faktur_beli: { $addToSet: "$no_faktur_beli" },
                  kode_barcode: { $addToSet: "$kode_barcode" },
                  kode_gudang: { $addToSet: "$kode_gudang" },
                  tanggal: { $addToSet: "$tgl_system" },
                },
              },
              { $match: { _id: { $nin: [null, ""] } } },
              { $sort: { _id: 1 } },
              { $limit: maxRows + 1 },
            ],
            payments: [
              { $unwind: { path: "$pembayaran", preserveNullAndEmptyArrays: false } },
              {
                $group: {
                  _id: { group: "$no_faktur_group", jenis: "$pembayaran.jenis" },
                  total_payment: { $sum: amountExpression("$pembayaran.jumlah_rp") },
                },
              },
              { $match: { "_id.group": { $nin: [null, ""] } } },
            ],
          },
        },
      ], { maxTimeMS: timeout, allowDiskUse: true }).toArray(),
      targetDb.collection("tt_beli_batal").aggregate([
        {
          $match: {
            tgl_system: { $gte: tanggal_awal, $lte: tanggal_akhir },
            ...(no_faktur_group ? { no_faktur_group } : {}),
            ...(no_faktur_beli ? { no_faktur_beli } : {}),
            ...(kode_gudang ? { kode_gudang } : {}),
          },
        },
        {
          $group: {
            _id: "$no_faktur_group",
            total_batal: { $sum: amountExpression("$harga") },
            count: { $sum: 1 },
            no_faktur_beli: { $addToSet: "$no_faktur_beli" },
            status_valid: { $addToSet: "$status_valid" },
          },
        },
        { $match: { _id: { $nin: [null, ""] } } },
        { $limit: maxRows + 1 },
      ], { maxTimeMS: timeout, allowDiskUse: true }).toArray(),
    ]);

    const facet = buybackAggregate[0] || {};
    const buybackByGroup = new Map((facet.invoices || []).map((row) => [cleanFinanceKey(row._id), row]));
    const paymentsByGroup = new Map();
    for (const row of facet.payments || []) {
      const key = cleanFinanceKey(row?._id?.group);
      if (!key) continue;
      const item = paymentsByGroup.get(key) || { total: 0, by_type: {} };
      const jenis = cleanFinanceKey(row?._id?.jenis).toUpperCase() || "UNKNOWN";
      item.total += numberValue(row.total_payment);
      item.by_type[jenis] = (item.by_type[jenis] || 0) + numberValue(row.total_payment);
      paymentsByGroup.set(key, item);
    }

    const cancellationByGroup = new Map((cancellationRows || []).map((row) => [cleanFinanceKey(row._id), {
      total_batal: numberValue(row.total_batal),
      count: numberValue(row.count),
      no_faktur_beli: row.no_faktur_beli || [],
      status_valid: row.status_valid || [],
    }]));
    const groupKeys = [...buybackByGroup.keys()];
    const cashMatch = {
      tanggal: { $gte: tanggal_awal, $lte: tanggal_akhir },
      status: "OPEN",
      ...(no_faktur_group ? { deskripsi: no_faktur_group } : {}),
    };
    const cashRows = await targetDb.collection("tt_cash_daily").aggregate([
      { $match: cashMatch },
      { $limit: Math.min(maxRows * 20, 4000) },
      {
        $group: {
          _id: { group: "$deskripsi", kategori: "$kategori" },
          cash_in: { $sum: amountExpression("$jumlah_in") },
          cash_out: { $sum: amountExpression("$jumlah_out") },
          count: { $sum: 1 },
        },
      },
      { $limit: Math.min(maxRows * 5, 1000) },
    ], { maxTimeMS: timeout, allowDiskUse: true }).toArray();

    const cashByGroup = new Map();
    for (const row of cashRows) {
      const key = cleanFinanceKey(row?._id?.group);
      if (!key) continue;
      const item = cashByGroup.get(key) || { cash_in: 0, cash_out: 0, categories: {}, unknown_category_count: 0 };
      const category = normalizeKnownCashCategory(row?._id?.kategori);
      const isKnownBuybackCash = category !== "UNKNOWN";
      const isRelatedGroup = buybackByGroup.has(key) || key === no_faktur_group;
      // Tanpa nomor group, jangan menganggap setiap cash harian sebagai
      // buyback. Cash berkategori PEMBELIAN yang terbaca boleh menjadi
      // kandidat cash-only; kategori terenkripsi hanya boleh dipakai bila
      // relasinya sudah terbukti melalui no_faktur_group.
      if (!isRelatedGroup && !isKnownBuybackCash) continue;
      item.cash_in += numberValue(row.cash_in);
      item.cash_out += numberValue(row.cash_out);
      if (category === "UNKNOWN") item.unknown_category_count += numberValue(row.count);
      else {
        item.categories[category] = item.categories[category] || { cash_in: 0, cash_out: 0, count: 0 };
        item.categories[category].cash_in += numberValue(row.cash_in);
        item.categories[category].cash_out += numberValue(row.cash_out);
        item.categories[category].count += numberValue(row.count);
      }
      cashByGroup.set(key, item);
    }

    const findings = [];
    const evidenceRows = [];
    for (const key of [...new Set([...buybackByGroup.keys(), ...cashByGroup.keys()])].sort()) {
      const buyback = buybackByGroup.get(key) || null;
      const cash = cashByGroup.get(key) || null;
      const cancellation = cancellationByGroup.get(key) || null;
      const payment = paymentsByGroup.get(key) || { total: 0, by_type: {} };
      const classification = classifyBuybackCashFinding({
        buyback,
        cash,
        expectedPayment: payment.total,
        buybackTotal: numberValue(buyback?.buyback_total),
        cancellationTotal: numberValue(cancellation?.total_batal),
      });
      if (classification) {
        const finding = compactBuybackFinding({
          key,
          buyback: buyback ? { ...buyback, payment_by_type: payment.by_type } : null,
          cash,
          cancellation,
          expectedPayment: payment.total || numberValue(buyback?.buyback_total),
          classification,
        });
        findings.push(finding);
        evidenceRows.push(finding);
      }
    }

    const truncated = findings.length > maxRows;
    const visibleFindings = findings.slice(0, maxRows);
    const warnings = [
      "Pembelian yang diperiksa adalah buyback dari customer berdasarkan tt_beli_detail, bukan pembelian supplier.",
      "Cash dicari melalui tt_cash_daily.deskripsi = tt_beli_detail.no_faktur_group dengan status OPEN.",
      "Pencarian cash tanpa nomor group dibatasi agar tidak membebani database; jika periode terlalu besar, persempit tanggal atau nomor faktur group.",
      "Jika kategori cash tidak terbaca karena enkripsi NAGAGOLD, total arus tetap ditampilkan sebagai evidence tetapi kategori tidak boleh ditebak.",
      "Pembatalan buyback dapat memakai deskripsi cash berbeda (BATAL BELI/BATAL PEMBELIAN), sehingga perlu pemeriksaan lanjutan berdasarkan nomor faktur.",
      ...(truncated ? [`Hasil dibatasi ${maxRows} transaksi buyback.`] : []),
    ];
    const queryHash = buildQueryHash({ operationId, domain: normalizedDomain, filters });
    const result = {
      read_only: true,
      status: visibleFindings.length ? "difference_found" : "no_difference",
      operation_id: operationId,
      operation_name: "Selisih Buyback Customer dan Keuangan",
      target: {
        domain: normalizedDomain,
        tenant_id: target.tenant_id || normalizedDomain,
        connection_profile: target.connection_profile || env.investigationMongoDefaultProfile,
        database_name: target.database_name || "",
      },
      collections_used: ["tt_beli_detail", "tt_beli_batal", "tt_cash_daily"],
      filters,
      summary: {
        report_profile: "nagagold_buyback_cash",
        buyback_group_count: buybackByGroup.size,
        cash_group_count: cashByGroup.size,
        difference_count: findings.length,
        returned_count: visibleFindings.length,
        truncated,
      },
      evidence: { rows: visibleFindings },
      findings: visibleFindings,
      warnings,
      query_hash: queryHash,
      duration_ms: Date.now() - startedAt,
      instruction_to_agent: visibleFindings.length
        ? "Gunakan heading TEMUAN, EVIDENCE, KEMUNGKINAN PENYEBAB, dan SARAN PERBAIKAN. Jelaskan bahwa pembelian adalah buyback customer. Tampilkan nomor faktur group, nominal buyback, pembayaran, cash keluar bersih, pembatalan, dan selisih. Jangan mengubah database."
        : "Jelaskan bahwa tidak ditemukan selisih pada scope buyback dan cash yang diperiksa; jangan menyimpulkan semua laporan pasti benar di luar scope tersebut.",
    };
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, result });
    return result;
  } catch (error) {
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, error });
    throw error;
  }
}

export async function inspectBuybackVsStock({ domain, params = {}, trainingId = "", helpdeskUser }) {
  const startedAt = Date.now();
  const operationId = "stock.buyback_vs_saldo";
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const tanggal_awal = normalizeDate(params.tanggal_awal);
  const tanggal_akhir = normalizeDate(params.tanggal_akhir);
  if (tanggal_awal > tanggal_akhir) {
    throw investigationError("tanggal_awal harus lebih kecil atau sama dengan tanggal_akhir.", "INVESTIGATION_DATE_ORDER_INVALID");
  }
  const kode_barcode = clean(params.kode_barcode, 120);
  const kode_gudang = clean(params.kode_gudang, 80);
  const maxRows = Math.min(Math.max(Number(params.max_rows) || env.investigationMaxRows, 1), 200);
  const filters = { tanggal_awal, tanggal_akhir, ...(kode_barcode ? { kode_barcode } : {}), ...(kode_gudang ? { kode_gudang } : {}) };

  try {
    const target = await findTarget(normalizedDomain);
    const client = await getInvestigationClient(target.connection_profile);
    const targetDb = client.db(target.database_name || env.investigationMongoDb);
    const timeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
    const buybackRows = await targetDb.collection("tt_beli_detail").aggregate([
      {
        $match: {
          tgl_system: { $gte: tanggal_awal, $lte: tanggal_akhir },
          status_valid: "DONE",
          ...(kode_barcode ? { kode_barcode } : {}),
          ...(kode_gudang ? { kode_gudang } : {}),
        },
      },
      {
        $group: {
          _id: { tanggal: "$tgl_system", kode_barcode: "$kode_barcode", kode_gudang: "$kode_gudang" },
          buyback_qty: { $sum: 1 },
          buyback_weight: { $sum: amountExpression("$berat") },
          no_faktur_group: { $addToSet: "$no_faktur_group" },
          no_faktur_beli: { $addToSet: "$no_faktur_beli" },
        },
      },
      { $sort: { "_id.tanggal": 1, "_id.kode_barcode": 1, "_id.kode_gudang": 1 } },
      { $limit: maxRows + 1 },
    ], { maxTimeMS: timeout, allowDiskUse: true }).toArray();

    const combos = buybackRows.slice(0, maxRows).map((row) => row._id).filter((item) => item?.kode_barcode);
    const saldoRows = combos.length
      ? await targetDb.collection("tt_barang_saldo").find({
          $or: combos.map((item) => ({ tanggal: item.tanggal, kode_barcode: item.kode_barcode, ...(item.kode_gudang ? { kode_gudang: item.kode_gudang } : {}) })),
        }, {
          projection: projectionFor(["tanggal", "kode_barcode", "kode_gudang", "kode_toko", "stock_beli", "berat_beli", "stock_in", "berat_in", "stock_akhir", "berat_akhir"]),
          maxTimeMS: timeout,
        }).limit(maxRows * 3).toArray()
      : [];
    const saldoByKey = new Map();
    for (const row of saldoRows) {
      const key = `${row.tanggal}|${row.kode_barcode}|${row.kode_gudang || ""}`;
      const item = saldoByKey.get(key) || { stock_beli: 0, berat_beli: 0, stock_in: 0, berat_in: 0, stock_akhir: 0, berat_akhir: 0, row_count: 0 };
      item.stock_beli += numberValue(row.stock_beli);
      item.berat_beli += numberValue(row.berat_beli);
      item.stock_in += numberValue(row.stock_in);
      item.berat_in += numberValue(row.berat_in);
      item.stock_akhir += numberValue(row.stock_akhir);
      item.berat_akhir += numberValue(row.berat_akhir);
      item.row_count += 1;
      saldoByKey.set(key, item);
    }
    const findings = [];
    const evidence = [];
    for (const row of combos) {
      const key = `${row.tanggal}|${row.kode_barcode}|${row.kode_gudang || ""}`;
      const buyback = buybackRows.find((item) => item?._id?.tanggal === row.tanggal && item?._id?.kode_barcode === row.kode_barcode && (item?._id?.kode_gudang || "") === (row.kode_gudang || ""));
      const saldo = saldoByKey.get(key) || null;
      const expectedQty = numberValue(buyback?.buyback_qty);
      const expectedWeight = numberValue(buyback?.buyback_weight);
      const actualQty = numberValue(saldo?.stock_beli);
      const actualWeight = numberValue(saldo?.berat_beli);
      const qtyDifference = actualQty - expectedQty;
      const weightDifference = actualWeight - expectedWeight;
      let code = "";
      let message = "";
      if (!saldo) {
        code = "SALDO_NOT_FOUND";
        message = "Buyback DONE ditemukan, tetapi baris saldo tanggal dan barcode tersebut tidak ditemukan.";
      } else if (Math.abs(qtyDifference) > 0.000001 || Math.abs(weightDifference) > 0.000001) {
        code = actualQty === 0 && actualWeight === 0 ? "BUYBACK_NOT_REFLECTED_IN_SALDO" : "PARTIAL_BUYBACK_STOCK_MUTATION";
        message = "Jumlah buyback tidak sama dengan mutasi stock_beli pada saldo barang.";
      }
      if (!code) continue;
      const finding = {
        code,
        message,
        tanggal: row.tanggal,
        kode_barcode: row.kode_barcode,
        kode_gudang: row.kode_gudang || "",
        no_faktur_group: buyback?.no_faktur_group || [],
        no_faktur_beli: buyback?.no_faktur_beli || [],
        expected: { stock_beli: expectedQty, berat_beli: expectedWeight },
        current: { stock_beli: actualQty, berat_beli: actualWeight, stock_in: numberValue(saldo?.stock_in), berat_in: numberValue(saldo?.berat_in), stock_akhir: numberValue(saldo?.stock_akhir), berat_akhir: numberValue(saldo?.berat_akhir) },
        difference: { stock_beli: qtyDifference, berat_beli: weightDifference },
        status_scope: { buyback_status_valid: "DONE", saldo_source: "tt_barang_saldo" },
      };
      findings.push(finding);
      evidence.push(finding);
    }
    const truncated = buybackRows.length > maxRows;
    const visibleFindings = findings.slice(0, maxRows);
    const queryHash = buildQueryHash({ operationId, domain: normalizedDomain, filters });
    const result = {
      read_only: true,
      status: visibleFindings.length ? "difference_found" : "no_difference",
      operation_id: operationId,
      operation_name: "Buyback Customer vs Saldo Barang",
      target: { domain: normalizedDomain, tenant_id: target.tenant_id || normalizedDomain, connection_profile: target.connection_profile || env.investigationMongoDefaultProfile, database_name: target.database_name || "" },
      collections_used: ["tt_beli_detail", "tt_barang_saldo"],
      filters,
      summary: { buyback_group_count: buybackRows.length, checked_count: combos.length, difference_count: findings.length, returned_count: visibleFindings.length, truncated },
      evidence: { rows: visibleFindings },
      findings: visibleFindings,
      warnings: [
        "Ekspektasi dihitung dari jumlah baris tt_beli_detail berstatus DONE dan berat buyback.",
        "Operation ini tidak mengubah tt_barang_saldo dan tidak menyimpulkan apakah patch aman tanpa memeriksa mutasi lain seperti transfer, opname, atau hancur.",
        ...(truncated ? [`Data buyback dibatasi ${maxRows} kombinasi pertama.`] : []),
      ],
      query_hash: queryHash,
      duration_ms: Date.now() - startedAt,
      instruction_to_agent: visibleFindings.length
        ? "Gunakan heading TEMUAN, EVIDENCE, KEMUNGKINAN PENYEBAB, dan SARAN PERBAIKAN. Tampilkan barcode, tanggal, gudang, expected stock_beli/berat_beli dari buyback, current dari tt_barang_saldo, dan selisih. Jangan mengubah database."
        : "Jelaskan bahwa buyback yang diperiksa sudah tercermin pada stock_beli saldo atau tidak ada data buyback dalam scope.",
    };
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, result });
    return result;
  } catch (error) {
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, error });
    throw error;
  }
}

const REPORT_VISIBILITY_SOURCES = {
  buyback: { collection: "tt_beli_detail", dateField: "tgl_system", identifierFields: ["no_faktur_group", "no_faktur_beli", "kode_barcode"], statusFields: ["status_valid"] },
  sales: { collection: "tt_jual_detail", dateField: "tgl_system", identifierFields: ["no_faktur_group", "no_faktur_jual", "kode_barcode"], statusFields: ["status_valid", "status_kembali"] },
  cash: { collection: "tt_cash_daily", dateField: "tanggal", identifierFields: ["deskripsi", "no_reff"], statusFields: ["status"] },
  service: { collection: "tt_service_detail", dateField: "tgl_system", identifierFields: ["no_faktur_group", "no_faktur_service"], statusFields: ["status_proses", "status_valid"] },
  debt: { collection: "tt_hutang_detail", dateField: "tgl_system", identifierFields: ["no_faktur_group", "no_faktur_hutang"], statusFields: ["status_hutang", "status_valid"] },
  // Sumber stock dipilih runtime berdasarkan tp_system.tgl_system. NAGAGOLD
  // memakai tt_barang_saldo untuk tanggal sistem aktif dan th_barang_saldo
  // untuk tanggal historis.
  stock: { collection: "th_barang_saldo", dateField: "tanggal", identifierFields: ["kode_barcode"], statusFields: [] },
};

function resolveStockReportSource({ tanggal_awal, tanggal_akhir, systemDate }) {
  const isCurrentStockDate = Boolean(systemDate)
    && tanggal_awal === systemDate
    && tanggal_akhir === systemDate;
  return {
    isCurrentStockDate,
    sourceMode: isCurrentStockDate ? "realtime" : "historical",
    source: {
      ...REPORT_VISIBILITY_SOURCES.stock,
      collection: isCurrentStockDate ? "tt_barang_saldo" : "th_barang_saldo",
    },
  };
}

export async function inspectReportVisibility({ domain, params = {}, trainingId = "", helpdeskUser }) {
  const startedAt = Date.now();
  const operationId = "report.visibility_diagnostic";
  const normalizedDomain = normalizeInvestigationDomain(domain);
  const report_context = clean(params.report_context, 40).toLowerCase();
  if (!REPORT_VISIBILITY_CONTEXTS.has(report_context)) {
    throw investigationError("report_context wajib salah satu dari buyback, sales, cash, service, debt, atau stock.", "INVESTIGATION_REPORT_CONTEXT_INVALID");
  }
  const sourceDefinition = REPORT_VISIBILITY_SOURCES[report_context];
  const tanggal_awal = normalizeDate(params.tanggal_awal);
  const tanggal_akhir = normalizeDate(params.tanggal_akhir);
  if (tanggal_awal > tanggal_akhir) throw investigationError("tanggal_awal harus lebih kecil atau sama dengan tanggal_akhir.", "INVESTIGATION_DATE_ORDER_INVALID");
  const identifier = clean(params.identifier, 160);
  const kode_gudang = clean(params.kode_gudang, 80);
  const maxRows = Math.min(Math.max(Number(params.max_rows) || env.investigationMaxRows, 1), 100);
  const filters = { report_context, tanggal_awal, tanggal_akhir, ...(identifier ? { identifier } : {}), ...(kode_gudang ? { kode_gudang } : {}) };
  try {
    const target = await findTarget(normalizedDomain);
    const client = await getInvestigationClient(target.connection_profile);
    const targetDb = client.db(target.database_name || env.investigationMongoDb);
    const timeout = Math.min(Math.max(env.investigationQueryTimeoutMs, 1000), 20000);
    const systemRow = report_context === "stock"
      ? await targetDb.collection("tp_system").findOne({}, { projection: { _id: 0, tgl_system: 1 }, maxTimeMS: timeout })
      : null;
    const systemDate = clean(systemRow?.tgl_system, 10);
    const stockSource = report_context === "stock"
      ? resolveStockReportSource({ tanggal_awal, tanggal_akhir, systemDate })
      : null;
    const isCurrentStockDate = stockSource?.isCurrentStockDate || false;
    const source = stockSource?.source || sourceDefinition;
    const sourceMode = stockSource?.sourceMode || "single_collection";
    const identifierFilter = identifier
      ? { $or: source.identifierFields.map((field) => ({ [field]: identifier })) }
      : {};
    const match = {
      [source.dateField]: { $gte: tanggal_awal, $lte: tanggal_akhir },
      ...identifierFilter,
      ...(kode_gudang && ["buyback", "stock"].includes(report_context) ? { kode_gudang } : {}),
    };
    const docs = await targetDb.collection(source.collection).aggregate([
      { $match: match },
      {
        $facet: {
          total: [{ $count: "count" }],
          statuses: source.statusFields.length
            ? [{ $project: Object.fromEntries(source.statusFields.map((field) => [field, 1])) }, { $limit: 1000 }]
            : [{ $limit: 1000 }],
          sample: [{ $project: { _id: 0, [source.dateField]: 1, ...Object.fromEntries(source.identifierFields.map((field) => [field, 1])), ...Object.fromEntries(source.statusFields.map((field) => [field, 1])) } }, { $limit: maxRows }],
        },
      },
    ], { maxTimeMS: timeout, allowDiskUse: false }).toArray();
    const facet = docs[0] || {};
    const count = numberValue(facet.total?.[0]?.count);
    const statusCounts = {};
    for (const row of facet.statuses || []) {
      for (const field of source.statusFields) {
        const value = clean(row?.[field], 80) || "(kosong)";
        statusCounts[`${field}:${value}`] = (statusCounts[`${field}:${value}`] || 0) + 1;
      }
    }
    const findings = [];
    if (!count) {
      findings.push({ code: "SOURCE_NOT_FOUND", message: `Tidak ada data pada ${source.collection} untuk filter report yang diberikan.` });
    } else {
      const excludedStatus = Object.entries(statusCounts).filter(([key]) => /:(OPEN|CANC|CLOS|DRAFT|INVALID)$/i.test(key));
      if (excludedStatus.length) findings.push({ code: "SOURCE_FOUND_STATUS_REVIEW", message: "Data sumber ditemukan, tetapi statusnya perlu dicocokkan dengan filter report yang dipakai.", status_counts: statusCounts });
        if (["buyback", "sales", "service", "debt"].includes(report_context) && identifier) {
        const groups = await targetDb.collection("tt_cash_daily").aggregate([
          { $match: { tanggal: { $gte: tanggal_awal, $lte: tanggal_akhir }, status: "OPEN", deskripsi: identifier } },
          { $count: "count" },
        ], { maxTimeMS: timeout, allowDiskUse: false }).toArray();
        if (!numberValue(groups[0]?.count)) findings.push({ code: "CASH_RELATION_NOT_FOUND", message: "Data sumber ditemukan, tetapi pasangan tt_cash_daily berdasarkan deskripsi belum ditemukan pada periode tersebut." });
      }
    }
    const result = {
      read_only: true,
      status: findings.some((item) => item.code === "SOURCE_NOT_FOUND") ? "not_found" : "completed",
      operation_id: operationId,
      operation_name: "Diagnosis Data Tidak Muncul di Report",
      target: { domain: normalizedDomain, tenant_id: target.tenant_id || normalizedDomain, connection_profile: target.connection_profile || env.investigationMongoDefaultProfile, database_name: target.database_name || "" },
      collections_used: [source.collection, ...(report_context === "stock" ? ["tp_system"] : []), ...(["buyback", "sales", "service", "debt"].includes(report_context) && identifier ? ["tt_cash_daily"] : [])],
      filters,
      summary: {
        source_collection: source.collection,
        source_mode: sourceMode,
        system_date: systemDate || null,
        source_count: count,
        status_counts: statusCounts,
        report_context,
      },
      evidence: { sample: facet.sample || [] },
      findings,
      warnings: [
        "Operation ini mendiagnosis keberadaan data dan filter dasar; hasil tidak otomatis membuktikan bug pada UI report.",
        "Jika report memakai profile khusus, filter status atau tanggal dapat berbeda dari profile umum.",
        ...(report_context === "stock"
          ? [systemDate
            ? isCurrentStockDate
              ? `Tanggal ${tanggal_awal} sama dengan tp_system.tgl_system. Sesuai logic NAGAGOLD, sumber saldo yang benar adalah tt_barang_saldo realtime.`
              : `Tanggal ${tanggal_awal} berbeda dari tp_system.tgl_system (${systemDate}). Sesuai logic NAGAGOLD, sumber saldo yang benar adalah th_barang_saldo historis.`
            : "tp_system.tgl_system tidak ditemukan; pemilihan sumber realtime/historis belum dapat dipastikan."]
          : []),
      ],
      query_hash: buildQueryHash({ operationId, domain: normalizedDomain, filters }),
      duration_ms: Date.now() - startedAt,
      instruction_to_agent: report_context === "stock"
        ? isCurrentStockDate
          ? "Jawab langsung: tanggal report sama dengan tp_system.tgl_system, sehingga pemeriksaan memakai tt_barang_saldo realtime. Jangan menyebut th_barang_saldo sebagai sumber utama dan jangan menyimpulkan histori kosong sebagai penyebab report hari ini kosong. Tampilkan source_count dan filter yang benar-benar diperiksa."
          : "Jawab langsung: tanggal report bukan tanggal system aktif, sehingga pemeriksaan memakai th_barang_saldo historis. Tampilkan source_count dan filter yang benar-benar diperiksa."
        : "Jawab ringkas dengan konteks report, collection sumber, filter, jumlah data, status, dan relasi yang ditemukan/tidak ditemukan. Jika data sumber tidak ada, jangan menebak penyebab di luar evidence.",
    };
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, result });
    return result;
  } catch (error) {
    await recordRun({ trainingId, helpdeskUser, domain: normalizedDomain, operationId, filters, error });
    throw error;
  }
}

export async function listInvestigationRuns({ trainingId, helpdeskUser }) {
  const db = await getDb();
  const rows = await db.collection(env.investigationRunCollection)
    .find({ training_id: trainingId, helpdesk_id: helpdeskUser.helpdesk_id }, {
      projection: { _id: 0, training_id: 1, operation_id: 1, domain: 1, filters: 1, status: 1, summary: 1, findings: 1, warnings: 1, duration_ms: 1, query_hash: 1, created_at: 1 },
      maxTimeMS: 5000,
    })
    .sort({ created_at: -1 })
    .limit(50)
    .toArray();
  return rows;
}

export const __investigationInternals = {
  buildDifferences,
  buildInvestigationStatus,
  buildRolloverCorrectionCandidate,
  compactRolloverRow,
  hasNonZeroMovement,
  numericSum,
  scopeFilter,
  stockScopeFilter,
  normalizeDate,
  resolveInvestigationDate,
  resolveKodeBaki,
  classifyServiceCashFinding,
  classifySalesCashFinding,
  compactFinanceFinding,
  classifyBuybackCashFinding,
  classifyOpnameSaldoFinding,
  classifyHancurSaldoFinding,
  classifyDebtCashFinding,
  normalizeKnownCashCategory,
  resolveStockReportSource,
};
