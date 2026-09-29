# Hindsight Memory untuk NAVA

## Tujuan

Integrasi ini menambahkan memori historis customer tanpa mengganti knowledge resmi NAVA.

| Jenis informasi | Sumber utama |
| --- | --- |
| Prosedur, menu, langkah troubleshooting | NAVA RAG + knowledge published |
| Status database realtime | Investigation tools |
| Riwayat masalah customer | Hindsight memory |
| Langkah yang sudah dicoba customer | Hindsight memory |
| Ticket, eskalasi, dan pengalaman helpdesk | Hindsight memory setelah grounded/eskalasi |

## Alur runtime

1. Request masuk dengan `customer_id`.
2. NAVA membaca MongoDB memory lama dan, bila aktif, melakukan Hindsight `recall`.
3. Agent menerima knowledge resmi dan konteks memory secara terpisah.
4. Jawaban tetap mengikuti knowledge resmi NAVA.
5. Setelah jawaban selesai, kasus grounded atau eskalasi dikirim ke Hindsight melalui `retain` asynchronous.

Jika Hindsight tidak aktif, tidak tersedia, timeout, atau gagal, NAVA tetap memakai MongoDB memory dan RAG seperti sebelumnya.

## Isolasi dan keamanan

- Setiap customer memakai bank Hindsight yang ID-nya berasal dari hash `customer_id`; ID asli tidak dikirim sebagai nama bank.
- Memory Hindsight hanya dipakai sebagai konteks historis, bukan sumber fakta program realtime.
- Retain tidak dilakukan untuk chat biasa yang belum grounded atau belum dieskalasikan.
- Jangan masukkan password, API key, credential, data pembayaran, atau isi database customer mentah ke memory.
- `HINDSIGHT_ENABLED` default `false` agar deployment lama tidak berubah behavior sebelum service siap.

## Contoh perbedaan

Pertanyaan:

> Error timbangan muncul lagi, kemarin saya sudah coba apa?

Sebelum Hindsight, NAVA hanya memiliki pertanyaan saat ini dan knowledge resmi. NAVA kemungkinan meminta customer mengulangi langkah yang sudah dicoba.

Sesudah Hindsight, recall dapat mengembalikan:

> Customer sudah mencoba menjalankan ulang aplikasi Timbangan, tetapi masalah masih terjadi.

Dengan konteks itu, NAVA dapat mengakui langkah sebelumnya dan melanjutkan ke langkah berikutnya atau menyarankan eskalasi.

Jalankan demo deterministik:

```bash
cd api
node scripts/demo-hindsight-memory.js
```

## Pengujian

Test unit integrasi:

```bash
cd api
node --test tests/hindsight-memory.test.js
```

Demo tersebut tidak membutuhkan service Hindsight karena memakai hasil recall contoh. Pengujian end-to-end membutuhkan Hindsight yang aktif dan `HINDSIGHT_ENABLED=true`.
