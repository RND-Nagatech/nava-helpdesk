import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  signHelpdeskToken,
  verifyHelpdeskToken,
  verifyPassword,
} from "../src/services/helpdesk-auth.js";
import { requireHelpdeskAuth } from "../src/middleware/helpdesk-auth.js";

const helpdeskUser = {
  helpdesk_id: "HD-TEST",
  name: "Admin Test",
  role: "admin",
  tier: "Administrator",
};

test("password helpdesk memakai hash pbkdf2 dan dapat diverifikasi", () => {
  const hash = hashPassword("secret-pass", "fixed-salt");

  assert.match(hash, /^pbkdf2_sha256\$\d+\$fixed-salt\$/);
  assert.equal(verifyPassword("secret-pass", hash), true);
  assert.equal(verifyPassword("wrong-pass", hash), false);
});

test("token helpdesk HMAC valid menyimpan identitas petugas", () => {
  const token = signHelpdeskToken(helpdeskUser, { secret: "test-secret", now: 1000 });
  const payload = verifyHelpdeskToken(token, { secret: "test-secret", now: 1001 });

  assert.equal(payload.helpdesk_id, "HD-TEST");
  assert.equal(payload.name, "Admin Test");
});

test("token helpdesk ditolak jika signature salah atau expired", () => {
  const token = signHelpdeskToken(helpdeskUser, { secret: "test-secret", now: 1000 });

  assert.equal(verifyHelpdeskToken(`${token}x`, { secret: "test-secret", now: 1001 }), null);
  assert.equal(verifyHelpdeskToken(token, { secret: "test-secret", now: 1000 + (60 * 60 * 12) + 1 }), null);
});

test("middleware helpdesk menolak request tanpa token", async () => {
  let statusCode = 0;
  let body = null;

  await requireHelpdeskAuth(
    { get: () => "" },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    },
    () => assert.fail("next tidak boleh dipanggil tanpa token")
  );

  assert.equal(statusCode, 401);
  assert.equal(body.success, false);
});
