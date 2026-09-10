import test from "node:test";
import assert from "node:assert/strict";
import { fuseHybridResults } from "../src/utils/hybrid.js";

test("hybrid fusion memberi boost pada artikel yang muncul di keyword dan vector", () => {
  const lexical = [
    {
      articleId: "A",
      title: "Artikel A",
      lexical: { score: 20, coverage: 0.5, matchedTokens: ["barang"] },
    },
    {
      articleId: "B",
      title: "Artikel B",
      lexical: { score: 18, coverage: 0.4, matchedTokens: ["barang"] },
    },
  ];

  const vector = [
    { articleId: "B", title: "Artikel B", vectorScore: 0.94 },
    { articleId: "C", title: "Artikel C", vectorScore: 0.93 },
  ];

  const result = fuseHybridResults(lexical, vector, 3, {
    keywordWeight: 1,
    vectorWeight: 1.25,
  });

  assert.equal(result[0].articleId, "B");
  assert.equal(result[0].retrieval.keywordRank, 2);
  assert.equal(result[0].retrieval.vectorRank, 1);
  assert.ok(result[0].retrieval.hybridScore > result[1].retrieval.hybridScore);
});

test("vector-only candidate tetap dapat masuk hasil hybrid", () => {
  const result = fuseHybridResults(
    [],
    [{ articleId: "V", title: "Semantic result", vectorScore: 0.95 }],
    5,
    { keywordWeight: 1, vectorWeight: 1.25 }
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].articleId, "V");
  assert.equal(result[0].retrieval.vectorRank, 1);
});
