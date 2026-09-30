# NAVA Helpdesk

NAVA (Nagatech Virtual Assistant) adalah aplikasi helpdesk dengan backend
Node.js di `api/`, frontend React/Vite di `web/`, LangChain/LangGraph,
MongoDB, Qdrant, Hindsight, Laya, dan Room Investigasi Helpdesk read-only.

## 1. Prasyarat

- Node.js >= 20 dan npm.
- Docker Desktop.
- Python >= 3.10 jika Laya digunakan.
- Akses MongoDB backend.
- API key DeepSeek.
- API key DeepSeek untuk service Hindsight jika Hindsight digunakan.

Tidak ada `package.json` di root project. Jalankan `npm install` terpisah di
`api/` dan `web/`.

## 2. Install project

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix

cd api
npm install

cd ../web
npm install
```

## 3. Konfigurasi environment

Buat file environment dari template:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix
cp api/.env.example api/.env
cp web/.env.example web/.env
```

### 3.1 Backend `api/.env`

Contoh konfigurasi yang sesuai dengan workspace ini:

```ini
PORT=4000
CORS_ORIGIN=http://localhost:6002
NODE_ENV=development

MONGODB_URI=mongodb://USER:PASSWORD@HOST/DATABASE
MONGODB_DB=db_agent_helpdesk

DEEPSEEK_API_KEY=ISI_API_KEY_DEEPSEEK
DEEPSEEK_MODEL=deepseek-v4-flash-vision-exp
DEEPSEEK_TIMEOUT_MS=120000

HELPDESK_AUTH_SECRET=ganti-dengan-secret-random-yang-panjang
HELPDESK_DEFAULT_PASSWORD=ganti-password-awal

QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=knowledge_vector_index
VECTOR_SEARCH_ENABLED=true
```

Jika memakai port dari `.env.example`, gunakan pasangan API `3000` dan Web
`8080`:

```ini
# api/.env
PORT=3000
CORS_ORIGIN=http://localhost:8080
```

Nilai `PORT`, `CORS_ORIGIN`, dan `web/.env` harus konsisten.

### 3.2 Frontend `web/.env`

Untuk konfigurasi workspace ini:

```ini
VITE_PORT=6002
VITE_API_URL=http://localhost:4000
```

Jika API memakai port `3000`, ubah `VITE_API_URL` menjadi
`http://localhost:3000`.

### 3.3 Hindsight

Key Hindsight ditulis di `api/.env` karena Docker Compose membaca file tersebut
saat container Hindsight dijalankan:

```ini
HINDSIGHT_LLM_API_KEY=ISI_API_KEY_DEEPSEEK
HINDSIGHT_ENABLED=true
HINDSIGHT_URL=http://localhost:8888
HINDSIGHT_TIMEOUT_MS=10000
HINDSIGHT_RECALL_BUDGET=low
HINDSIGHT_RECALL_MAX_TOKENS=1200
HINDSIGHT_RETAIN_ASYNC=true

# Pilih salah satu pola memory:
CUSTOMER_MEMORY_BACKEND=hindsight
# CUSTOMER_MEMORY_BACKEND=hybrid
```

`HINDSIGHT_API_KEY` hanya diperlukan jika service Hindsight lokal diberi
authentication. Tanpa authentication lokal, boleh kosong.

### 3.4 Laya

```ini
LAYA_ENABLED=true
LAYA_URL=http://localhost:8000
# LAYA_API_KEY=
LAYA_MODEL=multilingual
LAYA_TIMEOUT_MS=10000
```

Laya tidak berada di `docker-compose.yml` project ini. Laya dijalankan sebagai
service Python terpisah dan dipanggil backend melalui HTTP.

### 3.5 Target database Investigasi Helpdesk

Gunakan user MongoDB read-only. Target database customer berbeda dari database
utama NAVA:

```ini
INVESTIGATION_TARGET_COLLECTION=tm_investigation_target
INVESTIGATION_RUN_COLLECTION=tt_investigation_run
INVESTIGATION_KNOWLEDGE_COLLECTION=tm_investigation_knowledge
INVESTIGATION_DEFINITION_COLLECTION=tm_investigation_definition
INVESTIGATION_PLAYBOOK_COLLECTION=tm_investigation_playbook

INVESTIGATION_MONGODB_URI_VM1=mongodb://READ_ONLY_USER:PASSWORD@VM1_HOST/
INVESTIGATION_MONGODB_URI_VM2=mongodb://READ_ONLY_USER:PASSWORD@VM2_HOST/
INVESTIGATION_MONGODB_DEFAULT_PROFILE=default
INVESTIGATION_QUERY_TIMEOUT_MS=8000
INVESTIGATION_MAX_ROWS=50
```

Mapping domain, profile koneksi, dan nama database tenant dikelola melalui menu
Target DB di portal Helpdesk. Jangan memasukkan connection string ke chat atau
frontend.

Jangan commit `api/.env` atau `web/.env` karena dapat berisi credential.

## 4. Jalankan dependency Docker

Buka Docker Desktop, lalu dari root project:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix

# Wajib untuk vector search
docker compose up -d qdrant

# Jalankan jika HINDSIGHT_ENABLED=true
docker compose --env-file api/.env --profile hindsight up -d --force-recreate hindsight

docker compose ps
```

| Service | URL/port | Fungsi |
| --- | --- | --- |
| Qdrant | `http://localhost:6333` | Vector knowledge retrieval |
| Hindsight API | `http://localhost:8888` | Customer memory |
| Hindsight UI/ops | `http://localhost:9999` | Operasional Hindsight |

Log Hindsight:

```bash
docker logs --tail 100 nava-hindsight
```

Jangan memakai `docker compose down -v` jika ingin mempertahankan volume
`qdrant_storage` dan `hindsight_storage`.

## 5. Install dan jalankan Laya

Laya dijalankan sebagai service terpisah, misalnya di:

```text
/Users/aandiyanti/Documents/RnD/PROJECT/laya-service
```

Install satu kali:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/laya-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install "laya[serve]"
```

Jalankan dan biarkan terminal tetap terbuka:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/laya-service
source .venv/bin/activate

LAYA_DEVICE=cpu \
LAYA_HOST=127.0.0.1 \
LAYA_PORT=8000 \
LAYA_PRELOAD=1 \
laya-serve
```

Verifikasi:

```bash
curl -sS http://localhost:8000/health
```

## 6. Jalankan NAVA

Gunakan terminal terpisah untuk setiap service.

### Terminal 1 - Laya

Jalankan sesuai bagian [Install dan jalankan Laya](#5-install-dan-jalankan-laya).

### Terminal 2 - API

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix/api
npm run dev
```

API berjalan di `http://localhost:4000` jika `PORT=4000`.

### Terminal 3 - Web

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix/web
npm run dev
```

Buka UI di `http://localhost:6002` jika `VITE_PORT=6002`.

Urutan service:

```text
Docker Qdrant/Hindsight -> Laya -> API -> Web
```

Jika Laya atau Hindsight tidak digunakan sementara, ubah flag masing-masing
menjadi `false` di `api/.env`, lalu restart API.

## 7. Verifikasi service

```bash
# API
curl -sS http://localhost:4000/api/health

# Laya
curl -sS http://localhost:8000/health

# Docker
docker compose ps
```

Tes chat API:

```bash
curl -sS -X POST http://localhost:4000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"local-test-1","customer_id":"customer-local-001","question":"laporan penjualan itu untuk apa?"}'
```

Jika Laya aktif, metadata response dapat berisi:

```json
{
  "laya_source": "laya",
  "laya_area": "reports",
  "laya_report_type": "sales_report"
}
```

Jika Hindsight aktif dan memory relevan, metadata dapat berisi
`hindsight_memory_used: true`. Pada customer atau pertanyaan baru, memory
kosong juga merupakan kondisi normal.

## 8. Login Helpdesk dan Investigasi

Buat user Helpdesk awal satu kali setelah `api/.env` dan MongoDB siap:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix/api
npm run helpdesk:seed
```

User default:

```text
helpdesk_id: hd1
password: nilai HELPDESK_DEFAULT_PASSWORD di api/.env
```

Portal Helpdesk:

```text
http://localhost:6002/helpdesk/login
```

Room Investigasi:

```text
http://localhost:6002/helpdesk/investigation
```

Menu pendukung:

```text
/helpdesk/investigation-targets
/helpdesk/investigation-definitions
/helpdesk/investigation-knowledge
/helpdesk/investigation-playbooks
```

Investigasi hanya untuk Helpdesk internal. NAVA membaca database target secara
read-only, mencatat audit, dan tidak mengubah data customer.

## 9. Import dan sinkronisasi knowledge

Knowledge customer dari file default:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix/api
npm run knowledge:import
```

Dengan file tertentu:

```bash
npm run knowledge:import -- /path/ke/nava-knowledge.json
```

Import langsung sebagai published:

```bash
npm run knowledge:import:published -- /path/ke/nava-knowledge.json
```

Refresh embedding dan vector index secara manual:

```bash
npm run knowledge:embed
npm run knowledge:vector-index
```

### Alur knowledge, embedding, dan Qdrant

Sumber data knowledge tetap berada di MongoDB, pada collection
`tm_knowledge_helpdesk`. Alurnya:

```text
File knowledge
    -> MongoDB: artikel + field embedding
    -> Qdrant: vector point untuk pencarian semantik
    -> NAVA: hybrid search keyword + vector
```

Detail tiap perintah:

- `npm run knowledge:import` melakukan upsert artikel ke MongoDB, membuat atau
  memperbarui embedding yang belum sesuai, lalu menyinkronkannya ke Qdrant.
- `npm run knowledge:embed` membuat embedding untuk artikel yang belum memiliki
  embedding terbaru atau embedding-nya tidak sesuai model/profile, lalu menulis
  hasilnya ke MongoDB dan menyinkronkan vector ke Qdrant.
- `npm run knowledge:embed -- --force` memaksa pembuatan ulang semua embedding.
- `npm run knowledge:vector-index` tidak membuat embedding baru. Perintah ini
  membaca embedding yang sudah ada di MongoDB, lalu membuat atau memperbarui
  collection/vector point di Qdrant.

Embedding disimpan di MongoDB pada field `embedding` bersama metadata model,
profile, dimensi, dan waktu update. Qdrant menyimpan vector point dengan
`articleId` sebagai identitas dan payload status artikel. Hanya artikel
`published` yang masuk vector search; artikel `draft` atau `archived` tidak
digunakan dan vector lamanya dapat dihapus saat sinkronisasi.

Urutan pemulihan jika Qdrant kosong tetapi embedding MongoDB masih ada:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix/api
npm run knowledge:vector-index
```

Urutan lengkap jika artikel baru atau isi artikel berubah:

```bash
npm run knowledge:import -- /path/ke/nava-knowledge.json
# Import sudah membuat embedding dan sinkronisasi Qdrant.
# Jalankan perintah berikut hanya jika ingin memproses ulang manual:
npm run knowledge:embed
npm run knowledge:vector-index
```

Import knowledge investigasi:

```bash
npm run investigation:knowledge:import
npm run investigation:knowledge:import:published
```

Knowledge investigasi disimpan terpisah dari knowledge customer.

## 10. Seluruh script `api/package.json`

Semua script berikut benar-benar tersedia di `api/package.json`:

| Perintah | Kegunaan |
| --- | --- |
| `npm run dev` | Menjalankan API untuk development |
| `npm start` | Menjalankan API menggunakan mode start |
| `npm run knowledge:import` | Import knowledge customer dari file default atau file yang diberikan |
| `npm run knowledge:import:published` | Import knowledge customer dan memaksa status published |
| `npm run knowledge:embed` | Membuat atau memperbarui embedding knowledge |
| `npm run knowledge:vector-index` | Membuat atau memperbarui vector index di Qdrant |
| `npm run investigation:knowledge:import` | Import knowledge investigasi sesuai status file |
| `npm run investigation:knowledge:import:published` | Import knowledge investigasi sebagai published |
| `npm run helpdesk:seed` | Membuat user Helpdesk awal jika belum ada |
| `npm test` atau `npm run test` | Menjalankan seluruh test Node.js |
| `npm run check` | Memeriksa syntax seluruh file JavaScript |
| `npm run eval:retrieval` | Mengevaluasi akurasi top-1 retrieval |
| `npm run eval:agent` | Mengevaluasi agent, tool selection, grounding, dan latency |
| `npm run knowledge:cleanup-clarification` | Maintenance untuk membersihkan field clarification lama |

Script manual yang tersedia tetapi bukan script npm:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix/api

# Demo memory Hindsight
node scripts/demo-hindsight-memory.js

# Maintenance khusus playbook stock-summary; jalankan hanya jika diperlukan
node scripts/fix-stock-summary-playbook.js
```

Script maintenance jangan dijalankan tanpa memahami data yang akan diubah.

## 11. Seluruh script `web/package.json`

| Perintah | Kegunaan |
| --- | --- |
| `npm run dev` | Menjalankan Vite development server |
| `npm run build` | Type-check dan membuat build production |
| `npm run preview` | Menjalankan preview dari hasil build |

## 12. Test dan build sebelum commit

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix/api
npm run check
npm test

cd ../web
npm run build
```

## 13. Menghentikan project

Hentikan API, Web, dan Laya dengan `Ctrl+C` pada terminal masing-masing.

Hentikan service Docker tanpa menghapus volume:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix
docker compose stop hindsight qdrant
```

Dokumentasi lebih detail:

- [Hindsight Memory](docs/hindsight-memory.md)
- [Laya Integration](docs/laya-integration.md)
- [Investigasi Helpdesk](docs/investigation-helpdesk.md)
- [Ringkasan fungsi investigasi](docs/investigation-functions-summary.md)
