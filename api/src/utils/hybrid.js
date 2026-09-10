const RRF_K = 60;

export function classifyEvidenceStrength(doc) {
  if (!doc?.retrieval) return "none";
  const problemCoverage = Number(doc.retrieval.problemCoverage || 0);
  const problemScore = Number(doc.retrieval.problemScore || 0);
  const distinctiveCoverage = Number(doc.retrieval.problemDistinctiveCoverage || 0);
  const distinctiveTokenCount = Number(doc.retrieval.problemDistinctiveTokenCount || 0);
  const titleDistinctiveCoverage = Number(doc.retrieval.titleDistinctiveCoverage || 0);
  const vectorScore = Number(doc.retrieval.vectorScore || 0);

  // Strong tidak boleh ditentukan hanya oleh kata generik seperti "laporan", "menu",
  // "fungsi", atau "barang". Jika query punya discriminator, discriminator itu harus ikut cocok.
  if (distinctiveTokenCount > 0) {
    if (
      distinctiveCoverage >= 0.67 &&
      problemCoverage >= 0.45 &&
      problemScore >= 35 &&
      (titleDistinctiveCoverage >= 0.5 || distinctiveCoverage >= 0.75)
    ) return "strong";

    if (vectorScore >= 0.94 && distinctiveCoverage >= 0.5) return "strong";
  } else if (problemCoverage >= 0.75 && problemScore >= 40) {
    return "strong";
  }

  if (
    (distinctiveTokenCount > 0 && distinctiveCoverage >= 0.34 && problemScore >= 20) ||
    problemCoverage >= 0.4 ||
    vectorScore >= 0.9
  ) return "medium";

  return "weak";
}

export function fuseHybridResults(
  lexicalDocs,
  vectorDocs,
  topK,
  { keywordWeight = 1, vectorWeight = 1.25, problemWeight = 3.0 } = {}
) {
  const merged = new Map();

  const getRow = (doc) => {
    const key = doc.articleId || doc.title;
    if (!merged.has(key)) {
      merged.set(key, {
        ...doc,
        retrieval: {
          lexicalScore: 0,
          coverage: 0,
          matchedTokens: [],
          lexicalDistinctiveCoverage: doc.lexical?.distinctiveCoverage || 0,
          problemScore: doc.problem?.score || 0,
          problemCoverage: doc.problem?.coverage || 0,
          problemMatchedTokens: doc.problem?.matchedTokens || [],
          problemDistinctiveCoverage: doc.problem?.distinctiveCoverage || 0,
          problemDistinctiveMatchedTokens: doc.problem?.distinctiveMatchedTokens || [],
          problemDistinctiveTokenCount: doc.problem?.distinctiveTokenCount || 0,
          titleCoverage: doc.problem?.titleCoverage || 0,
          titleDistinctiveCoverage: doc.problem?.titleDistinctiveCoverage || 0,
          vectorScore: 0,
          keywordRank: null,
          vectorRank: null,
          rrfScore: 0,
          problemBoost: 0,
          hybridScore: 0,
        },
      });
    } else if (doc.problem) {
      const row = merged.get(key);
      row.retrieval.problemScore = Math.max(row.retrieval.problemScore, doc.problem.score || 0);
      row.retrieval.problemCoverage = Math.max(row.retrieval.problemCoverage, doc.problem.coverage || 0);
      row.retrieval.problemDistinctiveCoverage = Math.max(
        row.retrieval.problemDistinctiveCoverage,
        doc.problem.distinctiveCoverage || 0
      );
      row.retrieval.problemDistinctiveTokenCount = Math.max(
        row.retrieval.problemDistinctiveTokenCount,
        doc.problem.distinctiveTokenCount || 0
      );
      row.retrieval.titleCoverage = Math.max(row.retrieval.titleCoverage, doc.problem.titleCoverage || 0);
      row.retrieval.titleDistinctiveCoverage = Math.max(
        row.retrieval.titleDistinctiveCoverage,
        doc.problem.titleDistinctiveCoverage || 0
      );
      if ((doc.problem.matchedTokens || []).length > row.retrieval.problemMatchedTokens.length) {
        row.retrieval.problemMatchedTokens = doc.problem.matchedTokens || [];
      }
      if ((doc.problem.distinctiveMatchedTokens || []).length > row.retrieval.problemDistinctiveMatchedTokens.length) {
        row.retrieval.problemDistinctiveMatchedTokens = doc.problem.distinctiveMatchedTokens || [];
      }
    }
    return merged.get(key);
  };

  lexicalDocs.forEach((doc, index) => {
    const row = getRow(doc);
    row.retrieval.lexicalScore = doc.lexical?.score || 0;
    row.retrieval.coverage = doc.lexical?.coverage || 0;
    row.retrieval.matchedTokens = doc.lexical?.matchedTokens || [];
    row.retrieval.lexicalDistinctiveCoverage = doc.lexical?.distinctiveCoverage || 0;
    row.retrieval.keywordRank = index + 1;
    row.retrieval.rrfScore += keywordWeight / (RRF_K + index + 1);
  });

  vectorDocs.forEach((doc, index) => {
    const row = getRow(doc);
    row.retrieval.vectorScore = Number(doc.vectorScore || 0);
    row.retrieval.vectorRank = index + 1;
    row.retrieval.rrfScore += vectorWeight / (RRF_K + index + 1);
  });

  return [...merged.values()]
    .map((doc) => {
      const overallCoverageBoost = Number(doc.retrieval.problemCoverage || 0) * Math.max(problemWeight * 0.45, 0.5);
      const distinctiveBoost = Number(doc.retrieval.problemDistinctiveCoverage || 0) * Math.max(problemWeight * 1.35, 1.5);
      const titleDistinctiveBoost = Number(doc.retrieval.titleDistinctiveCoverage || 0) * 1.5;
      const scoreBoost = Math.min(Number(doc.retrieval.problemScore || 0) / 120, 1) * 0.75;
      const problemBoost = overallCoverageBoost + distinctiveBoost + titleDistinctiveBoost + scoreBoost;
      const rrfScore = doc.retrieval.rrfScore * 100;
      const hybridScore = rrfScore + problemBoost;

      return {
        ...doc,
        retrieval: {
          ...doc.retrieval,
          rrfScore: Number(rrfScore.toFixed(6)),
          problemBoost: Number(problemBoost.toFixed(6)),
          hybridScore: Number(hybridScore.toFixed(6)),
          score: Number(hybridScore.toFixed(6)),
        },
      };
    })
    .sort((a, b) => {
      if (b.retrieval.hybridScore !== a.retrieval.hybridScore) {
        return b.retrieval.hybridScore - a.retrieval.hybridScore;
      }
      if (b.retrieval.problemDistinctiveCoverage !== a.retrieval.problemDistinctiveCoverage) {
        return b.retrieval.problemDistinctiveCoverage - a.retrieval.problemDistinctiveCoverage;
      }
      if (b.retrieval.titleDistinctiveCoverage !== a.retrieval.titleDistinctiveCoverage) {
        return b.retrieval.titleDistinctiveCoverage - a.retrieval.titleDistinctiveCoverage;
      }
      if (b.retrieval.problemCoverage !== a.retrieval.problemCoverage) {
        return b.retrieval.problemCoverage - a.retrieval.problemCoverage;
      }
      if (b.retrieval.vectorScore !== a.retrieval.vectorScore) {
        return b.retrieval.vectorScore - a.retrieval.vectorScore;
      }
      return b.retrieval.coverage - a.retrieval.coverage;
    })
    .slice(0, topK)
    .map((doc) => ({
      ...doc,
      retrieval: {
        ...doc.retrieval,
        evidenceStrength: classifyEvidenceStrength(doc),
      },
    }));
}
