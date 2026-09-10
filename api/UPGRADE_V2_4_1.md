# Upgrade v2.4.1 — Recursion-safe limits

Patch ini tidak mengubah arsitektur NAVA. Fokusnya hanya mencegah `GraphRecursionError` muncul ke customer ketika agent berputar terlalu lama.

## Perubahan

- `AGENT_RECURSION_LIMIT` default: 20.
- `MODEL_CALL_RUN_LIMIT` default: 4.
- `SEARCH_TOOL_CALL_LIMIT`: tetap 2.
- Effective recursion budget otomatis dibuat cukup longgar terhadap model-call budget, sehingga `.env` lama dengan angka 8/10 tidak langsung membuat graph terlalu sempit.
- Jika `GRAPH_RECURSION_LIMIT` tetap terjadi:
  - evidence `strong` → jawab dari primary article;
  - evidence belum kuat → minta klarifikasi singkat;
  - tidak ada evidence → minta detail tambahan / arahkan eskalasi.
- Debug response menampilkan `recursion_fallback`, `configured_recursion_limit`, dan `effective_recursion_limit`.

Tidak ada perubahan pada vector search, embedding, Checkpointer, MongoDBStore, summarization, long-term memory, atau identitas NAVA.
