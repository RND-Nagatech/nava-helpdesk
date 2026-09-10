export function isGraphRecursionError(error) {
  return Boolean(
    error &&
      (error.lc_error_code === "GRAPH_RECURSION_LIMIT" ||
        error.code === "GRAPH_RECURSION_LIMIT" ||
        error.name === "GraphRecursionError" ||
        String(error.message || "").includes("Recursion limit"))
  );
}

export function effectiveRecursionLimit(configuredLimit, modelCallRunLimit) {
  // Satu model/tool interaction dapat memakai beberapa langkah graph.
  // Beri ruang lebih besar dari model-call budget agar model-call limiter
  // sempat menghentikan agent secara rapi sebelum hard recursion limit.
  const configured = Number(configuredLimit || 0);
  const modelLimit = Math.max(1, Number(modelCallRunLimit || 1));
  const recommended = modelLimit * 4 + 4;
  return Math.max(configured, recommended);
}

export function rawSearchSummary(result, { status = null } = {}) {
  const primaryDoc = result?.documents?.[0] || null;
  const evidenceStrength = result?.primaryEvidence?.strength || primaryDoc?.retrieval?.evidenceStrength || null;
  return {
    query: result?.query || "",
    found: Boolean(result?.found),
    confidence: Number(result?.confidence || 0),
    mode: result?.retrievalMode || null,
    vector: result?.vector || null,
    timing: result?.timing || null,
    status,
    evidence_strength: evidenceStrength,
    reused_primary: false,
    primary_article: primaryDoc
      ? {
          article_id: primaryDoc.articleId,
          title: primaryDoc.title,
          category: primaryDoc.category,
          retrieval: primaryDoc.retrieval,
        }
      : null,
    sources: (result?.documents || []).slice(0, 3).map((doc) => ({
      article_id: doc.articleId,
      title: doc.title,
      category: doc.category,
      retrieval: doc.retrieval,
    })),
    fallback_candidates: !result?.found
      ? (result?.candidates || []).slice(0, 3).map((doc) => ({
          article_id: doc.articleId,
          title: doc.title,
          category: doc.category,
          retrieval: doc.retrieval,
        }))
      : [],
  };
}

export function fallbackFromSearchState(runState) {
  const result = runState?.bestSearchResult || runState?.firstSearchResult || null;
  const primary = result?.documents?.[0] || null;
  const strength = result?.primaryEvidence?.strength || primary?.retrieval?.evidenceStrength || "none";

  if (result?.found && primary && strength === "strong") {
    const steps = (primary.troubleshootingSteps || [])
      .slice(0, 5)
      .map((step, index) => `${index + 1}. ${String(step.instruction || step.title || "").trim()}`)
      .filter((line) => !line.endsWith(". "));

    const intro = String(primary.userResponseTemplate || "").trim();
    const answer = [
      intro || `Panduan yang paling sesuai untuk kendala ini adalah: ${primary.title}.`,
      steps.length ? steps.join("\n") : "",
      "Jika langkah di atas sudah dicoba tetapi kendala masih terjadi, sampaikan hasilnya agar NAVA dapat melanjutkan pengecekan atau eskalasi.",
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      answer,
      mode: "primary_evidence",
      searches: [rawSearchSummary(result, { status: "recursion_fallback_primary" })],
    };
  }

  if (result?.found && primary) {
    return {
      // Ini hanya safety fallback ketika graph sudah berhenti karena recursion limit.
      // Pada flow normal, DeepSeek yang membuat klarifikasi secara kontekstual.
      // Jangan mengambil canned question dari knowledge.
      answer: "Saya sudah menemukan beberapa panduan yang mirip, tetapi belum cukup yakin mana yang paling tepat. Bisa jelaskan sedikit bagian yang ingin dilakukan atau apa yang terjadi saat Anda mencobanya?",
      mode: "clarification",
      searches: [rawSearchSummary(result, { status: "recursion_fallback_clarification" })],
    };
  }

  return {
    answer: "Saya belum menemukan panduan yang cukup spesifik untuk memastikan jawabannya. Bisa jelaskan sedikit apa yang ingin dilakukan atau apa yang terjadi saat Anda mencobanya? Jika setelah itu masih belum ada panduan yang sesuai, kendala perlu diteruskan ke helpdesk manusia.",
    mode: "clarification_or_escalation",
    searches: result ? [rawSearchSummary(result, { status: "recursion_fallback_no_evidence" })] : [],
  };
}
