# NAVA v2.4.0 — Memory-First Production Upgrade

Versi ini mempertahankan behavior v2.x yang cepat/to-the-point, lalu menambahkan memory yang sebelumnya hanya ada di eksperimen v3 dengan implementasi yang lebih ringan.

## Fitur aktif

1. **MongoDB LangGraph Checkpointer**
   - `session_id` dipakai sebagai `thread_id`.
   - State agent/tool/history tersimpan native di MongoDB.
   - History session aktif tidak dibaca manual lagi, supaya beban tidak dobel.

2. **MongoDBStore Long-Term Memory**
   - `customer_id` menjadi kunci ingatan lintas session.
   - Hanya menyimpan kasus yang grounded ke knowledge atau eskalasi.
   - Memory dibaca sekali per request, bukan setiap LLM call.

3. **Adaptive Conversation Summarization**
   - Baru aktif setelah `SUMMARIZATION_TRIGGER_MESSAGES` atau `SUMMARIZATION_TRIGGER_TOKENS` tercapai. Default dibuat cukup tinggi supaya tidak sering memanggil model summary.
   - Chat pendek tidak mendapat extra summary call.
   - Summary model memakai DeepSeek non-thinking agar cepat.
   - Main agent tetap memakai behavior default/think DeepSeek.

4. **Search Tool Limit ringan**
   - Maksimal default 2 `search_knowledge` per user turn.
   - Evidence `strong` menghentikan pencarian hipotesis kedua.

5. **Model Call Limit ringan**
   - Default maksimal 5 main-model call per request.
   - Hanya mencegah loop; tidak menentukan arti bahasa customer.

6. **Local + Full Agent Evaluation**
   - `npm run eval:retrieval`
   - `npm run eval:agent`

7. **Agent trace/timing**
   - latency, model calls, tool calls, memory source, retrieval timing.

8. **First-turn identity**
   - Pada jawaban pertama session, NAVA wajib menyebut dirinya sebagai AI Helpdesk Nagatech (Nagatech Virtual Assistant).
   - Tidak memakai regex sapaan.

## Request yang direkomendasikan

```json
{
  "session_id": "chat-001",
  "customer_id": "CS001",
  "question": "struk penjualan saya gak keluar"
}
```

`session_id` = percakapan/thread aktif.
`customer_id` = identitas customer lintas session.

## Mengapa tetap ringan

- agent singleton;
- embedding warmup saat startup;
- active history ditangani Checkpointer, tidak dibaca ulang dari `tt_chat_helpdesk`;
- long-term memory satu read per request;
- summary hanya saat chat panjang;
- persistence setelah jawaban dijalankan paralel;
- tidak memakai forced structured output;
- tidak memakai middleware intent/smalltalk berbasis rule.
