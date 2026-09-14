import test from "node:test";
import assert from "node:assert/strict";
import { __trainingInternals } from "../src/services/chat-training-service.js";

test("training mengambil domain Goldstore dari pertanyaan Helpdesk", () => {
  assert.equal(
    __trainingInternals.extractTrainingDomain("Tolong cek versi FE dan BE https://smbspwj.goldstore.id/"),
    "smbspwj.goldstore.id",
  );
});

test("training tidak mengambil domain eksternal", () => {
  assert.equal(
    __trainingInternals.extractTrainingDomain("Cek versi https://example.com lalu jawab"),
    "",
  );
});
