# Planning: Read-only Database Investigation untuk Helpdesk NAVA

## 1. Ringkasan

Tambahkan fitur investigasi database khusus Helpdesk melalui room Investigasi Helpdesk.

Helpdesk cukup menyebutkan atau memilih domain/toko, misalnya:

~~~text
italy
italy.goldstore.id
~~~

NAVA kemudian:

1. memahami konteks masalah;
2. menentukan relasi collection berdasarkan struktur asli NAGAGOLD;
3. menjalankan pemeriksaan database secara read-only;
4. menjelaskan bukti dan kemungkinan penyebab selisih;
5. memberikan usulan patch data;
6. membantu Helpdesk melakukan pengecekan ulang.

NAVA tidak melakukan perubahan data otomatis.

Target fitur ini adalah Helpdesk, bukan customer. Fitur tidak boleh memengaruhi chat customer, ticket production, memory customer, atau metrik dashboard customer.

### Terminologi lokasi NAGAGOLD

Istilah lokasi pada data NAGAGOLD harus dibaca sesuai struktur fisiknya:

- `kode_gudang` adalah gudang, ruangan, atau bangunan tempat penyimpanan.
- `kode_toko` adalah kode baki/nampan atau posisi perhiasan di dalam gudang, bukan nama toko dan bukan kode cabang.
- Pada percakapan, Helpdesk boleh menyebut `kode_baki`; backend menormalkannya menjadi field mentah `kode_toko`.
- Pada jawaban, NAVA harus menggunakan istilah kode baki/posisi dan kode gudang agar tidak menyesatkan. Nama field database `kode_toko` tetap ditampilkan bila diperlukan untuk pencocokan dengan data NAGAGOLD.
- `domain/toko` pada pemilihan target database tetap berarti domain customer. Istilah itu berbeda dari field saldo `kode_toko`.

## 2. Akses Database

Helpdesk tidak boleh menempelkan connection string, username, password, atau API key ke chat.

Domain menjadi identitas tenant dan target database:

~~~text
italy.goldstore.id
        ↓
tenant/domain mapping + connection profile
        ↓
VM/cluster → nama database NAGAGOLD
        ↓
read-only query
~~~

NAVA membutuhkan konfigurasi internal seperti:

~~~text
domain
connection_profile
database_name
allowed_collection_profile
status
~~~

Pada struktur NAGAGOLD, `TenantEntity.tenant_id` mengikuti identitas domain.
Karena itu Helpdesk cukup memilih domain; `tenant_id` tidak perlu diinput
manual dan dapat diisi backend dari domain yang sudah dinormalisasi.

`connection_profile` adalah nama profil server/VM, misalnya `vm1`, `vm2`, atau
`qc`. Satu profile dapat memiliki banyak database. `database_name` menunjuk
database NAGAGOLD yang digunakan target tersebut.

Mapping dapat disimpan pada collection kontrol baru:

~~~text
tm_investigation_target
~~~

Collection tersebut hanya menyimpan mapping target. Password dan connection
string disimpan melalui environment atau secret manager, bukan collection
biasa. Mapping tidak pernah membawa secret ke frontend atau chat.

Contoh mapping:

~~~json
{
  "domain": "italy.goldstore.id",
  "tenant_id": "italy.goldstore.id",
  "connection_profile": "vm1",
  "database_name": "db_italy",
  "status": "active"
}
~~~

Konfigurasi secret backend menggunakan nama profile:

~~~ini
INVESTIGATION_MONGODB_URI_VM1=mongodb://READ_ONLY_USER:PASSWORD@VM1_HOST/?tls=true
INVESTIGATION_MONGODB_URI_VM2=mongodb://READ_ONLY_USER:PASSWORD@VM2_HOST/?tls=true
INVESTIGATION_MONGODB_URI_QC=mongodb://READ_ONLY_USER:PASSWORD@QC_HOST/?tls=true
INVESTIGATION_MONGODB_DEFAULT_PROFILE=default
~~~

Untuk deployment satu VM, `INVESTIGATION_MONGODB_URI` tetap dapat digunakan
sebagai fallback profile `default`.

Jika domain belum dikonfigurasi, NAVA harus menjawab bahwa target database belum tersedia dan tidak boleh menebak database.

NAGAGOLD memakai database tenant melalui TenantEntity dan DBManager.useDb(). Sebagian field juga dapat terenkripsi. Tahap awal wajib memeriksa:

- koneksi read-only dapat dibuat;
- target tenant dapat ditemukan dari domain;
- field yang dibutuhkan dapat dibaca;
- hasil query tidak berupa data terenkripsi yang tidak dapat dipahami;
- query selesai dalam batas waktu yang aman.

Jika direct MongoDB read tidak dapat membaca field tertentu karena enkripsi NAGAGOLD, gunakan adapter atau sidecar read-only yang mengikuti logic resolusi tenant dan dekripsi NAGAGOLD tanpa mengubah source code NAGAGOLD.

## 3. Penyimpanan Data

NAVA tidak menyalin seluruh database customer.

Pembagian penyimpanan:

| Data | Lokasi |
|---|---|
| Knowledge customer production | tm_knowledge_helpdesk |
| Panduan investigasi internal | tm_investigation_knowledge |
| Definition operation investigasi terstruktur | tm_investigation_definition |
| Percakapan Investigasi Helpdesk | tt_chat_training dengan room_type: investigation |
| Message percakapan | tt_chat_training_message |
| Target domain dan izin database | tm_investigation_target |
| Audit query dan hasil ringkas | tt_investigation_run |
| Resep investigasi yang dapat dieksekusi | tm_investigation_playbook |

tt_investigation_run hanya menyimpan metadata minimum:

- Helpdesk yang menjalankan query;
- domain/tenant;
- operation yang digunakan;
- collection yang dibaca;
- filter;
- jumlah hasil;
- ringkasan temuan;
- query hash;
- durasi;
- usulan patch;
- waktu eksekusi.

Dokumen customer lengkap, password, token, dan data sensitif tidak disimpan di NAVA.

## 4. Target Pengguna dan Batasan

Fitur hanya tersedia pada room Investigasi Helpdesk dan endpoint yang dilindungi requireHelpdeskAuth.

Fitur tidak boleh tersedia pada:

- customer chat;
- endpoint /api/chat;
- long-term memory customer;
- ticket otomatis;
- dashboard metrik customer.

Helpdesk dapat bertanya dengan bahasa natural:

~~~text
Kenapa laporan barang detail dan summary beda untuk barcode 12345 tanggal 2026-09-14?
~~~

NAVA harus menjelaskan relasi dan bukti secara manusiawi, bukan sekadar menampilkan query mentah.

## 5. Alur Kerja Investigasi

### 5.1 Menentukan target

NAVA mengambil domain dari konteks chat atau meminta Helpdesk mengisinya:

~~~text
Untuk toko/domain mana pemeriksaan ini dilakukan?
~~~

### 5.2 Memahami masalah

NAVA menentukan konteks berdasarkan pertanyaan dan Playbook published yang tersedia. Playbook adalah resep investigasi yang berisi contoh pertanyaan, parameter, collection yang diizinkan, aggregation read-only, aturan membaca hasil, dan panduan koreksi.

Operation read-only bawaan yang masih dipertahankan sebagai fallback adalah:

~~~text
stock.detail_vs_summary
stock.opening_vs_previous_closing
finance.sales_vs_cash
finance.buyback_vs_cash
stock.buyback_vs_saldo
stock.opname_vs_saldo
stock.hancur_vs_saldo
finance.debt_vs_cash
report.visibility_diagnostic
~~~

Operation tersebut mengikuti handler built-in yang telah divalidasi terhadap
logic report NAGAGOLD. Untuk kasus baru, Admin tidak perlu menambah operation
atau mengubah script backend selama kasus tersebut dapat dijelaskan dengan
aggregation yang diizinkan oleh generic Playbook executor.

Jika parameter belum cukup, NAVA meminta data spesifik seperti tanggal/periode, kode baki/posisi (field `kode_toko`), kode gudang, kode barcode, nomor faktur, nomor faktur group, nama laporan, atau nilai yang terlihat berbeda.

### 5.3 Mengambil knowledge internal

NAVA menggunakan panduan yang bersumber dari entity, repository, controller, dan implementasi laporan NAGAGOLD. Panduan investigasi tidak boleh otomatis menjadi knowledge customer. Artikel customer production tetap berada di `tm_knowledge_helpdesk`. Panduan internal investigasi disimpan terpisah di `tm_investigation_knowledge`, sedangkan definition operation terstruktur disimpan di `tm_investigation_definition`. Definition diisi melalui form agar dapat digunakan Helpdesk yang tidak terbiasa dengan JSON; konfigurasi `execution.pipeline` hanya tersedia sebagai konfigurasi lanjutan untuk Admin yang memahami MongoDB aggregation.

`tm_investigation_knowledge` dipakai sebagai panduan retrieval lexical khusus
room Investigasi. Collection ini tidak di-embed ke Qdrant customer dan tidak
pernah dibaca oleh customer chat. `tm_investigation_definition` tetap menjadi
registry operation legacy. Resep baru disimpan di
`tm_investigation_playbook` dan dapat dipanggil generic engine jika sudah
berstatus `published` serta memiliki pipeline read-only yang tervalidasi.

Knowledge internal berisi:

- collection yang relevan;
- field yang digunakan;
- relasi antar-collection;
- status transaksi;
- aggregation yang diperbolehkan;
- kemungkinan penyebab selisih;
- cara memvalidasi hasil;
- cara melakukan perbaikan melalui prosedur NAGAGOLD.

Knowledge internal tidak menggantikan Playbook. Knowledge menjelaskan konteks,
relasi, status, dan cara membaca evidence; Playbook menjalankan aggregation
read-only dan mengembalikan nilai aktual dari database target.

### 5.4 Menjalankan query read-only

NAVA tidak menerima aggregation bebas dari LLM. NAVA hanya memanggil Playbook
atau operation legacy yang sudah berstatus `published` dan tervalidasi.

Playbook baru disimpan terpisah dari artikel customer dan panduan internal.
Playbook memuat:

- `name`, `description`, dan `trigger_examples` untuk pemilihan dari bahasa natural;
- `aggregation_source` berupa satu aggregation lengkap, misalnya `db.th_barang_saldo.aggregate([...])`;
- backend menurunkan collection sumber dari `db.<collection>.aggregate`, collection `$lookup` dari pipeline, serta parameter dari placeholder `{{nama_parameter}}`;
- `execution.source_collection` dan `execution.pipeline` hasil parsing aggregation untuk runtime;
- `finding_rules` untuk menentukan kondisi match, mismatch, atau data kosong;
- `correction_guidance` untuk menjelaskan current, expected, filter, dan pemeriksaan sebelum koreksi;
- `response_template` dan `safety_notes` untuk membentuk jawaban Helpdesk.

Dengan pola ini, orang yang memahami relasi NAGAGOLD cukup membuat dan menguji
Playbook dari menu Playbook Investigasi. Penambahan kasus baru tidak memerlukan
perubahan script backend, selama masih dapat dijalankan dengan collection,
operator aggregation, dan batas keamanan yang tersedia. Perubahan kode hanya
diperlukan jika membutuhkan logic khusus yang tidak dapat diekspresikan oleh
generic Playbook executor.

### 16.2.1 Eksekusi bertahap untuk data besar

Playbook yang membandingkan laporan Barang Detail dan Barang Summary memakai
strategi eksekusi bertahap `stock_summary_vs_detail`. Strategi ini tetap
read-only dan tidak mengubah database customer:

1. Baca lebih dulu `tt_barang_saldo` untuk tanggal aktif.
2. Jika Summary kosong, ambil sampel terbatas dari `tm_barang` sebagai bukti
   bahwa Detail memiliki data; sistem tidak melakukan `group` dan `$lookup`
   terhadap seluruh Detail.
3. Jika Summary berisi data, batasi perbandingan pada barcode Summary yang
   relevan lalu cocokkan dengan `tm_barang` menggunakan field lokasi yang sama.
4. Batasi jumlah baris hasil dan waktu setiap fase agar room Investigasi tidak
   menunggu aggregation besar tanpa batas.

`$limit` di akhir pipeline saja tidak dianggap sebagai pembatas beban, karena
MongoDB tetap harus menyelesaikan `group` dan `$lookup` sebelumnya. Index pada
field tanggal dan key relasi boleh direkomendasikan kepada pengelola database,
tetapi NAVA tidak membuat index atau melakukan perubahan apa pun pada database
customer secara otomatis.

Form Playbook tidak meminta Admin mengisi `executor_id`, `operation_id`, daftar
collection, field, parameter, atau jumlah hasil secara terpisah. Admin/tim
teknis cukup menempelkan satu aggregation lengkap yang memahami relasi
NAGAGOLD. Backend membaca collection, lookup, placeholder parameter, dan limit
dari aggregation tersebut. Helpdesk yang memakai fitur tidak perlu melihat
detail konfigurasi tersebut.

Generic executor melakukan:

1. memilih Playbook berdasarkan pertanyaan dan contoh pertanyaan;
2. meminta hanya parameter wajib yang belum disebutkan;
3. memvalidasi parameter dan collection allowlist;
4. mengganti placeholder seperti `{{tanggal}}` dengan parameter yang sudah divalidasi;
5. menjalankan pipeline dengan timeout, batas hasil, dan `allowDiskUse` terkontrol;
6. mengembalikan rows, aturan temuan, panduan koreksi, dan template jawaban;
7. menyimpan audit minimum tanpa menyimpan credential atau menulis database customer.

Artikel internal tetap dapat menjelaskan konteks bisnis, tetapi bukan tempat
untuk mengeksekusi query. Artikel customer tidak pernah mendapat hasil atau
isi Playbook internal.

Contoh request internal:

~~~json
{
  "domain": "italy.goldstore.id",
  "operation_id": "stock.opening_vs_previous_closing",
  "params": {
    "tanggal_sebelumnya": "2026-07-19",
    "tanggal_sesudahnya": "2026-07-20",
    "kode_toko": "ITY",
    "kode_gudang": "GD1"
  }
}
~~~

Query dibentuk oleh backend berdasarkan operation yang sudah disetujui.

Dilarang menjalankan $out, $merge, update, delete, insert, $where, $function, mapReduce, dan arbitrary JavaScript.

Setiap query memiliki timeout, batas jumlah dokumen, projection field, collection allowlist, dan audit.

## 6. Sumber Knowledge dari NAGAGOLD

### 6.1 Selisih Barang Detail dan Summary

Collection utama:

~~~text
tm_barang
tt_barang_saldo
th_barang_saldo
tt_barang_summary
~~~

Relasi utama:

~~~text
kode_barcode
kode_toko
kode_gudang
tanggal
~~~

tm_barang merupakan master barang dan saldo terkini. Field pentingnya antara lain kode_barcode, kode_barang, kode_group, kode_dept, kode_gudang, kode_toko, stock_on_hand, berat, status_hancur, tgl_last_beli, dan tgl_last_jual.

tt_barang_saldo menyimpan saldo operasional per barang, kode baki/posisi, kode gudang, dan tanggal:

~~~text
stock_awal
stock_in
stock_out
stock_beli
stock_jual
stock_hancur
stock_akhir
berat_awal
berat_in
berat_out
berat_beli
berat_jual
berat_hancur
berat_akhir
~~~

th_barang_saldo digunakan untuk histori saldo. tt_barang_summary berisi ringkasan berdasarkan kode baki/posisi, kode gudang, dan tanggal dengan field saldo dan mutasi yang serupa.

Kemungkinan penyebab selisih:

- filter tanggal berbeda;
- filter kode baki/posisi atau kode gudang berbeda;
- laporan detail memakai grain barcode sedangkan summary memakai grain kode baki/posisi dan kode gudang;
- tm_barang.stock_on_hand tidak sama dengan tt_barang_saldo.stock_akhir;
- histori saldo belum terbentuk;
- transaksi masuk atau keluar belum masuk ke saldo;
- transaksi batal belum mengembalikan saldo;
- barang tidak memiliki master pada tm_barang;
- duplikasi saldo berdasarkan barcode, kode baki/posisi, kode gudang, dan tanggal;
- status transaksi tidak sesuai dengan filter laporan.

Urutan pemeriksaan:

1. Cari barcode pada tm_barang.
2. Cari barcode, kode baki/posisi, kode gudang, dan tanggal pada tt_barang_saldo.
3. Cari histori tanggal yang sama pada th_barang_saldo.
4. Bandingkan hasilnya dengan tt_barang_summary.
5. Bandingkan grain dan filter laporan sebelum menyimpulkan ada kerusakan data.

### 6.1.1 Selisih stock awal dan stock akhir antarhari

Untuk pertanyaan seperti:

~~~text
Kenapa stock awal 20 Juli 2026 tidak sama dengan stock akhir 19 Juli 2026?
~~~

Helpdesk belum perlu mengetahui barcode. Sumber utama pemeriksaan adalah
`th_barang_saldo`, karena kasus ini menyangkut tanggal historis, bukan saldo
realtime pada `tt_barang_saldo`.

Operation:

~~~text
stock.opening_vs_previous_closing
~~~

Backend membaca histori pada dua tanggal dan mengelompokkan data berdasarkan:

~~~text
kode_barcode + kode_baki/posisi (field kode_toko) + kode_gudang
~~~

Kemudian backend membandingkan:

~~~text
th_barang_saldo[19 Juli].stock_akhir
↔
th_barang_saldo[20 Juli].stock_awal

th_barang_saldo[19 Juli].berat_akhir
↔
th_barang_saldo[20 Juli].berat_awal
~~~

Hasil harus menampilkan barcode, kode baki/posisi, kode gudang, nilai pada kedua tanggal, dan
besar selisih. Jika salah satu tanggal tidak memiliki baris histori, hasilnya
ditandai sebagai data tanggal yang hilang, bukan langsung dianggap stok hilang.
Hasil dibatasi agar aman; Helpdesk dapat mempersempit dengan kode baki/posisi
atau kode gudang jika daftar selisih terlalu banyak.

### 6.2 Selisih Buyback dan Keuangan

Dalam NAGAGOLD, pembelian pada konteks ini adalah pembelian barang dari customer atau buyback, bukan pembelian dari supplier.

Konteks ini memakai operation read-only bawaan:

~~~text
finance.buyback_vs_cash
~~~

Collection:

~~~text
tt_beli_detail
tt_beli_batal
tt_cash_daily
~~~

Relasi utama:

~~~text
tt_beli_detail.no_faktur_group
↔
tt_cash_daily.deskripsi
~~~

tt_beli_detail menyimpan antara lain no_faktur_group, no_faktur_beli, no_faktur_jual, tgl_system, kode_barcode, kode_gudang, berat, harga, harga_nota, pembayaran, status_valid, status_sortir, status_kirim, dan status_terima.

tt_cash_daily digunakan untuk pembayaran buyback, termasuk kategori PEMBELIAN. tt_beli_batal menyimpan pembatalan buyback.

Kemungkinan penyebab:

- transaksi buyback ada tetapi cash belum terbentuk;
- nominal cash berbeda dengan total pembayaran;
- transaksi masih berstatus OPEN;
- transaksi dibatalkan tetapi cash pembatalan tidak sesuai;
- no_faktur_group tidak cocok dengan deskripsi;
- satu group memiliki lebih dari satu detail pembayaran;
- tanggal transaksi dan tanggal cash berbeda;
- barcode atau berat transaksi tidak sama dengan saldo barang;
- buyback masuk ke stock tetapi belum masuk laporan keuangan.

Operation membandingkan detail buyback, status transaksi, pembayaran, cash
terkait, serta data pembatalan. Jika kategori cash tidak dapat dibaca karena
enkripsi NAGAGOLD, hasil tetap diberi sebagai evidence relasi/arus tetapi
kategori tidak ditebak.

Kriteria hasil:

- `MISSING_BUYBACK_CASH`: buyback ada tetapi cash berelasi tidak ditemukan;
- `MISSING_BUYBACK`: cash kategori pembelian ada tetapi buyback tidak ditemukan;
- `BUYBACK_AMOUNT_DIFFERENCE`: nominal buyback/pembayaran berbeda dari cash keluar bersih;
- `CANCELLATION_NOT_OFFSET`: terdapat pembatalan tetapi nominal bersih belum cocok;
- `BUYBACK_PAYMENT_NOT_EMBEDDED`: harga buyback ada tetapi rincian pembayaran tidak terbaca.

Field `harga` dan `pembayaran.jumlah_rp` ditampilkan terpisah karena report EOD
dan report pembayaran NAGAGOLD tidak selalu menggunakan field nominal yang sama.

### 6.3 Buyback Tidak Masuk Saldo Barang

Konteks ini memakai operation:

~~~text
stock.buyback_vs_saldo
~~~

Backend mencari `tt_beli_detail` berstatus `DONE`, mengelompokkan berdasarkan
tanggal, barcode, dan gudang, lalu mencocokkan jumlah baris dan berat dengan:

~~~text
tt_barang_saldo.stock_beli
tt_barang_saldo.berat_beli
~~~

Hasil yang mungkin:

- `SALDO_NOT_FOUND`: buyback ada tetapi baris saldo tidak ditemukan;
- `BUYBACK_NOT_REFLECTED_IN_SALDO`: saldo ada tetapi stock_beli dan berat_beli nol;
- `PARTIAL_BUYBACK_STOCK_MUTATION`: hanya sebagian buyback masuk saldo.

Operation tidak langsung menyimpulkan bahwa data harus diubah. Setelah hasil
ditemukan, Helpdesk perlu memeriksa transfer, opname, hancur, sortir, kirim,
dan terima karena proses tersebut dapat mengubah saldo setelah buyback.

### 6.4 Diagnosis Data Tidak Muncul pada Report

Konteks ini memakai operation:

~~~text
report.visibility_diagnostic
~~~

Helpdesk perlu menyebutkan nama report/menu atau konteksnya. Context yang
didukung:

~~~text
buyback | sales | cash | service | debt | stock
~~~

Collection sumber dan field tanggal ditentukan oleh konteks:

- `buyback` → `tt_beli_detail.tgl_system`;
- `sales` → `tt_jual_detail.tgl_system`;
- `cash` → `tt_cash_daily.tanggal`;
- `service` → `tt_service_detail.tgl_system` sebagai titik awal, lalu periksa `tgl_selesai`, `tgl_ambil`, atau `tgl_batal` sesuai report;
- `debt` → `tt_hutang_detail.tgl_system` dan status hutang;
- `stock` → ditentukan dari `tp_system.tgl_system`: `tt_barang_saldo.tanggal` untuk tanggal system aktif, atau `th_barang_saldo.tanggal` untuk tanggal historis.

Operation memeriksa:

1. apakah data sumber memang ada;
2. apakah tanggal dan gudang sesuai;
3. apakah statusnya tersaring oleh report;
4. apakah identifier/faktur ditemukan;
5. apakah relasi ke `tt_cash_daily.deskripsi` tersedia jika report membutuhkan cash.

Hasil tidak ditemukan tidak langsung disebut sebagai bug. Kemungkinannya dapat
berupa data belum dibuat, status belum sesuai, tanggal report berbeda, lookup
tidak menemukan pasangan, atau report memakai profile khusus.

### 6.5 Service dan Keuangan

Konteks service menggunakan operation read-only bawaan:

~~~text
service.status_vs_cash
~~~

Collection:

~~~text
tt_service_detail
tt_cash_daily
~~~

Relasi utama:

~~~text
tt_service_detail.no_faktur_service
↔
tt_cash_daily.deskripsi
~~~

Kategori cash yang harus dibedakan:

~~~text
SERVICE        = pembayaran saat service masuk
SERVICE AMBIL  = pembayaran saat service diambil
BATAL SERVICE  = pengembalian saat service dibatalkan
~~~

Status `status_proses` membedakan service masuk, selesai, diambil, dan batal.
Tanggal sumber service memakai `tgl_system`, sedangkan cash memakai `tanggal`.
Jika service berstatus `CANC` tetapi `BATAL SERVICE` belum ada, hasilnya menjadi
kandidat refund yang belum tercatat. Jika cash `BATAL SERVICE` ada sementara
status service belum `CANC`, hasilnya menjadi kandidat status tidak sinkron.

Konteks hutang dan cicilan menggunakan operation read-only bawaan:

~~~text
finance.debt_vs_cash
~~~

Collection:

~~~text
tt_hutang_detail
tt_cicilan
tt_cash_daily
~~~

Relasi:

~~~text
tt_hutang_detail.no_faktur_hutang → tt_cash_daily.deskripsi
tt_cicilan.no_faktur_cicil       → tt_cash_daily.deskripsi
~~~

Kategori cash hutang yang dipisahkan adalah `HUTANG`, `HUTANG LUNAS`,
`HUTANG BATAL`, `BATAL HUTANG LUNAS`, dan `BAYAR BUNGA`. Kategori cicilan
adalah `DP CICILAN`, `BAYAR CICILAN`, `PELUNASAN CEPAT CICILAN`, dan
`BATAL CICILAN`.

Untuk hutang, backend membandingkan `jumlah_hutang` dengan cash pembentukan
hutang dan `total_bayar` dengan cash pelunasan/bunga. Untuk cicilan, nilai
pembayaran yang sudah terjadi dibaca dari `harga_jual_cicil - sisa_bayar` dan
dibandingkan dengan cash cicilan setelah pembatalan. `tgl_system` transaksi
dan `tanggal` cash diproses terpisah agar pergeseran tanggal tidak disimpulkan
sebagai kehilangan uang.

Operation ini tidak melakukan write. Jika ada selisih, NAVA menampilkan nomor
faktur, status, kategori cash, nilai expected, actual, dan kandidat penyebab.

### 6.6 Pindah Barang Internal dan Mutasi Saldo

Pindah barang internal berbeda dari kirim barang. Pindah barang dapat memindahkan
perhiasan dari satu baki ke baki lain atau dari gudang ke gudang lain dalam
cabang yang sama. Kirim barang antar-cabang tidak termasuk operation ini.

Operation:

~~~text
stock.internal_transfer_vs_saldo
~~~

Collection:

~~~text
tt_pindah_barang_manual
tt_barang_saldo_manual
~~~

Relasi utama:

~~~text
tt_pindah_barang_manual.kode_dept
↔
tt_barang_saldo_manual.kode_barcode
~~~

Movement yang dibandingkan:

- report pindah `stock` dan `berat` adalah expected movement;
- lokasi asal harus mencatat `stock_out` dan `berat_out`;
- lokasi tujuan harus mencatat `stock_tambah` dan `berat_tambah`;
- lokasi dibaca dari pasangan gudang dan baki asal/tujuan.

Pada flow manual NAGAGOLD, `kode_dept` pada report pindah menjadi identifier
`kode_barcode` pada saldo manual. Operation tidak membaca `tt_kirim_barang` dan
tidak boleh menyimpulkan masalah pengiriman antar-cabang dari hasil ini.

### 6.7 Stock Opname dan Saldo

Operation:

~~~text
stock.opname_vs_saldo
~~~

Collection:

~~~text
tt_opname
tt_barang_saldo
~~~

Relasi grain menggunakan `tgl_opname ↔ tanggal`, `kode_barcode`,
`kode_gudang`, dan `kode_toko` sebagai kode baki/posisi. Backend membaca
`stock_on_hand` dan `berat` dari opname, lalu membandingkannya dengan
`stock_akhir` dan `berat_akhir` pada saldo. `status_barang=OPEN` berarti
barcode belum terkonfirmasi pada proses opname; `DONE` berarti sudah ditemukan.

### 6.8 Hancur Barang dan Saldo Manual

Operation:

~~~text
stock.hancur_vs_saldo
~~~

Collection:

~~~text
tt_hancur_barang_manual
tt_barang_saldo_manual
~~~

Pada controller NAGAGOLD, `kode_dept` pada transaksi hancur manual dipakai
sebagai `kode_barcode` ketika saldo diperbarui. Backend membandingkan `stock`
dan `berat` transaksi dengan `stock_hancur` dan `berat_hancur`, serta memeriksa
bahwa `stock_akhir` dan `berat_akhir` menjadi nol. Operation tidak memperbaiki
saldo otomatis.

### 6.9 Selisih Penjualan dan Keuangan

Konteks ini menggunakan operation read-only bawaan:

~~~text
finance.sales_vs_cash
~~~

Collection:

~~~text
tt_jual_detail
tt_jual_batal
tt_cash_daily
~~~

Relasi utama menggunakan nomor group/faktur dan detail pembayaran. Field penting penjualan antara lain no_faktur_group, no_faktur_jual, tgl_system, kode_barcode, kode_gudang, harga_total, pembayaran, status_valid, status_kembali, dan status_tukar.

Operation mengikuti logic report EOD NAGAGOLD:

- `tt_jual_detail.tgl_system` berada pada rentang tanggal yang diminta;
- `tt_jual_detail.status_valid = DONE`;
- `tt_jual_detail.status_kembali = OPEN`;
- `tt_cash_daily.tanggal` berada pada rentang tanggal yang diminta;
- `tt_cash_daily.status = OPEN`;
- relasi utama menggunakan `no_faktur_group = deskripsi`;
- pembayaran dibandingkan dari `pembayaran.jumlah_rp`, bukan langsung dari `harga_total`;
- cash penjualan dibaca dari kategori `PENJUALAN`;
- `BATAL PENJUALAN`, `CASHBACK`, `KEMBALI LEBIH BAYAR`, `TUKAR KURANG`, `KELEBIHAN BAYAR DP PENJUALAN`, `LEBIH BAYAR PENJUALAN`, dan `KELEBIHAN PO` dihitung sebagai adjustment terpisah.

Kriteria hasil:

- `MATCH`: expected payment sama dengan net cash setelah adjustment;
- `MISSING_CASH`: penjualan/pembayaran ada, tetapi cash `PENJUALAN` tidak ditemukan;
- `MISSING_SALE`: cash `PENJUALAN` ada, tetapi penjualan dalam scope tidak ditemukan;
- `AMOUNT_DIFFERENCE`: nominal net cash berbeda dari expected payment;
- `CANCELLATION_NOT_OFFSET`: pembatalan ada, tetapi hasil net belum cocok;
- `PAYMENT_NOT_EMBEDDED`: nilai penjualan ada tetapi detail pembayaran tidak terbentuk/terbaca;
- `DATE_SHIFT`: tanggal transaksi dan tanggal cash berbeda sehingga perlu ditelusuri sebagai perbedaan waktu pencatatan, bukan langsung dianggap uang hilang.

Kemungkinan penyebab:

- penjualan belum memiliki cash;
- pembayaran sebagian;
- transaksi kredit;
- transaksi dibatalkan;
- cash masuk pada tanggal berbeda;
- status_valid tidak masuk filter laporan;
- detail pembayaran tidak sama dengan cash harian;
- transaksi tukar atau titip diperlakukan berbeda oleh laporan.

NAVA harus membedakan selisih karena aturan bisnis, waktu pencatatan, status transaksi, atau data yang memang tidak lengkap. Operation mengembalikan evidence per `no_faktur_group`, termasuk total pembayaran, cash penjualan, cash pembatalan, adjustment, net cash, dan selisih.

### 6.10 Selisih Saldo Antarhari

Collection:

~~~text
th_barang_saldo
tt_barang_saldo
tt_barang_summary
~~~

Validasi dasar:

~~~text
saldo akhir hari sebelumnya
≈
saldo awal hari berikutnya
~~~

Setelah itu NAVA membandingkan stock_in, stock_out, stock_beli, stock_jual, stock_hancur, dan stock_tambah.

NAVA mengarahkan Helpdesk untuk memeriksa transaksi yang dibuat setelah tutup hari, transaksi batal, stock in/out, proses hancur, transfer barang, opname, dan perbedaan gudang.

Collection tambahan hanya boleh dimasukkan setelah diverifikasi dari source code NAGAGOLD. NAVA tidak boleh mengarang nama collection.

## 7. Format Jawaban Investigasi

Jawaban room Investigasi harus singkat, langsung ke hasil, dan tidak diawali
perkenalan panjang. Jika query berhasil menemukan selisih, gunakan heading
berikut secara berurutan:

~~~markdown
## TEMUAN

Barcode 122XXX mengalami ketidaksesuaian saldo antara 19 dan 20 Juli.

## EVIDENCE

19 Juli
stock akhir: 4

20 Juli
stock awal: 5

Movement yang ditemukan: tidak ada transaksi +1.

## KEMUNGKINAN PENYEBAB

Saldo awal tanggal 20 Juli tidak mengikuti saldo akhir tanggal 19 Juli.

## SARAN PERBAIKAN

Collection: th_barang_saldo
Filter: tanggal = 2026-07-20, barcode = 122XXX
Current: stock_awal = 5
Expected: stock_awal = 4

Sebelum koreksi: pastikan tidak ada transaksi backdate atau stock opname pada interval tersebut.
~~~

Aturan format:

- `TEMUAN` hanya menyebutkan barcode, toko, gudang, tanggal, dan status yang benar-benar ditemukan.
- `EVIDENCE` menampilkan field dan nilai yang dibandingkan serta mutasi yang ditemukan.
- `KEMUNGKINAN PENYEBAB` membedakan fakta dari dugaan dan tidak membuat teori umum yang tidak didukung hasil.
- `SARAN PERBAIKAN` menampilkan collection, filter, current, expected, risiko, dan pemeriksaan sebelum koreksi.
- Nilai `expected` hanya boleh ditampilkan jika diberikan backend sebagai `correction_candidate`. Jika belum pasti, NAVA harus menulis bahwa koreksi belum dapat ditentukan.
- Jika tidak ada selisih, NAVA menjelaskan bahwa mismatch tidak ditemukan pada data yang tersedia.
- Jika query gagal atau target belum terkonfigurasi, NAVA hanya menjelaskan kegagalan dan tidak membuat heading seolah-olah ada temuan.
- NAVA tidak menampilkan query mentah yang panjang kecuali Helpdesk memintanya.

NAVA tidak boleh mengatakan bahwa database sudah diperbaiki. NAVA hanya menyampaikan usulan berdasarkan hasil read-only.

## 8. Patch Data

Versi pertama hanya menghasilkan usulan patch manual.

Usulan patch wajib mencantumkan:

~~~text
collection
filter atau identifier
nilai saat ini
nilai yang diharapkan
alasan perubahan
risiko
cara menerapkan
cara rollback atau pengecekan ulang
~~~

Helpdesk menerapkan perubahan melalui UI NAGAGOLD, endpoint resmi NAGAGOLD, atau prosedur maintenance yang telah disetujui.

NAVA tidak menjalankan updateOne, deleteOne, insertOne, atau operasi write lain.

## 9. Endpoint dan Tool

Endpoint inti pemeriksaan database:

~~~text
POST /api/investigation/:trainingId/database-check
GET  /api/investigation/:trainingId/runs
~~~

Keduanya wajib menggunakan autentikasi Helpdesk. Daftar endpoint investigasi
lainnya untuk session, knowledge, operation, dan target database tercantum pada
bagian **Endpoint v1** di bagian implementasi.
Endpoint `database-check` juga wajib memastikan `trainingId` adalah room
investigasi milik Helpdesk yang sedang login; token Helpdesk saja tidak cukup
untuk mengakses room atau audit milik petugas lain.

Contoh response:

~~~json
{
  "read_only": true,
  "status": "difference_found",
  "operation_id": "stock.opening_vs_previous_closing",
  "target": {
    "domain": "italy.goldstore.id",
    "tenant_id": "italy.goldstore.id",
    "connection_profile": "vm1",
    "database_name": "db_italy"
  },
  "collections_used": [
    "tm_barang",
    "tt_barang_saldo",
    "th_barang_saldo"
  ],
  "filters": {
    "tanggal_sebelumnya": "2026-09-13",
    "tanggal_sesudahnya": "2026-09-14",
    "kode_toko": "ITY",
    "kode_gudang": "TOKO"
  },
  "summary": {
    "difference_count": 1
  },
  "evidence": {
    "rows": [
      {
        "kode_barcode": "122XXX",
        "kode_toko": "ITY",
        "kode_gudang": "TOKO",
        "previous": {
          "tanggal": "2026-09-13",
          "stock_akhir": 4
        },
        "current": {
          "tanggal": "2026-09-14",
          "stock_awal": 5,
          "movements": {}
        },
        "stock_difference": 1
      }
    ]
  },
  "findings": [
    {
      "code": "OPENING_CARRY_FORWARD_MISMATCH",
      "kode_barcode": "122XXX",
      "stock_difference": 1,
      "correction_candidate": {
        "field": "stock_awal",
        "current": 5,
        "expected": 4,
        "confidence": "high"
      }
    }
  ],
  "correction_candidates": [
    {
      "field": "stock_awal",
      "current": 5,
      "expected": 4,
      "confidence": "high"
    }
  ],
  "warnings": [],
  "duration_ms": 120,
  "query_hash": "..."
}
~~~

Tool agent:

~~~text
inspect_customer_database
~~~

Tool hanya menerima operation_id yang terdaftar di operation catalog. Operation bawaan seperti pemeriksaan saldo tetap dapat menggunakan handler khusus, sedangkan operation baru dapat menggunakan definition declarative yang sudah dipublish.

## 10. Keamanan dan Operasional

- Hanya Helpdesk authenticated yang dapat menggunakan fitur.
- Customer tidak dapat memanggil endpoint investigasi.
- Database user wajib memiliki permission read-only.
- Koneksi menggunakan TLS dan network allowlist.
- Query hanya ke collection yang diizinkan.
- Semua query memiliki timeout dan batas hasil.
- Data customer sensitif disamarkan.
- Connection string tidak ditulis ke log.
- Secret tidak disimpan di chat, knowledge, atau collection biasa.
- Tidak ada arbitrary MongoDB query dari LLM.
- Tidak ada write otomatis.
- Semua aktivitas dicatat ke audit.
- Hasil audit memiliki retention/TTL yang dapat dikonfigurasi.

## 11. Tahap Implementasi

### Tahap 0 — Validasi sumber NAGAGOLD

- Petakan entity, repository, controller, dan laporan yang benar-benar digunakan.
- Validasi tenant dan database berdasarkan domain.
- Uji koneksi read-only menggunakan satu tenant.
- Identifikasi field yang terenkripsi.
- Ukur waktu query dan batas data.

### Tahap 1 — Investigasi stock

Implementasi awal:

~~~text
stock.detail_vs_summary
stock.opening_vs_previous_closing
~~~

Collection:

~~~text
tm_barang
tt_barang_saldo
th_barang_saldo
tt_barang_summary
~~~

Pada operasi `stock.detail_vs_summary`, `kode_barcode` dipakai untuk menelusuri
master dan saldo barcode. Pembanding terhadap `tt_barang_summary` tidak hanya
menggunakan satu barcode, karena summary NAGAGOLD berada pada level scope toko
dan gudang. Sistem menghitung agregat `tt_barang_saldo` untuk tanggal, toko, dan
gudang yang sama, lalu membandingkannya dengan dokumen summary pada scope itu.
Dengan begitu hasil investigasi tidak menyimpulkan selisih summary hanya dari
satu baris barcode.

Pada operasi `stock.opening_vs_previous_closing`, `th_barang_saldo` menjadi
sumber historis utama. Operation ini tidak meminta barcode sebagai parameter;
backend mencari semua pasangan barcode/toko/gudang pada dua tanggal, lalu
melaporkan pasangan yang nilai `stock_akhir` tanggal sebelumnya berbeda dari
`stock_awal` tanggal sesudahnya.

### Tahap 2 — Investigasi buyback dan keuangan

~~~text
buyback.cash_reconcile
buyback.stock_reconcile
buyback.cancel_reconcile
~~~

Collection:

~~~text
tt_beli_detail
tt_beli_batal
tt_cash_daily
tm_barang
tt_barang_saldo
~~~

### Tahap 3 — Investigasi penjualan dan konteks lain

Operation penjualan dan keuangan yang sudah tersedia pada V1:

~~~text
finance.sales_vs_cash
~~~

Operation ini ditanam sebagai handler backend khusus karena mengikuti beberapa
aturan report NAGAGOLD sekaligus dan tidak aman direpresentasikan sebagai satu
pipeline generik dari input pengguna. Knowledge internal menjelaskan relasi dan
cara membaca hasilnya, sedangkan handler menghitung evidence secara read-only.

Operation berikutnya ditambahkan setelah relasi diverifikasi dari source NAGAGOLD:

~~~text
buyback.cash_reconcile
transfer.stock_reconcile
opname.stock_reconcile
titip.stock_reconcile
~~~

### Tahap 4 — Patch terkontrol

Belum termasuk write otomatis. Tahap ini hanya menambahkan preview patch, checklist Helpdesk, audit sebelum/sesudah, dan recheck setelah perubahan manual.

## 12. Kriteria Berhasil

Fitur dianggap berhasil apabila:

- Helpdesk cukup menyebutkan domain/toko;
- Helpdesk tidak perlu mengetahui connection string;
- NAVA dapat memilih operation berdasarkan pertanyaan;
- query selalu read-only;
- NAVA dapat menjelaskan relasi collection NAGAGOLD;
- NAVA dapat menunjukkan bukti penyebab selisih;
- NAVA dapat memberikan usulan patch yang spesifik;
- Helpdesk dapat melakukan pengecekan ulang;
- customer tidak dapat mengakses fitur;
- data customer tidak tercampur ke knowledge atau memory customer;
- tidak ada perubahan langsung pada database NAGAGOLD;
- semua panduan berasal dari entity, repository, controller, dan laporan NAGAGOLD.

## 13. Asumsi

- Domain menjadi input utama untuk memilih tenant/database.
- Connection string tidak pernah ditempelkan ke chat.
- Data operasional customer tetap berada di database NAGAGOLD.
- Knowledge customer production tetap berada di tm_knowledge_helpdesk.
- Panduan investigasi internal berada di tm_investigation_knowledge dan hanya
  dipakai oleh room Investigasi.
- Definition investigasi terstruktur berada di tm_investigation_definition dan tidak ikut retrieval customer maupun embedding Qdrant customer.
- Hasil pemeriksaan dan audit disimpan terpisah dari knowledge.
- Versi awal hanya read-only dan menghasilkan usulan patch manual.
- NAGAGOLD tidak perlu diubah.
- Jika field NAGAGOLD terenkripsi dan tidak dapat dibaca langsung, digunakan adapter/sidecar read-only yang kompatibel dengan logic NAGAGOLD.

## 14. Implementasi V1 yang Disepakati

Implementasi mencakup pencarian selisih barang, reconciliation keuangan, buyback, service, pindah barang internal, stock opname, hancur barang manual, serta hutang/cicilan. Semua operation investigasi tetap read-only dan mengikuti scope/filter NAGAGOLD yang terdokumentasi.

### UI

- **Investigasi** tersedia sebagai menu utama Helpdesk pada `/helpdesk/investigation`.
- Room Investigasi terpisah dari Chat Aktif dan tidak menggunakan chat customer production.
- Room memakai layout chat internal yang sama dengan Chat Training.
- Helpdesk memilih domain toko melalui pencarian nama toko atau domain sebelum mengirim pertanyaan.
- Tombol **Investigasi Baru**, **Kelola Operation**, **Knowledge Internal**, dan **Kelola Target DB** tersedia di area header Investigasi.
- Halaman Operation, Knowledge Internal, dan Target DB tetap membuat menu Investigasi pada header portal terlihat aktif.
- Ketiga halaman pengaturan memiliki tombol **Kembali ke Investigasi**.
- Menu **Target DB** tersedia untuk Admin pada `/helpdesk/investigation-targets`.
- Menu Target DB menyimpan domain, profil koneksi/VM, nama database, dan status. `tenant_id` diisi otomatis dari domain. Tidak ada input password atau connection string pada UI.
- Halaman Target DB menampilkan daftar target terlebih dahulu seperti menu Users.
- Form tambah dan edit dibuka sebagai dialog dari tombol **Target Baru** atau aksi **Edit**, sehingga form tidak selalu memenuhi halaman.
- Halaman daftar Target DB tetap menggunakan scroll halaman normal dan tidak memakai overflow chat room.
- Form **Knowledge Internal** digunakan untuk mengisi judul, kategori, gejala/konteks, kata kunci, langkah investigasi, hasil yang diharapkan, template jawaban, dan catatan internal.
- Form **Playbook Investigasi** digunakan untuk mengisi nama masalah, contoh pertanyaan, satu aggregation lengkap, aturan temuan, panduan koreksi, dan format jawaban.
- Menu **Operation Investigasi** tetap tersedia sebagai legacy/fallback dan tidak diperlukan untuk menambah Playbook baru.
- Aggregation di Playbook ditulis sebagai `db.nama_collection.aggregate([...])`. Backend otomatis membaca collection sumber, `$lookup`, placeholder parameter, dan batas hasil, lalu memvalidasi semuanya sebagai read-only.

### Koneksi v1

Backend menggunakan environment terpisah per connection profile:

~~~ini
# Nama profile ini dipilih pada mapping Target DB.
INVESTIGATION_MONGODB_URI_VM1=
# INVESTIGATION_MONGODB_URI_VM2=
# INVESTIGATION_MONGODB_URI_QC=
# Fallback satu VM: INVESTIGATION_MONGODB_URI=
INVESTIGATION_MONGODB_DEFAULT_PROFILE=default
INVESTIGATION_MONGODB_DB=
INVESTIGATION_QUERY_TIMEOUT_MS=8000
INVESTIGATION_MAX_ROWS=50
~~~

Setiap URI profile wajib menggunakan user MongoDB read-only dan tidak boleh
sama dengan credential database NAVA jika database NAVA tidak memiliki akses
yang sesuai. Satu profile dapat digunakan oleh banyak target dengan
`database_name` yang berbeda.

Nama database dipilih dari mapping `tm_investigation_target`. NAVA tidak
meneruskan connection string dari chat atau request Helpdesk.

### Operation v1

Operation yang tersedia:

~~~text
stock.detail_vs_summary
stock.opening_vs_previous_closing
finance.sales_vs_cash
finance.buyback_vs_cash
stock.buyback_vs_saldo
service.status_vs_cash
stock.internal_transfer_vs_saldo
stock.opname_vs_saldo
stock.hancur_vs_saldo
finance.debt_vs_cash
report.visibility_diagnostic
~~~

`stock.detail_vs_summary` membandingkan:

~~~text
tm_barang
tt_barang_saldo
th_barang_saldo
tt_barang_summary
~~~

Parameter minimal:

~~~text
kode_barcode
tanggal
~~~

`stock.opening_vs_previous_closing` menggunakan parameter minimal:

~~~text
tanggal_sebelumnya
tanggal_sesudahnya
~~~

Operation ini membaca `th_barang_saldo` historis dan mencari barcode yang
memiliki perbedaan antara `stock_akhir` tanggal sebelumnya dan `stock_awal`
tanggal sesudahnya.

Parameter scope yang disarankan:

~~~text
kode_toko
kode_gudang
~~~

Query dibentuk oleh backend dan tidak dapat diganti menjadi aggregation bebas oleh LLM.

### Interpretasi dan kandidat koreksi saldo harian

Operation `stock.opening_vs_previous_closing` tidak berhenti pada laporan angka
yang berbeda. Backend juga mengirimkan `correction_candidate` agar NAVA dapat
menjelaskan barcode penyebab dan tanggal yang perlu diverifikasi. Kandidat
dibuat per kombinasi `kode_barcode + kode_toko + kode_gudang`.

Jika `stock_akhir` tanggal sebelumnya berbeda dengan `stock_awal` tanggal
sesudahnya dan seluruh field mutasi tanggal sesudahnya bernilai nol, hasil
diberi tipe `opening_carry_forward_mismatch` dengan confidence `high`. Backend
menghitung kandidat:

~~~text
stock_awal tanggal sesudahnya = stock_akhir tanggal sebelumnya
stock_akhir tanggal sesudahnya = stock_akhir tanggal sebelumnya
~~~

Kandidat kedua hanya berlaku sebagai usulan verifikasi. Sistem tidak mengubah
`th_barang_saldo`, `tt_barang_saldo`, atau collection lain. Jika tanggal
sesudahnya memiliki mutasi, hasil diberi confidence `needs_verification` dan
NAVA wajib menjelaskan mutasi tersebut sebelum menyebut nilai koreksi.

Knowledge tetap menjadi sumber aturan bisnis dan relasi NAGAGOLD. Fungsi
backend menjadi sumber aggregation, perbandingan nilai, dan kandidat koreksi.
NAVA hanya memilih operation, membaca evidence, dan menyampaikannya kepada
Helpdesk.

### Penambahan kasus investigasi baru

Panduan customer tetap ditambahkan melalui menu Artikel dan disimpan di
`tm_knowledge_helpdesk`. Panduan internal ditambahkan melalui menu **Knowledge
Internal** dan disimpan di `tm_investigation_knowledge`. Definition investigasi
baru ditambahkan melalui menu **Kelola Operation** dan disimpan di
`tm_investigation_definition`.

#### Menambahkan Knowledge Internal

1. Buka menu **Investigasi**.
2. Klik **Knowledge Internal**.
3. Klik **Knowledge Baru**.
4. Isi satu konteks investigasi yang spesifik: judul, kategori, gejala,
   collection/relasi di catatan internal, langkah pemeriksaan, dan operation
   terkait jika sudah tersedia.
5. Klik **Simpan Draft**.
6. Review isi panduan. Pastikan nama collection dan field benar-benar berasal
   dari source code, laporan, atau hasil verifikasi NAGAGOLD.
7. Klik **Publish** jika panduan sudah siap digunakan room Investigasi.

Knowledge Internal hanya menjadi panduan untuk NAVA. Knowledge ini tidak masuk
`tm_knowledge_helpdesk`, tidak muncul di customer chat, dan tidak ikut embedding
Qdrant customer.

#### Menambahkan Operation Investigasi

1. Buka menu **Investigasi**.
2. Klik **Kelola Operation**.
3. Klik **Operation Baru**.
4. Isi nama, collection yang diizinkan, filter, group by, relasi field, metric,
   jenis hasil, dan knowledge terkait.
5. Simpan sebagai **Draft** terlebih dahulu. Draft boleh hanya berisi rancangan
   relasi tanpa pipeline.
6. Jika operation sudah siap dijalankan, buka konfigurasi lanjutan dan isi
   `source_collection`, batas hasil, serta `execution.pipeline` read-only.
7. Klik **Simpan Draft**, lakukan pengujian pada target yang aman, lalu klik
   **Publish**.

Operation yang hanya berisi relasi atau dokumentasi tetapi belum memiliki
pipeline tidak boleh dipanggil sebagai query. NAVA hanya dapat mengeksekusi
operation berstatus `published` yang pipeline-nya lolos validasi keamanan.

Definition minimal mencakup:

- `operation_id` dan nama operation;
- `allowed_collections`;
- filter dan parameter yang boleh diterima;
- relasi collection dan field;
- metric serta result type;
- `execution.source_collection` dan `execution.pipeline` jika operation sudah siap dijalankan.

Definition dapat disimpan sebagai `draft` tanpa pipeline lengkap untuk mencatat
rancangan relasi. Definition baru hanya dapat dipublish jika memiliki pipeline
read-only yang tervalidasi. Menu tersebut hanya dapat diubah Admin.

Panduan baru dapat membuat NAVA menjelaskan prosedur, tetapi tidak otomatis
memberi izin untuk menjalankan query database. Jika kasus tersebut harus
diperiksa langsung, definition harus memiliki operation read-only yang sudah
diizinkan, diuji terhadap source code NAGAGOLD, dan dibatasi collection, field,
timeout, jumlah hasil, serta stage aggregation yang aman. NAVA tidak boleh
membuat aggregation MongoDB bebas dari teks knowledge.

Dengan pola ini, relasi baru seperti pemeriksaan kas dan penjualan dapat
ditambahkan bertahap tanpa memasukkan knowledge investigasi ke artikel customer.
Knowledge menjelaskan konteks dan cara membaca hasil, sedangkan operation
definition menjelaskan query read-only yang boleh dijalankan. Jika definition
memiliki pipeline declarative yang valid, generic investigation engine dapat
menjalankannya tanpa perubahan handler JavaScript untuk setiap operation baru.
Jika baru ada relasi tanpa pipeline yang aman, definition tetap draft dan NAVA
tidak mengklaim query sudah dijalankan.

### Endpoint v1

~~~text
GET  /api/investigation/targets
POST /api/investigation/targets
POST /api/investigation/session
GET  /api/investigation/sessions
GET  /api/investigation/:trainingId
POST /api/investigation/:trainingId/message
POST /api/investigation/:trainingId/database-check
GET  /api/investigation/:trainingId/runs
POST /api/investigation/:trainingId/close
GET  /api/investigation/knowledge
POST /api/investigation/knowledge
GET  /api/investigation/knowledge/:articleId
PUT  /api/investigation/knowledge/:articleId
POST /api/investigation/knowledge/:articleId/publish
POST /api/investigation/knowledge/:articleId/archive
GET  /api/investigation/definitions
POST /api/investigation/definitions
GET  /api/investigation/definitions/:operationId
PUT  /api/investigation/definitions/:operationId
POST /api/investigation/definitions/:operationId/publish
POST /api/investigation/definitions/:operationId/archive
~~~

Semua endpoint investigasi memakai autentikasi Helpdesk. Perubahan target database hanya boleh dilakukan Admin.
Pemeriksaan langsung juga dibatasi pada session investigasi milik pemanggil.

### Batasan v1

- Belum ada operasi write ke database customer.
- Hasil pemeriksaan hanya berupa evidence, indikasi penyebab, dan usulan patch manual.
- Belum ada adapter dekripsi untuk field NAGAGOLD yang terenkripsi.
- Jika URI profile yang dipilih belum diisi, room tetap dapat dibuka tetapi pemeriksaan akan memberi status database belum dikonfigurasi.
- Jika target domain belum ada di `tm_investigation_target`, NAVA tidak menjalankan query.
- Hasil audit disimpan di `tt_investigation_run`; data customer lengkap tidak disalin ke NAVA.
- Definition investigasi baru belum otomatis menjadi knowledge customer.
- Definition tanpa `execution.pipeline` hanya menjadi rancangan/manual reference dan tidak dapat dipanggil untuk query.

## 15. Cara Penggunaan Sehari-hari

### 15.1 Helpdesk menjalankan pemeriksaan

1. Helpdesk login ke portal.
2. Buka menu **Investigasi**.
3. Cari dan pilih domain toko pada pemilih target database. Helpdesk tidak perlu
   mengetahui connection string, nama user database, atau password.
4. Tulis pertanyaan dengan bahasa natural, misalnya:

~~~text
Kenapa stock awal 20 Juli tidak sama dengan stock akhir 19 Juli di gudang toko?
~~~

5. NAVA membaca knowledge internal yang berstatus `published` untuk memahami
   istilah, relasi, dan aturan bisnis NAGAGOLD.
6. NAVA memilih operation yang paling sesuai. Untuk kasus saldo antarhari tanpa
   barcode, NAVA menggunakan `stock.opening_vs_previous_closing` dan tidak
   meminta Helpdesk mencari barcode terlebih dahulu.
7. Backend memvalidasi domain ke `tm_investigation_target`, mengambil connection
   profile dan database name, lalu menjalankan operation read-only pada database
   customer.
8. Hasil query dikembalikan ke NAVA sebagai evidence terstruktur. NAVA tidak
   menerima atau membuat aggregation bebas dari teks pertanyaan.
9. NAVA menjelaskan temuan, evidence, penyebab yang didukung data, dan kandidat
   koreksi sesuai format jawaban Investigasi.
10. Helpdesk memeriksa usulan tersebut, melakukan perubahan melalui UI/prosedur
    resmi NAGAGOLD jika memang diperlukan, lalu menanyakan pengecekan ulang.

### 15.2 Siklus satu pertanyaan

Alur runtime dapat diringkas sebagai berikut:

~~~text
Pertanyaan Helpdesk
        ↓
Knowledge Internal published
        ↓
Pemilihan operation
        ↓
Validasi target domain dan parameter
        ↓
Aggregation read-only pada database customer
        ↓
Evidence + warning + correction candidate
        ↓
Jawaban ringkas NAVA
        ↓
Verifikasi/perubahan manual oleh Helpdesk
~~~

Jika parameter penting belum ada, NAVA meminta parameter yang relevan. Contoh
parameter dapat berupa tanggal, periode, kode toko, kode gudang, atau barcode
jika operation memang membutuhkannya. Untuk operation yang dirancang mencari
barcode penyebab, NAVA tidak meminta barcode lebih dulu.

Jika koneksi database, target, pipeline, atau data tidak memenuhi syarat, NAVA
menyampaikan status gagal secara jujur. Tidak ada temuan atau kandidat koreksi
yang dibuat dari query yang gagal.

### 15.3 Contoh kasus saldo antarhari

Helpdesk memilih domain lalu bertanya:

~~~text
Kenapa stock awal 20 Juli 2026 tidak sama dengan stock akhir 19 Juli 2026?
~~~

NAVA memilih `stock.opening_vs_previous_closing`. Backend membaca
`th_barang_saldo` pada 19 dan 20 Juli, mengelompokkan berdasarkan
`kode_barcode + kode_toko + kode_gudang`, lalu membandingkan:

~~~text
stock_akhir tanggal 19
↔
stock_awal tanggal 20
~~~

Jika ditemukan barcode dengan stock akhir 19 Juli = 4 dan stock awal 20 Juli =
5 tanpa movement yang menjelaskan kenaikan tersebut, jawaban menyebutkan
barcode, toko, gudang, nilai current, nilai expected, dan pemeriksaan sebelum
koreksi. Database tidak diubah oleh NAVA.

### 15.4 Kapan Helpdesk menambah Knowledge Internal

Knowledge Internal ditambahkan ketika Helpdesk menemukan pola atau prosedur
investigasi yang dapat digunakan berulang, misalnya:

- cara membaca relasi saldo barang dan summary;
- aturan status transaksi buyback yang valid;
- field penghubung laporan keuangan dan penjualan;
- cara membedakan transaksi batal, kredit, pembayaran sebagian, dan cash harian;
- cara membaca hasil operation tertentu.

Knowledge tidak perlu ditambahkan hanya karena ada satu kasus unik yang tidak
memiliki pola reusable. Panduan harus ditulis berdasarkan struktur dan perilaku
NAGAGOLD yang sudah diverifikasi.

### 15.5 Kapan Helpdesk menambah Operation

Operation ditambahkan jika pemeriksaan membutuhkan query database berulang yang
terstruktur dan hasilnya dapat distandarkan. Knowledge Internal saja cukup jika
NAVA hanya perlu menjelaskan relasi atau memberi arahan manual.

Contoh:

- hanya perlu menjelaskan bahwa `tt_jual_detail` berelasi dengan
  `tt_cash_daily`: tambahkan atau gunakan Knowledge Internal;
- perlu mencari semua faktur yang nominal penjualannya berbeda dari cash:
  gunakan operation bawaan `finance.sales_vs_cash` yang menjalankan handler
  read-only berbasis report NAGAGOLD;
- perlu mencari barcode yang opening-nya tidak sama dengan closing hari
  sebelumnya: gunakan operation saldo antarhari yang sudah tersedia.

### 15.6 Peran status data

- `draft`: belum dipakai NAVA saat runtime.
- `published`: boleh dipakai retrieval atau eksekusi sesuai jenis datanya.
- `archived`: tidak dipakai NAVA.

Knowledge Internal berstatus `published` menjadi panduan. Operation berstatus
`published` dan memiliki pipeline valid menjadi satu-satunya definisi yang boleh
dipanggil untuk query. Publish tetap merupakan keputusan Admin/Helpdesk yang
berwenang, bukan keputusan otomatis NAVA. 

## 16. Playbook Investigasi sebagai Satu Pemetaan

Playbook adalah bentuk administrasi utama untuk rancangan investigasi yang baru.
Admin tidak perlu mengisi operation dan knowledge internal melalui dua form
terpisah. Satu Playbook menjelaskan seluruh konteks berikut:

- masalah atau pertanyaan Helpdesk yang memicu pemeriksaan;
- executor backend yang menjalankan pemeriksaan read-only;
- operation legacy yang menjadi jejak referensi, bila ada;
- collection dan field yang dibaca;
- relasi antar-collection;
- urutan pemeriksaan dan hasil yang diharapkan;
- format jawaban NAVA;
- batasan keamanan dan langkah sebelum koreksi manual.

Playbook disimpan pada registry terpisah:

~~~text
tm_investigation_playbook
~~~

Registry Playbook tidak diisi melalui migrasi otomatis. Data pada
`tm_investigation_definition` dan `tm_investigation_knowledge` tetap utuh dan
tetap menjadi sumber runtime yang berjalan sampai Playbook selesai dipetakan,
diuji, dan diaktifkan melalui proses cutover yang terkontrol. Tidak ada data
lama yang dihapus atau ditimpa.

### 16.1 Pemetaan melalui UI

Form Playbook dibuat sesingkat mungkin. Admin/tim teknis yang memahami relasi
NAGAGOLD cukup mengisi:

1. Konteks pemanggilan: nama masalah, uraian masalah, dan contoh pertanyaan.
2. Aggregation lengkap: `db.collection.aggregate([...])` dengan placeholder
   seperti `{{tanggal}}`, `{{kode_gudang}}`, atau `{{kode_barcode}}`.
3. Aturan membaca hasil: kondisi match/mismatch, data kosong, dan field yang
   dibandingkan.
4. Panduan koreksi: collection, filter, current, expected, dan pemeriksaan
   sebelum koreksi.
5. Format jawaban dan batasan: temuan, evidence, penyebab, saran perbaikan,
   serta penegasan bahwa query bersifat read-only.

Backend menurunkan collection dan parameter dari aggregation, sehingga Admin
tidak perlu mengisi daftar collection, field, parameter, executor, operation,
atau jumlah hasil secara terpisah. Menyimpan Playbook baru tidak menyalin
artikel, tidak membuat duplikat operation, dan tidak mengubah Qdrant.

### 16.2 Executor backend

Generic Playbook executor adalah satu fungsi backend yang mengetahui cara
memvalidasi collection, parameter, stage aggregation, batas waktu, batas hasil,
dan format hasil. LLM hanya memilih Playbook berdasarkan konteks dan mengisi
placeholder yang diminta; LLM tidak menulis aggregation bebas.

Jika ditemukan konteks baru, alurnya:

1. Admin membuat Playbook draft dan memetakan relasi berdasarkan NAGAGOLD.
2. Admin/tim teknis menempelkan aggregation lengkap yang sudah diuji dengan
   database read-only.
3. Admin mengisi aturan temuan, panduan koreksi, dan template jawaban.
4. Playbook diuji melalui room Investigasi.
5. Playbook dipublish setelah hasil uji dapat diaudit.

Perubahan kode backend hanya diperlukan jika konteks baru membutuhkan algoritma
atau sumber data yang tidak dapat diekspresikan melalui aggregation dan aturan
generic yang aman.

### 16.3 Qdrant dan cutover

Knowledge customer pada `tm_knowledge_helpdesk` dan collection Qdrant
`knowledge_vector_index` tidak disentuh oleh Playbook internal. Knowledge
investigasi saat ini tetap berada di MongoDB dan retrieval internalnya tidak
memakai vector customer.

Jika pencarian semantik untuk Playbook diperlukan, gunakan collection vector
terpisah dan indeks hanya ringkasan Playbook yang sudah disetujui. Jangan
mencampur vector internal dengan vector customer.

Runtime baru hanya boleh membaca Playbook yang berstatus `published` setelah
validasi dan cutover selesai. Sebelum itu, runtime legacy tetap berjalan dan
Playbook hanya berfungsi sebagai registry desain yang dapat ditinjau Admin.
