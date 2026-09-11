# NAVA v2.4.2 — Contextual Clarification Cleanup

Perubahan ini menghapus ketergantungan agent pada `clarificationQuestions` generik dari knowledge.

## Perubahan utama

- `search_knowledge` tidak lagi mengirim `clarification_questions` ke DeepSeek.
- Retriever tidak lagi mengambil `clarificationQuestions` dari MongoDB.
- `articleSearchText()` tidak lagi memasukkan clarification ke lexical search text.
- Prompt meminta DeepSeek membuat **satu pertanyaan klarifikasi yang kontekstual** hanya bila evidence memang belum cukup.
- Importer selalu `$unset: { clarificationQuestions: "" }` agar field lama ikut terhapus dari dokumen MongoDB.
- Ditambahkan `npm run knowledge:cleanup-clarification` untuk membersihkan collection yang sudah terlanjur diimport tanpa perlu import ulang.
- Recursion fallback tidak lagi mengambil canned clarification question dari knowledge.

## Migrasi yang disarankan

Jika knowledge lama sudah ada di MongoDB:

```bash
npm run knowledge:cleanup-clarification
```

Jika ingin import ulang JSON baru tanpa clarification:

```bash
npm run knowledge:import -- /path/ke/nava-knowledge-no-clarification.json
```

Setelah import, importer sekarang otomatis membuat embedding dan menyinkronkan vector ke Qdrant. Jika ingin menjalankan ulang secara manual:

```bash
npm run knowledge:embed
npm run knowledge:vector-index
```

`knowledge:embed` membuat ulang embedding yang belum sesuai dan otomatis menyinkronkan Qdrant. `knowledge:vector-index` dapat dijalankan sebagai rekonsiliasi eksplisit. Cleanup clarification saja tidak memerlukan embed ulang karena embedding `problem-v2` tidak memakai field tersebut.
