# NAVA v2.3.0 — Fast LLM-First + Lightweight Cross-Session Context

Versi 2.3.0 mempertahankan karakter jawaban v2 yang cepat dan to the point, sambil mengambil hanya bagian v3 yang benar-benar relevan untuk NAVA saat ini.

## Tujuan utama

1. Mengembalikan agent menjadi singleton seperti v2 awal agar tidak dibuat ulang setiap request.
2. Mempertahankan hybrid keyword + vector + problem reranking dari v2.1/v2.2.
3. Memperkecil payload knowledge yang dibaca DeepSeek.
4. Memastikan identitas NAVA jelas: **NAVA adalah AI Helpdesk Nagatech / Nagatech Virtual Assistant**, bukan nama program customer.
5. Menambah konteks lintas session secara ringan menggunakan `customer_id`, tanpa LangGraph Checkpointer penuh.
6. Mengurangi cold-start search dengan warm-up embedding pada startup.

## Cross-session context

Request lama tetap valid:

```json
{
  "session_id": "session-001",
  "question": "struknya gak keluar"
}
```

Untuk mengaktifkan konteks lintas session, kirim `customer_id` yang stabil:

```json
{
  "session_id": "session-001",
  "customer_id": "CUST001",
  "question": "angka dari timbangan gak masuk"
}
```

Lalu pada session baru:

```json
{
  "session_id": "session-002",
  "customer_id": "CUST001",
  "question": "yang kemarin kambuh lagi"
}
```

NAVA akan mengambil beberapa potongan konteks session sebelumnya milik customer yang sama.

### Yang disertakan

- pesan customer dari session sebelumnya;
- jawaban NAVA lama **hanya bila jawaban tersebut grounded ke primary knowledge**.

### Yang tidak dilakukan

- tidak menyimpan state LangGraph per langkah;
- tidak menjalankan summarization LLM tambahan;
- tidak menganggap chat lama sebagai knowledge resmi;
- tidak otomatis mengubah percakapan customer menjadi knowledge global.

Hal terakhir disengaja. Auto-learning global tanpa validasi bisa membuat kesalahan satu chat menyebar ke semua customer. Jika nanti dibutuhkan, lebih aman membuat pipeline **resolved case -> review -> knowledge candidate -> publish**.

## Fitur v3 yang tetap relevan dan dipertahankan secara ringan

- metadata runtime;
- agent trace;
- batas pencarian per turn;
- retrieval evaluation;
- grounding + primary evidence;
- reset session;
- cross-session context ringan.

## Fitur v3 yang belum dipakai

- MongoDB/LangGraph Checkpointer penuh;
- Conversation Summarization;
- Long-Term Store bebas;
- Middleware lifecycle kompleks;
- forced structured output;
- Human-in-the-Loop;
- automatic global learning from chat.

Alasannya bukan karena fitur tersebut buruk, tetapi NAVA saat ini lebih banyak melakukan pola pendek:

```text
customer -> pahami -> search knowledge -> jawab
```

Menambah state graph pada setiap langkah belum memberi benefit sebanding dengan latency/kompleksitasnya.

## Optimasi performa v2.3

### Agent singleton

Agent dibuat sekali:

```text
startup -> createAgent sekali -> reuse untuk semua request
```

State pencarian per request disimpan memakai Node.js `AsyncLocalStorage`, sehingga limit pencarian tidak bocor antar request.

### Payload knowledge lebih kecil

Jika primary evidence sudah ditemukan, DeepSeek menerima:

- primary article lengkap;
- maksimal 2 kandidat pendukung dalam bentuk ringkas.

Ia tidak lagi membaca 5 artikel penuh sekaligus.

### Embedding warm-up

Default:

```env
EMBEDDING_WARMUP_ON_START=true
```

Model E5 dimuat ketika server start agar search customer pertama tidak menanggung cold-start embedding.

