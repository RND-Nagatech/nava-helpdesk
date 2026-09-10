import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeKnowledgeArticleInput,
  serializeKnowledgeArticle,
  validatePublishableArticle,
} from "../src/services/knowledge-article-service.js";

test("artikel UI dinormalisasi sesuai kontrak retriever", () => {
  const article = normalizeKnowledgeArticleInput({
    title: " Tidak bisa login ",
    category: "login",
    symptoms: ["password salah", "password salah", ""],
    tags: [" login ", "password"],
    userResponseTemplate: "Cek ulang User ID dan password.",
    troubleshootingSteps: [
      { instruction: "Pastikan User ID benar." },
      { instruction: "Reset password bila lupa.", expectedResult: "Customer bisa login." },
    ],
    escalationRules: ["Butuh reset admin", ""],
  });

  assert.equal(article.product, "nagagold");
  assert.deepEqual(article.symptoms, ["password salah"]);
  assert.deepEqual(article.tags, ["login", "password"]);
  assert.equal(article.troubleshootingSteps[1].order, 2);
  assert.match(article.search_text, /Tidak bisa login/);
});

test("artikel sederhana otomatis dilengkapi untuk retriever", () => {
  const article = normalizeKnowledgeArticleInput({
    title: "Tidak bisa login karena lupa password",
    category: "login",
    product: "nagagold",
    userResponseTemplate: "Bantu customer reset password melalui menu user.",
  });

  assert.deepEqual(article.symptoms, ["Tidak bisa login karena lupa password"]);
  assert.ok(article.tags.includes("login"));
  assert.equal(article.troubleshootingSteps[0].title, "Solusi");
  assert.match(article.search_text, /nagagold/);
});

test("publish artikel wajib punya field minimum untuk bot", () => {
  assert.throws(
    () => validatePublishableArticle(normalizeKnowledgeArticleInput({ title: "Draft kosong" })),
    /Template jawaban wajib diisi/
  );

  assert.doesNotThrow(() => validatePublishableArticle(normalizeKnowledgeArticleInput({
    title: "Tidak bisa login",
    symptoms: ["password salah"],
    userResponseTemplate: "Cek kredensial login.",
    troubleshootingSteps: [{ instruction: "Pastikan password benar." }],
  })));
});

test("artikel lama tanpa status tetap dianggap published", () => {
  const article = serializeKnowledgeArticle({
    articleId: "legacy-1",
    title: "Legacy",
    embedding: [],
  });

  assert.equal(article.status, "published");
  assert.equal(article.embedding_status, "stale");
});

test("artikel lama dengan vector valid tetap dianggap embedding siap meski metadata kosong", () => {
  const article = serializeKnowledgeArticle({
    articleId: "legacy-vector-1",
    title: "Legacy vector",
    embedding: Array.from({ length: 384 }, () => 0.01),
  });

  assert.equal(article.status, "published");
  assert.equal(article.embedding_status, "ready");
});

test("artikel list tetap tahu embedding siap tanpa mengirim vector ke frontend", () => {
  const article = serializeKnowledgeArticle({
    articleId: "projected-vector-1",
    title: "Projected vector",
    _embedding_length: 384,
  });

  assert.equal(article.embedding_status, "ready");
  assert.equal(article._embedding_length, undefined);
});
