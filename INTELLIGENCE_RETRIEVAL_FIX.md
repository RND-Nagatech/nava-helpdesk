# NAVA Intelligence & Retrieval Fix — v2.4.3

Patch ini memperbaiki masalah umum ketika knowledge sebenarnya tersedia tetapi NAVA memilih artikel lain, mengatakan tidak tahu, atau membawa konteks lama yang tidak relevan.

## Prinsip Perbaikan

Perubahan dilakukan pada mekanisme retrieval umum, bukan dengan rule khusus untuk nama knowledge tertentu.

### 1. Indonesian morphology normalization
Retriever menyamakan variasi bentuk kata umum untuk pencarian, misalnya:

- batal / membatalkan / dibatalkan / pembatalan
- jual / penjualan
- bentuk percakapan dengan suffix `-nya`

Bentuk asli tetap dipertahankan agar exact match tidak hilang.

### 2. Specificity-aware evidence
Artikel tidak boleh dianggap `strong` hanya karena cocok pada kata generik seperti `laporan`, `menu`, `fungsi`, atau `barang`.

Retriever sekarang menghitung kecocokan istilah pembeda (`distinctive coverage`) dan memberi bobot lebih besar pada kecocokan istilah tersebut, terutama di title/symptoms/tags.

### 3. Candidate supplementation
MongoDB `$text` tetap digunakan. Namun hasilnya selalu dilengkapi dengan targeted regex search pada token pembeda di title/symptoms/tags/category. Ini membantu ketika query hasil LLM memakai bentuk kata yang berbeda dan artikel exact tidak masuk candidate pool `$text`.

### 4. Preserve customer terminology
`search_knowledge` menerima query buatan agent, tetapi runtime juga menjaga istilah pembeda dari pertanyaan customer. Jika parafrase agent membuang istilah penting, istilah tersebut ditambahkan kembali tanpa model call tambahan.

### 5. Search kedua benar-benar dijalankan
Mekanisme `blocked_reuse_primary` dihapus. Search kedua dengan query yang berbeda sekarang benar-benar melakukan retrieval baru. Hanya query yang identik yang boleh direuse. Search limit tetap maksimal 2 per turn.

### 6. Best evidence untuk fallback
Jika ada dua pencarian, state menyimpan `bestSearchResult`, bukan hanya hasil pertama. Recursion fallback menggunakan evidence terbaik yang benar-benar ditemukan.

### 7. Long-term memory difilter berdasarkan relevansi
Sebelumnya beberapa kasus lama customer dapat masuk ke prompt sekaligus walaupun tidak terkait dengan pertanyaan sekarang. Ini dapat membuat NAVA menyebut masalah lama seperti timbangan/struk saat customer sedang membahas topik lain.

Sekarang long-term memory hanya memasukkan kasus lama yang relevan dengan pertanyaan saat ini. Jika tidak ada yang relevan, memory lama tidak disuntikkan. Referensi eksplisit ke kasus lampau tetap memiliki fallback terbatas.

### 8. Multi-turn retrieval
Prompt agent diperjelas bahwa follow-up pada topik yang sama dapat membutuhkan knowledge baru, misalnya perubahan kebutuhan dari:

- apa itu
- di mana
- cara membuka
- langkah selanjutnya
- laporan rekap/detail

Primary article bukan kunci permanen untuk seluruh percakapan.

## Regression Cases

Regression test menggunakan knowledge project aktual, termasuk:

- `gimana cara batal titipan`
- `cara membatalkan transaksi titipan`
- `laporan barang detail fungsi dan kegunaan menu`
- query struk/nota sebelumnya
- memory lama yang tidak relevan

Hasil test backend: **62/62 PASS**.

## Yang Tidak Diubah

- DeepSeek main agent
- LangChain / LangGraph Checkpointer
- MongoDBStore long-term memory
- adaptive summarization
- embedding `problem-v2`
- vector search Atlas
- ticketing / handover
- frontend website
- upload gambar
- SSE

