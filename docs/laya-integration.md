# Laya untuk Nagatech/NAVA

## 1. Ringkasan

Laya adalah mesin keputusan cepat bergaya **System-1**. Laya menerima state berupa teks atau JSON, lalu mengembalikan keputusan terstruktur seperti:

- `choice`: memilih satu label;
- `score`: memberi nilai pada skala;
- `noul`: memperkirakan apakah jawaban ya/tidak.

Laya bukan chatbot, bukan knowledge base, dan bukan memory. Laya cocok dipakai sebelum agent utama untuk mengambil keputusan kecil yang berulang: routing, triage, prioritas, guardrail, dan pemilihan workflow.

Referensi resmi: [repository Laya](https://github.com/NandhaKishorM/laya).

## 2. Tujuan untuk Nagatech

Pada NAVA, Laya dipakai untuk membantu agent mengambil keputusan awal tanpa meminta LLM generatif melakukan semua pekerjaan:

```text
Pertanyaan customer
        |
        v
Laya: area masalah + indikasi urgensi
        |
        v
Hindsight: memory customer
        |
        v
LangChain agent: knowledge, tools, dan jawaban
        |
        v
Jawaban grounded + retain ke Hindsight
```

Tujuan utamanya:

1. Mempercepat keputusan routing awal.
2. Mengurangi beban model generatif untuk klasifikasi sederhana.
3. Menghasilkan label yang konsisten dan mudah dipakai dalam kode.
4. Menjadi lapisan tambahan tanpa mengubah LangChain sebagai agent utama.
5. Memisahkan keputusan cepat dari memory dan knowledge resmi.

## 3. Manfaat dan batasan

### Manfaat

- **Cepat:** keputusan typed tidak perlu menghasilkan jawaban panjang.
- **Terstruktur:** hasil dapat langsung dipakai sebagai label program, bukan diparsing dari paragraf LLM.
- **Multibahasa:** checkpoint multilingual dapat membantu bahasa Indonesia dan bahasa lain.
- **Self-hosted:** dapat dijalankan di komputer/server sendiri melalui `laya-serve`.
- **Dapat dipakai remote:** backend Node.js tidak perlu memasang PyTorch jika memanggil server Laya melalui HTTP.
- **Dapat dikembangkan:** criteria dapat diperluas sesuai domain support Nagatech.

### Batasan

- Laya tidak menjawab prosedur customer dan tidak menggantikan RAG.
- Laya tidak menyimpan riwayat customer dan tidak menggantikan Hindsight.
- Laya tidak boleh menentukan fakta produk, hasil database, atau query investigasi.
- Akurasi bergantung pada criteria, checkpoint, bahasa pertanyaan, dan data domain.
- Server Laya tetap membutuhkan resource model dan dapat memerlukan waktu startup untuk mengunduh checkpoint.
- Hasil Laya harus diperlakukan sebagai hint/routing, bukan bukti final.

## 4. Perbandingan komponen NAVA

| Komponen | Fungsi | Contoh pada Nagatech |
| --- | --- | --- |
| Laya | Keputusan cepat dan terstruktur | `inventory_weight`, `reports`, urgent/tidak |
| LangChain/LangGraph | Agent, alur reasoning, tools, dan state | Memanggil search knowledge atau tool investigasi |
| RAG/Qdrant | Sumber knowledge resmi | Panduan koneksi timbangan |
| Hindsight | Memory historis customer | Langkah yang sudah dicoba pada chat sebelumnya |
| MongoDB | Data aplikasi dan operasional | Chat, ticket, checkpoint, audit |

Laya, LangChain, RAG, dan Hindsight bekerja berurutan; bukan saling menggantikan.

## 5. Implementasi yang sudah ada di NAVA

Implementasi NAVA saat ini menggunakan mode **remote HTTP**:

1. `api/src/services/laya-decision.js` mengirim pertanyaan ke `POST /v1/systemone`.
2. Laya memberikan dua keputusan:
   - `support_area`;
   - `is_urgent`.
3. Controller chat memanggil Laya secara paralel dengan pengecekan history dan recall memory.
4. Hasil Laya masuk sebagai hint internal ke LangChain agent.
5. Agent tetap wajib menggunakan `search_knowledge` untuk fakta dan prosedur.
6. Jika Laya timeout atau mati, NAVA tetap melanjutkan tanpa hint Laya.

### Area yang saat ini dipakai

```text
account_access      login, password, akses website
inventory_weight    stok, barang, berat, timbangan
sales_transaction   penjualan, pembelian, transaksi, faktur, nota
reports             laporan, report, summary, detail
printing            print, printer, popup, struk/dokumen
other               area belum jelas
```

Contoh metadata response:

```json
{
  "laya_source": "laya",
  "laya_area": "inventory_weight",
  "laya_urgent": false
}
```

Nilai `laya_source`:

- `laya`: keputusan berhasil diterima;
- `laya_unavailable`: Laya error atau timeout;
- `disabled`: integrasi dimatikan melalui environment.

## 6. Contoh keputusan Laya

Input:

```json
{
  "state": {
    "body": "Berat barang gak muncul pas tambah barang"
  },
  "model": "multilingual",
  "questions": {
    "support_area": {
      "type": "choice",
      "instructions": "Which helpdesk area best matches this customer request?",
      "criteria": {
        "inventory_weight": "stock, item weight, scale, weighing, inventory",
        "reports": "reports, summaries, details, missing report data",
        "other": "anything else or unclear"
      }
    },
    "is_urgent": {
      "type": "noul",
      "instructions": "Does the message clearly indicate an urgent outage or blocked operation?"
    }
  }
}
```

Hasil yang dipakai NAVA secara konseptual:

```json
{
  "answers": {
    "support_area": { "choice": "inventory_weight" },
    "is_urgent": { "noul": 0.12 }
  }
}
```

NAVA mengubah probabilitas `noul` menjadi boolean untuk metadata internal. Hasil tersebut tidak ditampilkan sebagai fakta kepada customer.

## 7. Use case yang dapat diterapkan di Nagatech

### A. Routing keluhan customer — prioritas utama

Gunakan `choice` untuk menentukan area:

```text
inventory_weight
sales_transaction
reports
printing
account_access
other
```

Hasilnya dapat digunakan untuk memilih prompt, knowledge scope, atau antrean helpdesk. Pada implementasi sekarang, hasilnya masih menjadi hint untuk satu agent NAVA, belum memecah agent menjadi beberapa service.

### B. Prioritas eskalasi

Gunakan `noul` atau `score` untuk mengenali indikasi:

- program tidak dapat dipakai sama sekali;
- seluruh transaksi gagal;
- customer meminta petugas segera;
- data transaksi atau laporan berdampak besar.

Laya hanya memberi sinyal awal. Keputusan membuat ticket tetap mengikuti aturan backend dan consent customer.

### C. Pemilihan tool investigasi Helpdesk

Untuk mode internal, Laya dapat membantu memilih kelompok operasi seperti:

```text
stock
sales_vs_cash
buyback_vs_cash
service_vs_cash
report_visibility
debt_vs_cash
```

Laya tidak boleh membuat aggregation atau memilih collection secara bebas. Setelah routing, LangChain tetap memvalidasi parameter dan menjalankan tool read-only yang diizinkan.

### D. Guardrail input

Laya memiliki integrasi `LayaGuardrail` untuk screening prompt injection, jailbreak, atau data sensitif. Ini cocok sebagai lapisan awal sebelum request diteruskan ke agent. Implementasi ini belum diaktifkan pada NAVA.

### E. Evaluasi jawaban NAVA

`LayaEvaluator` dapat dipelajari untuk menilai output berdasarkan rubric, misalnya:

- apakah jawaban menyebut langkah yang benar;
- apakah jawaban mengarang fakta;
- apakah jawaban menyarankan eskalasi pada kondisi yang tepat.

Ini cocok untuk pipeline QA/evaluation, bukan untuk menggantikan test dan review Helpdesk.

### F. Keputusan berbasis schema

`LayaDecision` dapat dipakai jika Nagatech membutuhkan output dengan schema tetap, misalnya:

```json
{
  "domain": "stock",
  "urgency": 2,
  "needs_human": false
}
```

Implementasi ini belum digunakan di NAVA karena backend NAVA berbasis Node.js dan saat ini memakai adapter HTTP sederhana.

## 8. Instalasi Laya lokal

Laya dijalankan sebagai service terpisah dari backend NAVA. Letaknya boleh di luar repository atau di subfolder terpisah; jangan mencampurkan virtual environment Python ke `api/node_modules`.

### Buat environment Python

Python minimal yang didukung adalah 3.10.

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT
mkdir -p laya-service
cd laya-service

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install "laya[serve]"
```

### Jalankan server

Untuk Mac dan testing lokal:

```bash
LAYA_HOST=127.0.0.1 \
LAYA_PORT=8000 \
LAYA_PRELOAD=1 \
laya-serve
```

Jika MPS bermasalah atau inference terlalu lama, jalankan CPU:

```bash
LAYA_DEVICE=cpu \
LAYA_HOST=127.0.0.1 \
LAYA_PORT=8000 \
LAYA_PRELOAD=1 \
laya-serve
```

Biarkan terminal ini tetap terbuka. Laya dapat mengunduh checkpoint pada startup pertama.

### Verifikasi

Buka terminal lain:

```bash
curl -sS http://localhost:8000/health
```

Jika berhasil, response memuat status `ok` dan daftar checkpoint yang loaded.

Tes langsung endpoint keputusan:

```bash
curl -sS -X POST http://localhost:8000/v1/systemone \
  -H 'Content-Type: application/json' \
  -d '{
    "state":{"body":"berat barang gak muncul pas tambah barang"},
    "model":"multilingual",
    "questions":{
      "support_area":{
        "type":"choice",
        "instructions":"Which helpdesk area best matches this request?",
        "criteria":{
          "inventory_weight":"stock, item weight, scale, weighing",
          "reports":"reports, summaries, details",
          "other":"anything else or unclear"
        }
      },
      "is_urgent":{
        "type":"noul",
        "instructions":"Does this clearly indicate an urgent blocked operation?"
      }
    }
  }'
```

### API key Laya

Untuk server lokal tanpa authentication, `LAYA_API_KEY` boleh kosong. Jika server dijalankan dengan:

```bash
LAYA_API_KEY=KEY_LAYA_ASLI laya-serve
```

isi nilai yang sama di `api/.env`:

```ini
LAYA_API_KEY=KEY_LAYA_ASLI
```

## 9. Hubungkan ke NAVA

Tambahkan di `api/.env`:

```ini
LAYA_ENABLED=true
LAYA_URL=http://localhost:8000
LAYA_MODEL=multilingual
LAYA_TIMEOUT_MS=5000
```

Restart backend NAVA:

```bash
cd /Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix/api
npm run dev
```

Tes dari NAVA:

```bash
curl -sS -X POST http://localhost:4000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"laya-demo-1","customer_id":"customer-laya-demo-001","question":"berat barang gak muncul pas tambah barang"}'
```

Cari metadata:

```json
"laya_source":"laya",
"laya_area":"inventory_weight"
```

Jika NAVA berjalan di Docker, `localhost` di dalam container bukan komputer host. Gunakan alamat service Compose atau, pada Docker Desktop Mac, biasanya:

```ini
LAYA_URL=http://host.docker.internal:8000
```

## 10. Cara kerja fallback

Laya tidak boleh menjadi single point of failure untuk chat customer:

1. NAVA memanggil Laya dengan timeout.
2. Jika response valid, hint diteruskan ke agent.
3. Jika timeout/error, NAVA mencatat `laya_unavailable` dan tetap menjalankan LangChain agent.
4. Agent tetap menggunakan RAG, tools, dan Hindsight sesuai konfigurasi.

Karena itu, Laya yang mati tidak otomatis membuat NAVA mati. Namun jika Laya dipakai untuk routing wajib ke banyak agent di masa depan, perlu fallback route yang jelas, misalnya `other` atau agent general.

## 11. Contoh rencana implementasi Nagatech

### Tahap 1 — sudah berjalan

- Triage area customer.
- Deteksi indikasi urgensi.
- Hint masuk ke LangChain agent.
- Fallback jika Laya tidak tersedia.
- Metadata untuk observability.

### Tahap 2 — kandidat berikutnya

- Pisahkan antrean helpdesk berdasarkan `support_area`.
- Tambahkan confidence threshold dan fallback `other`.
- Simpan hasil triage di trace, bukan di memory customer.
- Evaluasi akurasi dengan sampel pertanyaan customer Nagatech.

### Tahap 3 — workflow internal

- Routing operasi investigasi read-only.
- Guardrail sebelum agent dan sebelum tool sensitif.
- Evaluasi jawaban NAVA secara offline.
- Fine-tuning checkpoint jika data berlabel Nagatech sudah cukup.

## 12. Referensi resmi

- [Laya repository dan quickstart](https://github.com/NandhaKishorM/laya)
- [Laya + LangChain/LangGraph](https://github.com/NandhaKishorM/laya/blob/main/docs/langchain.md)
- [Laya HTTP/Docker server](https://github.com/NandhaKishorM/laya/blob/main/docs/docker.md)
- [Laya TypeScript/JavaScript client](https://github.com/NandhaKishorM/laya/blob/main/laya-ts/README.md)
