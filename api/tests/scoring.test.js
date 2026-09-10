import test from "node:test";
import assert from "node:assert/strict";
import { lexicalScore } from "../src/utils/text.js";

const barcodeArticle = {
  title: "Tidak bisa cetak barcode / cetak barcode tidak keluar",
  category: "pengaturan",
  symptoms: ["Tidak bisa cetak barcode / cetak barcode tidak keluar"],
  tags: ["pengaturan", "cetak", "barcode", "tidak", "keluar"],
  userResponseTemplate: "Cek settingan port pada aplikasi autoprint.",
  troubleshootingSteps: [{ instruction: "Pastikan printer hidup dan terpasang." }],
};

test("query print barcode cocok dengan artikel cetak barcode", () => {
  const result = lexicalScore("barcode gak bisa di print", barcodeArticle);
  assert.ok(result.score > 0);
  assert.ok(result.coverage >= 0.5);
});

test("query tidak relevan mendapat coverage rendah", () => {
  const result = lexicalScore("cara melihat hutang supplier", barcodeArticle);
  assert.ok(result.coverage < 0.5);
});
