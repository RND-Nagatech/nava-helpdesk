import test from "node:test";
import assert from "node:assert/strict";
import { formatCrossSessionContext } from "../src/services/cross-session-context.js";

test("cross-session context hanya menjadi konteks tambahan, bukan knowledge resmi", () => {
  const content = formatCrossSessionContext([
    { role: "user", content: "kemarin timbangan saya tidak masuk" },
    {
      role: "assistant_grounded",
      content: "Coba buka Timbangan Start.",
      primary_article_title: "Tambah barang dan timbang baki tidak konek timbangan",
    },
  ]);

  assert.match(content, /KONTEKS CUSTOMER DARI SESSION SEBELUMNYA/i);
  assert.match(content, /bukan sumber fakta realtime/i);
  assert.match(content, /timbangan saya tidak masuk/i);
  assert.match(content, /knowledge:/i);
});
