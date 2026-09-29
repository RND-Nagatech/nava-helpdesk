# NAVA + Hindsight Memory

Panduan singkat untuk menjalankan NAVA dengan Hindsight sebagai satu-satunya memory jangka panjang customer.

## 1. Arsitektur

- Knowledge resmi, prosedur, dan troubleshooting tetap berasal dari RAG/NAVA.
- Hindsight menyimpan riwayat masalah customer, langkah yang sudah dicoba, dan hasil troubleshooting.
- MongoDB tetap dipakai untuk chat, ticket, checkpointer, dan data operasional.
- Hindsight berjalan sebagai service Docker, bukan sebagai package di `api/`.

## 2. Prasyarat

- Docker Desktop sudah berjalan.
- API key DeepSeek yang valid.
- Repository berada di:

```text
/Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix
```

## 3. Konfigurasi NAVA

Edit `api/.env` dan pastikan nilainya seperti ini. Sesuaikan `PORT` jika berbeda.

```ini
PORT=4000
HINDSIGHT_ENABLED=true
HINDSIGHT_URL=http://localhost:8888
CUSTOMER_MEMORY_BACKEND=hindsight
LONG_TERM_MEMORY_ENABLED=false
CROSS_SESSION_CONTEXT_ENABLED=false
HINDSIGHT_TIMEOUT_MS=1500
HINDSIGHT_RECALL_BUDGET=low
HINDSIGHT_RECALL_MAX_TOKENS=1200
HINDSIGHT_RETAIN_ASYNC=true
```

`HINDSIGHT_LLM_API_KEY` dipakai Docker Compose untuk Hindsight. Pada project ini, key disimpan di `api/.env` bersama konfigurasi NAVA:

```ini
HINDSIGHT_LLM_API_KEY=API_KEY_DEEPSEEK_ASLI
```

Saat menjalankan Docker Compose, gunakan `--env-file api/.env` agar Compose membaca key tersebut. Jangan menulis API key sungguhan di `api/.env.example`, `docker-compose.yml`, atau dokumentasi.

## 4. Jalankan Hindsight

Buka Terminal baru dan jalankan dari root repository:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix
docker compose up -d qdrant
```

Pastikan `api/.env` berisi API key DeepSeek yang valid:

```ini
HINDSIGHT_LLM_API_KEY=API_KEY_DEEPSEEK_ASLI
```

Jangan menulis teks placeholder tersebut secara literal.

Jalankan Hindsight:

```bash
docker compose --env-file api/.env --profile hindsight up -d --force-recreate hindsight
```

Verifikasi container:

```bash
docker compose ps
```

Verifikasi API Hindsight:

```bash
curl -sS http://localhost:8888/health
```

Hasil yang benar memiliki status seperti:

```json
{"status":"healthy","database":"connected"}
```

Jika ingin melihat proses startup:

```bash
docker logs -f nava-hindsight
```

Tunggu sampai log menunjukkan:

```text
✅ Hindsight is running!
```

## 5. Jalankan backend NAVA

Buka Terminal kedua:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix/api
npm install
npm run dev
```

Backend membaca `api/.env`. Jika `PORT=4000`, endpoint chat adalah:

```text
http://localhost:4000/api/chat
```

## 6. Uji memory Hindsight

### Request pertama

Gunakan `customer_id` yang stabil dan `session_id` baru:

```bash
curl -sS -X POST http://localhost:4000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"hindsight-demo-1","customer_id":"customer-demo-001","question":"berat barang gak muncul pas tambah barang"}'
```

Pada request pertama, hasil berikut masih normal:

```json
"hindsight_memory_source":"none"
```

Jawaban yang grounded akan dikirim ke Hindsight secara asynchronous. Tunggu sekitar 10–30 detik.

### Request kedua

Gunakan `customer_id` yang sama, tetapi `session_id` berbeda:

```bash
curl -sS -X POST http://localhost:4000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"hindsight-demo-2","customer_id":"customer-demo-001","question":"masalahnya muncul lagi, tadi saya harus apa?"}'
```

Memory berhasil dipakai jika response memuat:

```json
"customer_memory_backend":"hindsight",
"hindsight_memory_used":true,
"hindsight_memory_source":"hindsight",
"hindsight_memory_items":1
```

`hindsight_memory_items` dapat lebih dari satu jika `customer_id` tersebut sudah dipakai untuk pengujian sebelumnya.

## 7. Troubleshooting singkat

### Container `Up`, tetapi memory `hindsight_unavailable`

Cek log:

```bash
docker logs --tail 80 nava-hindsight
```

Jika ada `AuthenticationError: 401`, API key DeepSeek yang diberikan ke Docker salah atau placeholder. Jalankan ulang langkah konfigurasi key dan recreate container.

Jika ada `Bank ... not found` pada percobaan pertama, restart backend NAVA ke versi terbaru. NAVA akan membuat bank customer sebelum melakukan recall.

### Hindsight restart berulang

Jalankan:

```bash
docker compose stop hindsight
docker compose --env-file api/.env --profile hindsight up -d --force-recreate hindsight
```

Jangan gunakan `docker compose down -v` karena perintah tersebut menghapus volume memory `hindsight_storage`.

### Key tidak boleh masuk Git

- Jangan commit API key ke `api/.env` atau `docker-compose.yml`.
- Jangan menulis API key di dokumentasi atau screenshot.
- Jika key terlanjur terekspos, revoke/rotate key tersebut di DeepSeek.

## 8. Menghentikan service

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix
docker compose stop hindsight qdrant
```
