# NAVA Helpdesk Website

**NAVA (Nagatech Virtual Assistant)** sekarang tersusun sebagai website helpdesk lengkap dengan backend agent existing di `api/` dan frontend React/Vite di `web/`.

```text
project-root/
├── api/   # Backend NAVA existing + REST/SSE Helpdesk
└── web/   # Frontend Customer dan Portal Helpdesk
```

## Menjalankan Backend

```bash
cd api
npm install
npm run dev
```

Backend membaca konfigurasi dari `api/.env`.

```env
PORT=3000
CORS_ORIGIN=http://localhost:8080
```

ENV existing untuk MongoDB, DeepSeek, embedding, LangGraph Checkpointer, long-term memory, summarization, dan retrieval tetap berada di `api/.env`.

Qdrant berjalan melalui Docker pada `http://localhost:6333`. Backend akan memastikan collection `knowledge_vector_index` tersedia dan melakukan rekonsiliasi vector saat startup.

## Sinkronisasi Knowledge dan Qdrant

Import knowledge sekarang otomatis membuat embedding dan menyinkronkan vector ke Qdrant:

```bash
cd api
npm run knowledge:import -- /path/ke/nava-knowledge.json
```

Untuk memproses ulang embedding yang berubah atau melakukan rekonsiliasi manual:

```bash
npm run knowledge:embed
npm run knowledge:vector-index
```

Artikel baru yang di-publish dari portal helpdesk otomatis dibuat embedding dan di-upsert ke Qdrant. Artikel draft atau archive dikeluarkan dari vector search.

## Menjalankan Frontend

```bash
cd web
npm install
npm run dev
```

Frontend membaca konfigurasi dari `web/.env`.

```env
VITE_PORT=8080
VITE_API_URL=http://localhost:3000
```

Seluruh request frontend melewati `web/src/services/api.ts` dan memakai `import.meta.env.VITE_API_URL`.

## Route Frontend

- `/` -> Chat Room Customer
- `/helpdesk/dashboard` -> Dashboard Helpdesk
- `/helpdesk/tickets` -> Daftar Tiket
- `/helpdesk/handover` -> Antrian Handover
- `/helpdesk/chat/:sessionId` -> Chat Room Helpdesk untuk session yang sama

## Endpoint Backend Baru

- `GET /api/chat/:session_id/messages`
- `GET /api/dashboard`
- `GET /api/events`
- `POST /api/uploads/helpdesk`
- `GET /api/tickets`
- `POST /api/tickets`
- `GET /api/tickets/session/:session_id`
- `GET /api/tickets/:id`
- `POST /api/tickets/:id/accept`
- `POST /api/tickets/:id/resolve`
- `POST /api/helpdesk/reply`

Endpoint agent existing seperti `POST /api/chat`, `POST /api/knowledge/search`, dan `GET /api/customer/:customer_id/context` tetap dipertahankan.

## Collection MongoDB

Collection existing tetap dipakai:

- `tm_knowledge_helpdesk`
- `tt_chat_helpdesk`
- `tt_agent_trace`
- `tt_agent_checkpoint`
- `tt_agent_checkpoint_write`
- `tm_nava_customer_memory`

Collection baru:

- `tt_ticket_helpdesk`

Ticket memakai `session_id` sebagai relasi utama ke history di `tt_chat_helpdesk`, sehingga history chat tidak diduplikasi ke ticket.

## Upload Gambar

File customer/helpdesk disimpan di:

```text
api/uploads/helpdesk/
```

Metadata attachment disimpan di `metadata.attachments` pada message MongoDB. Frontend membentuk URL gambar dari `VITE_API_URL`.

## Verifikasi

```bash
cd api
npm run check
npm test

cd ../web
npm run build
```

## v2.4.3 — Retrieval Intelligence Fix

Backend `api/` sudah memakai retrieval yang lebih tahan terhadap bahasa customer yang bebas: normalisasi bentuk kata Indonesia, discriminator-aware ranking, targeted candidate supplementation, search kedua yang benar-benar dijalankan, dan long-term memory yang hanya dimasukkan jika relevan. Detail: `INTELLIGENCE_RETRIEVAL_FIX.md`.
# nava-helpdesk
