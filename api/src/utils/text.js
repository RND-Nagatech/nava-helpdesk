const STOP_WORDS = new Set([
  "apa", "apakah", "bagaimana", "gimana", "kenapa", "mengapa", "yang", "dan", "atau",
  "di", "ke", "dari", "untuk", "pada", "saya", "aku", "kami", "kita", "anda", "user",
  "ini", "itu", "jadi", "kok", "ya", "dong", "nya", "ada", "bisa", "dengan", "kalau",
  "ketika", "saat", "mau", "ingin", "tolong", "mohon", "cara", "udah", "udh", "sudah"
]);

// Token seperti ini membantu menjelaskan intent, tetapi terlalu umum untuk menjadi
// bukti bahwa sebuah artikel adalah direct match. Dipakai hanya untuk menilai
// specificity/evidence, bukan dibuang dari lexical search seluruhnya.
const LOW_INFORMATION_ROOTS = new Set([
  "lapor", "menu", "fungsi", "guna", "keguna", "kegunaan", "informasi", "fitur", "data", "proses",
  "transaksi", "barang", "program", "aplikasi", "sistem", "lihat", "buka",
  "tampil", "pakai", "guna", "laku", "maksud", "bukan", "tadi", "sebelum"
]);

const SYNONYMS = {
  gak: ["tidak"],
  ga: ["tidak"],
  nggak: ["tidak"],
  ngga: ["tidak"],
  error: ["kendala", "masalah"],
  masalah: ["kendala", "error"],
  print: ["cetak"],
  ngeprint: ["cetak"],
  cetak: ["print"],
  stok: ["stock"],
  stock: ["stok"],
  unduh: ["download"],
  download: ["unduh"],
  laporan: ["report"],
  report: ["laporan"],
  timbang: ["timbangan"],
  timbangan: ["timbang"],
  jual: ["penjualan"],
  beli: ["pembelian"],
  struk: ["nota", "faktur"],
  nota: ["struk", "faktur"],
  faktur: ["nota", "struk"],
  muncul: ["keluar"],
  keluar: ["muncul"],
  beres: ["selesai"],
  selesai: ["beres"],
  alat: ["perangkat"],
  perangkat: ["alat"],
  rekap: ["ringkasan", "summary"],
  ringkasan: ["rekap", "summary"],
  untung: ["keuntungan", "laba", "margin"],
  keuntungan: ["untung", "laba", "margin"],
  laba: ["keuntungan", "untung", "margin"],
  margin: ["keuntungan", "laba", "untung"],
};

export function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Stemmer ringan untuk retrieval Bahasa Indonesia. Ini bukan stemmer linguistik penuh;
// tujuannya hanya menyatukan variasi yang sangat umum seperti:
// batal / dibatalkan / membatalkan / pembatalan -> batal.
// Bentuk asli tetap dipertahankan sehingga exact-match tidak hilang.
const STEM_CACHE = new Map();
const TOKEN_FORMS_CACHE = new Map();
const TEXT_TOKEN_SET_CACHE = new Map();

export function stemIndonesianToken(value = "") {
  let token = normalizeText(value);
  if (STEM_CACHE.has(token)) return STEM_CACHE.get(token);
  if (!token || token.length <= 4) return token;

  for (const suffix of ["lah", "kah", "tah", "pun", "nya", "ku", "mu"]) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      token = token.slice(0, -suffix.length);
      break;
    }
  }

  if (token.endsWith("kan") && token.length > 6) token = token.slice(0, -3);
  else if (token.endsWith("an") && token.length > 5) token = token.slice(0, -2);

  const prefixRules = [
    ["meny", (rest) => `s${rest}`],
    ["peny", (rest) => `s${rest}`],
    ["meng", (rest) => rest],
    ["peng", (rest) => rest],
    ["men", (rest) => rest],
    ["pen", (rest) => rest],
    ["mem", (rest) => rest],
    ["pem", (rest) => rest],
    ["ber", (rest) => rest],
    ["ter", (rest) => rest],
    ["per", (rest) => rest],
    ["di", (rest) => rest],
    ["me", (rest) => rest],
    ["pe", (rest) => rest],
  ];

  for (const [prefix, transform] of prefixRules) {
    if (token.startsWith(prefix) && token.length - prefix.length >= 4 && token.length >= 7) {
      const candidate = transform(token.slice(prefix.length));
      if (candidate.length >= 4) token = candidate;
      break;
    }
  }

  STEM_CACHE.set(normalizeText(value), token);
  return token;
}

function tokenForms(token) {
  const normalized = normalizeText(token);
  if (!normalized) return new Set();
  if (TOKEN_FORMS_CACHE.has(normalized)) return TOKEN_FORMS_CACHE.get(normalized);

  const forms = new Set([normalized, stemIndonesianToken(normalized)]);
  for (const synonym of SYNONYMS[normalized] || []) {
    forms.add(normalizeText(synonym));
    forms.add(stemIndonesianToken(synonym));
  }

  const result = new Set([...forms].filter(Boolean));
  TOKEN_FORMS_CACHE.set(normalized, result);
  return result;
}

function textTokenSet(value = "") {
  const normalizedValue = normalizeText(value);
  if (TEXT_TOKEN_SET_CACHE.has(normalizedValue)) return TEXT_TOKEN_SET_CACHE.get(normalizedValue);

  const set = new Set();
  for (const token of normalizedValue.split(" ").filter(Boolean)) {
    for (const form of tokenForms(token)) set.add(form);
  }
  if (TEXT_TOKEN_SET_CACHE.size > 10000) TEXT_TOKEN_SET_CACHE.clear();
  TEXT_TOKEN_SET_CACHE.set(normalizedValue, set);
  return set;
}

function tokenMatchesSet(token, set) {
  for (const form of tokenForms(token)) {
    if (set.has(form)) return true;
  }
  return false;
}

function tokenRoot(token) {
  return stemIndonesianToken(token);
}

export function tokenize(value = "", { removeStopWords = true, expand = false } = {}) {
  let tokens = normalizeText(value).split(" ").filter(Boolean);
  // Normalisasi suffix percakapan Indonesia yang sangat umum: "struknya" -> "struk".
  tokens = tokens.map((token) => token.endsWith("nya") && token.length > 6 ? token.slice(0, -3) : token);
  if (removeStopWords) tokens = tokens.filter((token) => !STOP_WORDS.has(token));

  if (expand) {
    const extras = [];
    for (const token of tokens) {
      if (SYNONYMS[token]) extras.push(...SYNONYMS[token]);
      const stem = stemIndonesianToken(token);
      if (stem && stem !== token) extras.push(stem);
    }
    tokens.push(...extras);
  }

  return [...new Set(tokens)];
}

export function isLowInformationToken(token) {
  const root = tokenRoot(token);
  return LOW_INFORMATION_ROOTS.has(root) || LOW_INFORMATION_ROOTS.has(normalizeText(token));
}

export function importantQueryTokens(query) {
  const tokens = tokenize(query, { removeStopWords: true, expand: false });
  const distinctive = tokens.filter((token) => !isLowInformationToken(token));
  const selected = distinctive.length ? distinctive : tokens;

  const variants = [];
  for (const token of selected) {
    const root = stemIndonesianToken(token);
    if (root) variants.push(root);
    if (token !== root) variants.push(token);
  }
  return [...new Set(variants)].slice(0, 10);
}

// Gabungkan query hasil agent dengan istilah penting dari kalimat customer.
// Ini mencegah parafrase LLM membuang discriminator penting tanpa menambah model call.
export function mergeSearchQuery(rewrittenQuery = "", originalQuestion = "") {
  const rewritten = String(rewrittenQuery || "").trim();
  const original = String(originalQuestion || "").trim();
  if (!rewritten) return original.slice(0, 1200);
  if (!original) return rewritten.slice(0, 1200);

  const rewrittenSet = textTokenSet(rewritten);
  const originalTokens = tokenize(original, { removeStopWords: true, expand: false });
  const distinctive = originalTokens.filter((token) => !isLowInformationToken(token));
  const candidates = distinctive.length ? distinctive : originalTokens;
  const missing = candidates.filter((token) => !tokenMatchesSet(token, rewrittenSet));

  return [rewritten, ...missing].filter(Boolean).join(" ").slice(0, 1200);
}

export function articleSearchText(article) {
  const steps = (article.troubleshootingSteps || []).map((item) => item?.instruction || "");
  return [
    article.title,
    article.category,
    article.product,
    ...(article.symptoms || []),
    ...(article.tags || []),
    article.userResponseTemplate,
    ...steps,
  ].filter(Boolean).join(" ");
}

// Embedding sengaja hanya merepresentasikan IDENTITAS MASALAH/PERTANYAAN.
export function articleEmbeddingText(article) {
  return [
    `Judul masalah: ${article.title || "-"}`,
    `Gejala: ${(article.symptoms || []).join("; ") || "-"}`,
    `Kategori: ${article.category || "-"}`,
    `Produk: ${article.product || "-"}`,
    `Tag masalah: ${(article.tags || []).join(", ") || "-"}`,
  ].join("\n");
}

function comparableSequence(value = "") {
  return tokenize(value, { removeStopWords: true, expand: false })
    .map(stemIndonesianToken)
    .filter(Boolean)
    .join(" ");
}

// Skor khusus untuk mencocokkan MASALAH customer dengan title/symptoms/tags.
export function problemMatchScore(query, article) {
  const originalTokens = tokenize(query, { removeStopWords: true, expand: false });
  if (!originalTokens.length) {
    return {
      score: 0,
      coverage: 0,
      matchedTokens: [],
      distinctiveCoverage: 0,
      distinctiveMatchedTokens: [],
      distinctiveTokenCount: 0,
      titleCoverage: 0,
      titleDistinctiveCoverage: 0,
    };
  }

  const distinctiveTokens = originalTokens.filter((token) => !isLowInformationToken(token));
  const fields = [
    [article.title || "", 14],
    [(article.symptoms || []).join(" "), 12],
    [(article.tags || []).join(" "), 8],
    [article.category || "", 4],
  ];

  const matchedOriginal = new Set();
  let score = 0;

  for (const [text, weight] of fields) {
    const set = textTokenSet(text);
    if (!set.size) continue;

    for (const token of originalTokens) {
      if (tokenMatchesSet(token, set)) {
        score += weight;
        matchedOriginal.add(token);
      }
    }
  }

  const titleSet = textTokenSet(article.title || "");
  const symptomSet = textTokenSet((article.symptoms || []).join(" "));
  const titleMatches = originalTokens.filter((token) => tokenMatchesSet(token, titleSet));
  const symptomMatches = originalTokens.filter((token) => tokenMatchesSet(token, symptomSet));
  const titleDistinctiveMatches = distinctiveTokens.filter((token) => tokenMatchesSet(token, titleSet));
  const distinctiveMatches = distinctiveTokens.filter((token) => matchedOriginal.has(token));

  const queryComparable = comparableSequence(query);
  const titleComparable = comparableSequence(article.title || "");
  const symptomComparable = comparableSequence((article.symptoms || []).join(" "));
  if (queryComparable && titleComparable.includes(queryComparable)) score += 50;
  if (queryComparable && symptomComparable.includes(queryComparable)) score += 45;

  score += Math.min(titleMatches.length, 5) * 3;
  score += Math.min(symptomMatches.length, 5) * 2;
  // Istilah pembeda yang cocok langsung pada title lebih bernilai daripada token generik.
  score += Math.min(titleDistinctiveMatches.length, 4) * 8;

  const coverage = matchedOriginal.size / originalTokens.length;
  const distinctiveCoverage = distinctiveTokens.length
    ? distinctiveMatches.length / distinctiveTokens.length
    : coverage;
  const titleCoverage = titleMatches.length / originalTokens.length;
  const titleDistinctiveCoverage = distinctiveTokens.length
    ? titleDistinctiveMatches.length / distinctiveTokens.length
    : titleCoverage;

  return {
    score,
    coverage: Number(coverage.toFixed(4)),
    matchedTokens: [...matchedOriginal],
    distinctiveCoverage: Number(distinctiveCoverage.toFixed(4)),
    distinctiveMatchedTokens: [...new Set(distinctiveMatches)],
    distinctiveTokenCount: distinctiveTokens.length,
    titleCoverage: Number(titleCoverage.toFixed(4)),
    titleDistinctiveCoverage: Number(titleDistinctiveCoverage.toFixed(4)),
  };
}

export function lexicalScore(query, article) {
  const originalTokens = tokenize(query, { removeStopWords: true, expand: false });
  if (!originalTokens.length) {
    return { score: 0, coverage: 0, matchedTokens: [], distinctiveCoverage: 0 };
  }

  const queryTokens = tokenize(query, { removeStopWords: true, expand: true });
  const fields = [
    [article.title || "", 10],
    [(article.symptoms || []).join(" "), 8],
    [(article.tags || []).join(" "), 6],
    [article.userResponseTemplate || "", 5],
    [(article.troubleshootingSteps || []).map((x) => x?.instruction || "").join(" "), 4],
    [article.category || "", 2],
  ];

  const matchedExpanded = new Set();
  let score = 0;

  for (const [text, weight] of fields) {
    const set = textTokenSet(text);
    for (const token of queryTokens) {
      if (tokenMatchesSet(token, set)) {
        score += weight;
        matchedExpanded.add(token);
      }
    }
  }

  const matchedOriginal = originalTokens.filter((token) => {
    for (const matched of matchedExpanded) {
      const matchedForms = tokenForms(matched);
      if ([...tokenForms(token)].some((form) => matchedForms.has(form))) return true;
    }
    return false;
  });

  const distinctiveTokens = originalTokens.filter((token) => !isLowInformationToken(token));
  const distinctiveMatches = distinctiveTokens.filter((token) => matchedOriginal.includes(token));
  const coverage = matchedOriginal.length / originalTokens.length;
  const distinctiveCoverage = distinctiveTokens.length
    ? distinctiveMatches.length / distinctiveTokens.length
    : coverage;

  const queryComparable = comparableSequence(query);
  const titleComparable = comparableSequence(article.title || "");
  if (queryComparable && titleComparable.includes(queryComparable)) score += 30;

  return {
    score,
    coverage: Number(coverage.toFixed(4)),
    matchedTokens: [...new Set(matchedOriginal)],
    distinctiveCoverage: Number(distinctiveCoverage.toFixed(4)),
  };
}
