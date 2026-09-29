# Integrasi Laya ke NAVA

## Peran Laya

Laya dipakai sebagai System-1 triage: keputusan kecil dan cepat sebelum LangChain agent menjawab. Pada implementasi ini Laya memberi dua hint:

- `support_area`: area keluhan seperti timbangan/berat, transaksi, laporan, akses, atau printing;
- `is_urgent`: apakah pesan terlihat sebagai gangguan mendesak.

Hint tersebut hanya masuk ke prompt internal agent. NAVA tetap wajib memanggil `search_knowledge` untuk prosedur dan fakta produk. Hindsight tetap menangani memory customer; Laya tidak menyimpan memory.

## Menjalankan

Laya adalah service terpisah dari backend NAVA. Setelah server Laya berjalan pada port 8000, set:

```env
LAYA_ENABLED=true
LAYA_URL=http://localhost:8000
LAYA_MODEL=multilingual
LAYA_TIMEOUT_MS=500
```

Jika deployment Laya memakai bearer token, isi `LAYA_API_KEY`. Restart `api` setelah mengubah `.env`.

## Alur request

```text
customer question
       |
       v
Laya: area + urgency (fast hint, timeout 500 ms)
       |
       v
Hindsight recall + LangChain agent + RAG/tools
       |
       v
grounded answer
       |
       v
Hindsight retain
```

Saat Laya tidak tersedia, request tidak gagal hanya karena Laya. Runtime metadata dapat dipakai untuk verifikasi:

```json
{
  "laya_source": "laya",
  "laya_area": "inventory_weight",
  "laya_urgent": false
}
```

Nilai `laya_source` menjadi `laya_unavailable` jika request ke Laya gagal, atau `disabled` jika `LAYA_ENABLED=false`.

Referensi resmi Laya:

- https://github.com/NandhaKishorM/laya/blob/main/docs/index.md
- https://github.com/NandhaKishorM/laya/blob/main/docs/langchain.md
