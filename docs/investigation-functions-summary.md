# Ringkasan Fungsi Investigasi Helpdesk

Dokumentasi singkat untuk penggunaan room **Investigasi Helpdesk**. Semua fungsi
bersifat **read-only**: NAVA hanya membaca dan membandingkan data, tidak mengubah
database customer.

Catatan lokasi NAGAGOLD:

- `kode_gudang` = gudang/ruangan/bangunan penyimpanan.
- `kode_toko` = kode baki/nampan/posisi barang, bukan kode cabang.

## 1. Selisih Barang Detail dan Summary

**Fungsi**

Mencari perbedaan data barang pada level barcode antara saldo, master barang,
dan laporan summary.

**Relasi collection**

- `tm_barang` → master barang dan `stock_on_hand`.
- `tt_barang_saldo` → saldo barang berdasarkan tanggal, barcode, gudang, dan baki.
- `th_barang_saldo` → saldo historis.
- `tt_barang_summary` → data summary pada scope gudang dan baki.

**Contoh pertanyaan**

> Barcode 11028176 tanggal 2026-07-20 berbeda antara barang detail dan summary. Tolong cek.

> Kenapa stock akhir barcode 10426840 di laporan detail tidak sama dengan summary gudang TOKO dan baki LT17?

## 2. Selisih Opening dan Closing Antarhari

**Fungsi**

Mencari barcode yang `stock_akhir` hari sebelumnya tidak sama dengan
`stock_awal` hari berikutnya. Barcode tidak perlu diketahui terlebih dahulu.

**Relasi collection**

- `th_barang_saldo` → saldo historis dua tanggal.
- Pembanding utama: `stock_akhir` tanggal sebelumnya ↔ `stock_awal` tanggal berikutnya.

**Contoh pertanyaan**

> Kenapa stock awal 20 Juli 2026 tidak sama dengan stock akhir 19 Juli 2026?

> Cari semua barcode di gudang TOKO yang opening tanggal 2026-07-20 berbeda dari closing tanggal 2026-07-19.

## 3. Selisih Penjualan dan Keuangan

**Fungsi**

Membandingkan pembayaran penjualan dengan penerimaan cash, termasuk pembatalan
dan adjustment.

**Relasi collection**

- `tt_jual_detail` → detail penjualan dan pembayaran.
- `tt_jual_batal` → transaksi penjualan yang dibatalkan.
- `tt_cash_daily` → cash kategori penjualan.
- Relasi utama: `tt_jual_detail.no_faktur_group` ↔ `tt_cash_daily.deskripsi`.

**Contoh pertanyaan**

> Total uang laporan penjualan tanggal 2026-07-20 berbeda dengan laporan keuangan. Cari faktur yang selisih.

> Ada penjualan yang sudah DONE tetapi cash PENJUALAN-nya tidak ditemukan. Tolong cek.

## 4. Selisih Buyback Customer dan Keuangan

**Fungsi**

Membandingkan transaksi pembelian kembali dari customer dengan uang yang keluar
di cash. Ini bukan pembelian dari supplier.

**Relasi collection**

- `tt_beli_detail` → detail buyback customer.
- `tt_beli_batal` → pembatalan buyback.
- `tt_cash_daily` → cash kategori `PEMBELIAN`, `BATAL BELI`, atau `BATAL PEMBELIAN`.
- Relasi utama: `tt_beli_detail.no_faktur_group` ↔ `tt_cash_daily.deskripsi`.

**Contoh pertanyaan**

> Buyback customer tanggal 2026-07-20 sudah DONE, tetapi uang pembeliannya tidak muncul di cash. Cek faktur yang bermasalah.

> Kenapa nominal buyback nomor group BLI-001 tidak sama dengan cash keluar?

## 5. Buyback Customer dan Saldo Barang

**Fungsi**

Memastikan barang hasil buyback masuk ke saldo melalui `stock_beli` dan
`berat_beli`.

**Relasi collection**

- `tt_beli_detail` → barcode dan berat barang buyback.
- `tt_barang_saldo` → `stock_beli` dan `berat_beli`.
- `tm_barang` → validasi master barang bila diperlukan.

**Contoh pertanyaan**

> Buyback barcode 10426840 sudah selesai, tetapi stock_beli di saldo masih nol. Tolong cek.

> Cari barcode buyback tanggal 2026-07-20 yang beratnya belum masuk ke saldo barang.

## 6. Status Service dan Cash

**Fungsi**

Memeriksa kesesuaian status service dengan pembayaran, pengambilan barang, dan
pembatalan/refund.

**Relasi collection**

- `tt_service_detail` → status dan detail service.
- `tt_cash_daily` → kategori `SERVICE`, `SERVICE AMBIL`, dan `BATAL SERVICE`.
- Relasi utama: `tt_service_detail.no_faktur_service` ↔ `tt_cash_daily.deskripsi`.

**Contoh pertanyaan**

> Service SV-001 sudah dibatalkan, tetapi uang customer belum kembali. Tolong cek.

> Cari service tanggal 2026-07-20 yang pembayarannya belum masuk ke cash.

## 7. Pindah Barang Internal dan Saldo

**Fungsi**

Memeriksa perpindahan barang antar-baki atau antar-gudang dalam cabang yang
sama. Fungsi ini tidak memeriksa kirim barang antar-cabang.

**Relasi collection**

- `tt_pindah_barang_manual` → movement barang yang seharusnya terjadi.
- `tt_barang_saldo_manual` → movement saldo asal dan tujuan.
- Relasi utama: `tt_pindah_barang_manual.kode_dept` ↔ `tt_barang_saldo_manual.kode_barcode`.
- Lokasi asal: `stock_out` dan `berat_out`.
- Lokasi tujuan: `stock_tambah` dan `berat_tambah`.

**Contoh pertanyaan**

> Pindah barang dari baki A01 ke B02 sudah tercatat, tetapi saldo baki B02 belum bertambah. Tolong cek.

> Kenapa saldo gudang asal belum berkurang setelah pindah barang tanggal 2026-07-20?

## 8. Stock Opname dan Saldo

**Fungsi**

Membandingkan hasil stock opname dengan saldo akhir pada tanggal, barcode,
gudang, dan baki yang sama.

**Relasi collection**

- `tt_opname` → hasil dan status proses opname.
- `tt_barang_saldo` → saldo akhir barang.
- `tt_opname.status_barang=OPEN` berarti barcode belum terkonfirmasi;
  `DONE` berarti sudah ditemukan.

**Contoh pertanyaan**

> Hasil stock opname tanggal 2026-07-20 berbeda dengan saldo gudang TOKO. Cari barcode yang selisih.

> Barcode 11028176 pada proses opname masih OPEN atau sudah sesuai dengan saldo?

## 9. Hancur Barang dan Saldo Manual

**Fungsi**

Memastikan transaksi barang hancur tercatat pada movement saldo dan saldo akhir
menjadi nol.

**Relasi collection**

- `tt_hancur_barang_manual` → transaksi hancur.
- `tt_barang_saldo_manual` → `stock_hancur`, `berat_hancur`, dan saldo akhir.
- Pada flow NAGAGOLD, `tt_hancur_barang_manual.kode_dept` dipakai sebagai
  `tt_barang_saldo_manual.kode_barcode`.

**Contoh pertanyaan**

> Barang hancur nomor WM-001 sudah tercatat, tetapi saldo akhirnya masih ada. Tolong cari penyebabnya.

> Kenapa `stock_hancur` di saldo tidak sama dengan transaksi hancur tanggal 2026-07-20?

## 10. Hutang/Cicilan dan Cash

**Fungsi**

Memeriksa kesesuaian transaksi hutang atau cicilan dengan cash masuk/keluar dan
status pelunasannya.

**Relasi collection**

- `tt_hutang_detail.no_faktur_hutang` ↔ `tt_cash_daily.deskripsi`.
- `tt_cicilan.no_faktur_cicil` ↔ `tt_cash_daily.deskripsi`.
- Kategori hutang: `HUTANG`, `HUTANG LUNAS`, `HUTANG BATAL`, `BATAL HUTANG LUNAS`, `BAYAR BUNGA`.
- Kategori cicilan: `DP CICILAN`, `BAYAR CICILAN`, `PELUNASAN CEPAT CICILAN`, `BATAL CICILAN`.

**Contoh pertanyaan**

> Hutang tanggal 2026-07-20 tidak sama dengan cash. Cari nomor faktur dan nominal yang selisih.

> Cicilan sudah berstatus bayar, tetapi cash BAYAR CICILAN tidak sesuai. Tolong cek.

## 11. Diagnosis Data Tidak Muncul di Report

**Fungsi**

Mencari penyebab data tidak muncul pada report, misalnya karena filter tanggal,
status, identifier, gudang, atau relasi cash tidak ditemukan.

**Relasi collection**

Collection yang dipilih mengikuti report yang disebut Helpdesk, antara lain:

- `tt_beli_detail` untuk buyback.
- `tt_jual_detail` untuk penjualan.
- `tt_cash_daily` untuk keuangan.
- `tt_service_detail` untuk service.
- `tt_hutang_detail` untuk hutang.
- `th_barang_saldo` untuk saldo historis.

**Contoh pertanyaan**

> Transaksi buyback ada di database tetapi tidak muncul di laporan pembelian. Tolong cek filter dan statusnya.

> Faktur hutang ada, tetapi tidak muncul di laporan keuangan. Cari apakah relasi cash atau statusnya yang bermasalah.

## Cara Menggunakan

1. Buka menu **Investigasi**.
2. Pilih domain Goldstore customer.
3. Tanyakan kendala dengan bahasa biasa.
4. NAVA memilih fungsi yang sesuai dan menjalankan pemeriksaan read-only.
5. Hasil menampilkan temuan, evidence, kemungkinan penyebab, dan saran pemeriksaan.

Jika hasil menyebutkan kandidat koreksi, Helpdesk tetap harus memverifikasi
transaksi terkait dan melakukan perubahan melalui prosedur resmi NAGAGOLD.
