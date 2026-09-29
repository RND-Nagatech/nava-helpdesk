# Dokumentasi Fitur Investigasi Helpdesk

## 1. Tujuan

Investigasi Helpdesk adalah fitur internal untuk membantu Helpdesk menelusuri
selisih laporan dan relasi data NAGAGOLD melalui percakapan natural language.

Fitur ini ditujukan untuk Helpdesk, bukan customer. NAVA dapat membaca database
customer secara read-only, menjelaskan evidence yang ditemukan, dan memberikan
kandidat penyebab serta saran pengecekan sebelum data diperbaiki melalui
prosedur NAGAGOLD.

NAVA tidak mengubah, menghapus, atau memperbaiki data secara otomatis.

## 2. Komponen yang sudah dibuat

### 2.1 Room Investigasi Helpdesk

Helpdesk dapat membuka room investigasi dari menu Investigasi. Di dalam room:

1. Helpdesk memilih domain toko.
2. Helpdesk menulis kendala dengan bahasa biasa.
3. NAVA memahami konteks masalah.
4. NAVA mengambil knowledge internal yang relevan.
5. NAVA memilih operation investigasi.
6. Backend menjalankan pemeriksaan read-only ke database target.
7. NAVA menjelaskan hasil dalam format TEMUAN, EVIDENCE, KEMUNGKINAN PENYEBAB,
   dan SARAN PERBAIKAN.

Credential database tidak dimasukkan ke chat.

### 2.2.1 Terminologi lokasi NAGAGOLD

Pada data NAGAGOLD, istilah lokasi tidak sama dengan istilah bisnis umum:

```text
kode_gudang = gudang/ruangan/bangunan penyimpanan
kode_toko   = kode baki atau posisi nampan perhiasan
```

`kode_toko` bukan berarti kode toko atau kode cabang. Field database tetap
bernama `kode_toko` karena mengikuti schema NAGAGOLD, tetapi NAVA harus
menjelaskannya kepada Helpdesk sebagai kode baki/posisi. Helpdesk juga dapat
menulis `kode_baki` saat bertanya; backend memetakannya ke field `kode_toko`.

### 2.2 Target Database

Target database menyimpan mapping antara domain toko dan database NAGAGOLD.
Helpdesk cukup memilih domain, misalnya:

```text
italy.goldstore.id
```

Mapping target menentukan:

- domain;
- connection profile seperti `vm1`, `vm2`, atau `qc`;
- nama database tenant;
- status active atau disabled;
- profile collection yang diizinkan.

Connection string disimpan di environment backend, misalnya:

```ini
INVESTIGATION_MONGODB_URI_VM1=mongodb://read-only-user:password@host-vm1
INVESTIGATION_MONGODB_URI_VM2=mongodb://read-only-user:password@host-vm2
```

Satu connection profile dapat digunakan oleh banyak database tenant. Nama
database tenant tetap disimpan pada mapping target, bukan di frontend.

### 2.3 Knowledge Internal

Knowledge investigasi disimpan terpisah dari knowledge customer pada collection:

```text
tm_investigation_knowledge
```

Knowledge ini berisi:

- collection yang digunakan;
- field dan relasi;
- status transaksi;
- arti hasil report;
- kemungkinan penyebab;
- cara membaca evidence;
- operation yang dapat digunakan.

Knowledge internal tidak masuk ke jawaban customer dan tidak disimpan ke
long-term memory customer.

### 2.4 Operation Catalog

Operation catalog disimpan pada:

```text
tm_investigation_definition
```

Operation yang sudah tersedia:

```text
stock.detail_vs_summary
stock.opening_vs_previous_closing
finance.sales_vs_cash
finance.buyback_vs_cash
stock.buyback_vs_saldo
stock.opname_vs_saldo
stock.hancur_vs_saldo
finance.debt_vs_cash
service.status_vs_cash
stock.internal_transfer_vs_saldo
report.visibility_diagnostic
```

Definition operation memiliki nama, collection yang diizinkan, parameter,
relasi, metric, dan status publish. Operation yang belum published tidak boleh
dijalankan oleh NAVA.

### 2.5 Audit Investigasi

Setiap pemeriksaan dicatat secara ringkas pada:

```text
tt_investigation_run
```

Audit menyimpan domain, operation, filter, jumlah hasil, ringkasan temuan,
durasi, dan query hash. Credential dan seluruh isi database customer tidak
disalin ke audit.

## 3. Cara kerja eksekusi

Contoh pertanyaan:

```text
Kenapa uang buyback tanggal 2026-07-20 berbeda dengan laporan keuangan?
```

Alurnya:

1. Sistem mengambil domain yang dipilih pada room.
2. NAVA mencari knowledge internal tentang buyback dan keuangan.
3. NAVA memilih `finance.buyback_vs_cash`.
4. Backend memvalidasi parameter tanggal.
5. Backend mengambil data dari `tt_beli_detail`, `tt_beli_batal`, dan
   `tt_cash_daily`.
6. Backend mengembalikan evidence read-only.
7. NAVA menjawab berdasarkan evidence tersebut.

Jika tanggal, domain, report, atau identifier belum cukup jelas, NAVA meminta
informasi yang diperlukan dan tidak menebak.

## 4. Operation yang tersedia

### 4.1 `stock.detail_vs_summary`

Digunakan ketika barcode sudah diketahui dan Helpdesk ingin membandingkan data
detail, saldo, histori, master, dan summary.

Collection yang diperiksa:

```text
tm_barang
tt_barang_saldo
th_barang_saldo
tt_barang_summary
```

Relasi utama:

```text
kode_barcode
kode_toko (ditampilkan ke Helpdesk sebagai kode_baki/posisi nampan)
kode_gudang (gudang/ruangan/bangunan)
tanggal
```

Contoh pertanyaan:

```text
Barcode 10426840 tanggal 2026-07-20 di gudang TOKO kenapa saldo detail dan summary berbeda?
```

```text
Tolong cek barcode 11028176 di kode baki LT17 pada gudang TOKO, apakah stock_akhir pada saldo sama dengan summary tanggal 2026-07-20?
```

Hasil dapat menunjukkan:

- barcode tidak ditemukan di master;
- saldo tidak ditemukan;
- summary tidak ditemukan;
- nilai stock atau berat berbeda;
- master barang berbeda dengan saldo.

### 4.2 `stock.opening_vs_previous_closing`

Digunakan ketika barcode belum diketahui dan Helpdesk ingin mencari semua
barcode yang stock awalnya tidak sama dengan stock akhir hari sebelumnya.

Sumber utama:

```text
th_barang_saldo
```

Perbandingan:

```text
tanggal sebelumnya.stock_akhir
↔
tanggal sesudahnya.stock_awal
```

Pengelompokan dilakukan berdasarkan barcode, kode baki/posisi, dan kode gudang.

Contoh pertanyaan:

```text
Cari semua barcode yang stock awal 20 Juli 2026 tidak sama dengan stock akhir 19 Juli 2026 di gudang TOKO.
```

```text
Kenapa saldo awal tanggal 2026-07-20 berbeda dari saldo akhir 2026-07-19 untuk kode baki KLDLM di gudang TOKO?
Cari barcode yang bermasalah.
```

Jika tidak ada mutasi pada tanggal berjalan, NAVA dapat memberikan kandidat
carry-forward. Jika ada mutasi, NAVA hanya memberikan kandidat dan meminta
verifikasi lebih lanjut.

### 4.3 `finance.sales_vs_cash`

Digunakan untuk selisih laporan penjualan dengan laporan keuangan/cash.

Collection:

```text
tt_jual_detail
tt_jual_batal
tt_cash_daily
```

Relasi utama:

```text
tt_jual_detail.no_faktur_group
↔
tt_cash_daily.deskripsi
```

Operation mengikuti scope report penjualan NAGAGOLD, termasuk status
`status_valid=DONE`, `status_kembali=OPEN`, dan cash `status=OPEN`.

Contoh pertanyaan:

```text
Laporan penjualan tanggal 2026-07-20 sampai 2026-07-20 berbeda dengan uang cash. Cari faktur yang selisih.
```

```text
Total penjualan dan keuangan tanggal 2026-07-01 sampai 2026-07-07 tidak sama.
Tolong cek apakah ada pembayaran atau cash yang hilang.
```

Hasil dapat membedakan:

- `MISSING_CASH`;
- `MISSING_SALE`;
- `AMOUNT_DIFFERENCE`;
- `CANCELLATION_NOT_OFFSET`;
- `PAYMENT_NOT_EMBEDDED`;
- perbedaan tanggal pencatatan.

### 4.4 `finance.buyback_vs_cash`

Digunakan untuk pembelian kembali barang dari customer atau buyback. Ini bukan
pembelian supplier.

Collection:

```text
tt_beli_detail
tt_beli_batal
tt_cash_daily
```

Relasi utama:

```text
tt_beli_detail.no_faktur_group
↔
tt_cash_daily.deskripsi
```

Nilai yang dibandingkan:

```text
tt_beli_detail.harga
tt_beli_detail.pembayaran[].jumlah_rp
tt_cash_daily.jumlah_out
tt_beli_batal.harga
```

Contoh pertanyaan:

```text
Uang keluar untuk buyback customer tanggal 2026-07-20 berbeda dengan laporan pembelian.
Tolong cari nomor faktur dan nominal yang selisih.
```

```text
Laporan pembelian dari customer tanggal 2026-07-01 sampai 2026-07-07 ada,
tetapi total cash keluar tidak sama. Cek transaksi buyback yang bermasalah.
```

Operation dapat menemukan:

- buyback ada tetapi cash belum ditemukan;
- cash buyback ada tetapi detail buyback tidak ditemukan;
- nominal buyback berbeda dengan cash keluar;
- buyback dibatalkan tetapi arus pembatalan belum seimbang;
- detail pembayaran buyback tidak terbaca.

Kategori `PEMBELIAN`, `BATAL BELI`, dan `BATAL PEMBELIAN` dipisahkan. Jika
field kategori cash terenkripsi, NAVA akan memberi peringatan dan tidak
menebak kategori tersebut.

### 4.5 `stock.buyback_vs_saldo`

Digunakan jika transaksi buyback sudah ada tetapi barang atau stoknya tidak
muncul.

Collection:

```text
tt_beli_detail
tt_barang_saldo
```

Relasi utama:

```text
tanggal
kode_barcode
kode_gudang
```

Nilai yang dibandingkan:

```text
Jumlah baris buyback
tt_beli_detail.berat
tt_barang_saldo.stock_beli
tt_barang_saldo.berat_beli
```

Contoh pertanyaan:

```text
Buyback tanggal 2026-07-20 di gudang TOKO sudah DONE, tetapi stok beli tidak bertambah.
Cari barcode yang tidak masuk saldo.
```

```text
Ada pembelian kembali customer tanggal 2026-07-19 sampai 2026-07-20,
tetapi laporan stok tidak menampilkan semua barangnya. Tolong bandingkan buyback dengan saldo.
```

Hasil dapat menunjukkan:

- `SALDO_NOT_FOUND`;
- `BUYBACK_NOT_REFLECTED_IN_SALDO`;
- `PARTIAL_BUYBACK_STOCK_MUTATION`.

Setelah itu Helpdesk tetap perlu memeriksa transfer, opname, hancur, sortir,
kirim, dan terima sebelum mengubah data.

### 4.6 `service.status_vs_cash`

Digunakan untuk memeriksa service yang tidak muncul di cash, nominal pembayaran
yang berbeda, atau status service yang tidak sesuai dengan arus pembayaran.

Collection:

```text
tt_service_detail
tt_cash_daily
```

Relasi utama:

```text
tt_service_detail.no_faktur_service
↔
tt_cash_daily.deskripsi
```

Kategori cash yang dibedakan:

```text
SERVICE        = pembayaran saat service masuk
SERVICE AMBIL  = pembayaran saat service diambil
BATAL SERVICE  = pengembalian saat service dibatalkan
```

Contoh pertanyaan:

```text
Service tidak muncul di laporan cash tanggal 2026-07-20. Cari service yang belum punya pasangan cash.
```

```text
Service SV-20260920-0001 sudah dibatalkan, tetapi uang customer belum kembali. Cek status dan cash-nya.
```

### 4.7 `stock.internal_transfer_vs_saldo`

Digunakan untuk pindah barang internal antar-baki atau antar-gudang dalam
cabang yang sama. Ini bukan pemeriksaan kirim barang antar-cabang.

Collection:

```text
tt_pindah_barang_manual
tt_barang_saldo_manual
```

Relasi dan movement:

```text
tt_pindah_barang_manual.kode_dept
↔
tt_barang_saldo_manual.kode_barcode

lokasi asal   → stock_out / berat_out
lokasi tujuan → stock_tambah / berat_tambah
```

Contoh pertanyaan:

```text
Pindah barang nomor PB-20260920-0001 dari kode baki A01 ke B02 sudah tercatat, tetapi saldo baki tujuan belum bertambah. Tolong cek.
```

```text
Kenapa pindah barang dari gudang TOKO ke gudang BELI tidak mengurangi saldo asal sesuai jumlah yang dipindahkan?
```

Operation ini tidak membaca `tt_kirim_barang`; pengiriman ke cabang lain tetap
berada di luar scope.

### 4.8 `stock.opname_vs_saldo`

Digunakan untuk mencari barcode yang hasil stock opname-nya berbeda dengan saldo
akhir pada tanggal dan lokasi yang sama.

Collection:

```text
tt_opname
tt_barang_saldo
```

Relasi grain:

```text
tgl_opname ↔ tanggal
kode_barcode ↔ kode_barcode
kode_gudang ↔ kode_gudang
kode_toko ↔ kode_toko (kode baki/posisi)
```

`status_barang=OPEN` berarti barcode belum terkonfirmasi pada proses opname;
`DONE` berarti barcode sudah ditemukan. Nilai `stock_on_hand` dan `berat` dari
opname dibandingkan dengan `stock_akhir` dan `berat_akhir` saldo. Operation ini
read-only dan tidak menulis hasil opname ke saldo.

Contoh pertanyaan:

```text
Hasil stock opname tanggal 2026-07-20 berbeda dengan saldo gudang TOKO. Cari barcode yang selisih.
```

```text
Barcode 11028176 pada opname masih OPEN atau sudah tercermin di saldo tanggal 2026-07-20?
```

### 4.9 `stock.hancur_vs_saldo`

Digunakan untuk memeriksa hancur barang manual terhadap saldo manual.

Collection:

```text
tt_hancur_barang_manual
tt_barang_saldo_manual
```

Pada flow NAGAGOLD, `kode_dept` pada transaksi hancur dipakai sebagai kode
barcode saat controller memanggil update saldo. Transaksi `stock` dan `berat`
dibandingkan dengan `stock_hancur` dan `berat_hancur`. Setelah hancur,
`stock_akhir` dan `berat_akhir` saldo diharapkan menjadi nol.

Contoh pertanyaan:

```text
Barang hancur tanggal 2026-07-20 sudah ada, tetapi saldo manualnya masih tersisa. Cari barcode dan nomor hancurnya.
```

```text
Kenapa stock_hancur pada saldo tidak sama dengan transaksi hancur WM-20260720-0001?
```

### 4.10 `finance.debt_vs_cash`

Digunakan untuk hutang atau cicilan yang nominal/statusnya tidak cocok dengan
cash. Nomor faktur menjadi penghubung ke `tt_cash_daily.deskripsi`.

Collection:

```text
tt_hutang_detail
tt_cicilan
tt_cash_daily
```

Relasi dan kategori yang diperiksa:

```text
tt_hutang_detail.no_faktur_hutang → tt_cash_daily.deskripsi
tt_cicilan.no_faktur_cicil       → tt_cash_daily.deskripsi

Hutang: HUTANG, HUTANG LUNAS, HUTANG BATAL, BATAL HUTANG LUNAS, BAYAR BUNGA
Cicilan: DP CICILAN, BAYAR CICILAN, PELUNASAN CEPAT CICILAN, BATAL CICILAN
```

Untuk hutang, operation membandingkan `jumlah_hutang` dengan cash pembentukan
hutang dan `total_bayar` dengan cash pelunasan/bunga. Untuk cicilan, operation
menggunakan `harga_jual_cicil - sisa_bayar` sebagai total pembayaran yang
seharusnya sudah diterima, lalu memperhitungkan kategori pembatalan. Karena
sumber memakai `tgl_system` sedangkan cash memakai `tanggal`, pergeseran hari
ditampilkan sebagai hal yang perlu diverifikasi, bukan langsung dianggap cash
hilang.

Contoh pertanyaan:

```text
Hutang tanggal 2026-07-20 tidak sama dengan cash. Cari faktur yang cash HUTANG-nya hilang atau nominalnya berbeda.
```

```text
Cicilan tanggal 2026-07-20 sudah berstatus bayar, tetapi cash BAYAR CICILAN tidak sesuai. Tolong cek semua nomor faktur.
```

### 4.11 `report.visibility_diagnostic`

Digunakan ketika Helpdesk mengatakan data tidak muncul di report tertentu.

Context yang didukung:

```text
buyback
sales
cash
service
debt
stock
```

Operation memeriksa collection sumber, tanggal, identifier, gudang, status,
dan relasi cash jika diperlukan. Untuk laporan Barang/Summary, sumber tidak
boleh diasumsikan selalu histori: sistem membaca `tp_system.tgl_system` lebih
dulu. Jika tanggal report sama dengan tanggal system aktif, sumbernya
`tt_barang_saldo`; jika tanggal lebih lama, sumbernya `th_barang_saldo`.

Contoh pertanyaan:

```text
Transaksi buyback nomor group TRX-001 ada di database tetapi tidak muncul di report pembelian tanggal 2026-07-20.
```

```text
Data service tanggal 2026-07-20 tidak muncul di report service selesai.
Tolong cek apakah datanya ada dan status prosesnya apa.
```

Contoh lain:

```text
Faktur hutang HTG-001 ada, tetapi tidak muncul di laporan keuangan.
Periksa data hutang dan relasinya ke cash.
```

```text
Barcode 10426840 tidak muncul di laporan stock tanggal 2026-07-20.
Tolong cek apakah histori saldonya memang tidak ada atau hanya terfilter.
```

Operation membedakan:

- `SOURCE_NOT_FOUND`;
- data sumber ada tetapi status perlu diperiksa;
- relasi ke `tt_cash_daily` tidak ditemukan;
- kemungkinan filter tanggal atau gudang tidak sesuai.

Nama report/menu tetap penting karena NAGAGOLD memiliki beberapa profile report
dengan filter status dan tanggal yang berbeda.

## 5. Format jawaban NAVA

Jika ditemukan selisih, jawaban diarahkan ke format:

```markdown
## TEMUAN

Barcode dan masalah yang benar-benar ditemukan.

## EVIDENCE

Nilai sumber, nilai pembanding, status, dan selisih.

## KEMUNGKINAN PENYEBAB

Penyebab yang didukung evidence.

## SARAN PERBAIKAN

Collection, filter, current, expected, dan pengecekan sebelum koreksi.
```

NAVA tidak boleh mengatakan database sudah diperbaiki. Semua saran koreksi
harus dianggap kandidat sampai Helpdesk memvalidasi dan menerapkannya melalui
prosedur atau UI NAGAGOLD.

## 6. Batasan dan keamanan

- Hanya room Investigasi Helpdesk yang dapat memakai database investigation.
- Customer chat tidak dapat memanggil operation ini.
- LLM tidak boleh membuat aggregation bebas.
- Collection yang boleh dibaca dibatasi oleh operation.
- Query memiliki timeout dan batas jumlah hasil.
- Operator `$out`, `$merge`, update, delete, insert, `$where`, `$function`, dan
  JavaScript arbitrary dilarang.
- Credential tidak disimpan di knowledge, chat, frontend, atau audit.
- Database NAGAGOLD tidak diubah otomatis.
- Kategori cash tertentu dapat terenkripsi; jika tidak terbaca, NAVA harus
  menyebutkan keterbatasan tersebut.
- Hasil pemeriksaan hanya berlaku untuk domain, periode, gudang, status, dan
  profile report yang diperiksa.

## 7. File implementasi terkait

- Backend operation: `api/src/services/investigation-service.js`
- Operation catalog: `api/src/services/investigation-definition-service.js`
- Agent tool: `api/src/tools/helpdesk-tools.js`
- Prompt investigasi: `api/src/agents/agent-prompt.js`
- Knowledge internal: `api/data/investigation-knowledge.json`
- Import knowledge: `api/scripts/import-investigation-knowledge.js`
- UI room: `web/src/pages/helpdesk/InvestigationPage.tsx`
- Rencana keamanan dan arsitektur: `planning.md`

## 8. Import knowledge setelah perubahan

Jika knowledge internal diubah atau ditambah, jalankan dari folder `api`:

```bash
npm run investigation:knowledge:import:published
```

Operation built-in akan terdaftar saat server dijalankan. Operation baru yang
dibuat melalui menu Kelola Operation harus memiliki pipeline read-only yang
valid dan dipublish oleh Admin sebelum dapat digunakan.
