# NAVA v2.3.1

Patch fokus behavior jawaban tanpa perubahan arsitektur besar.

## Perubahan

- NAVA ditegaskan sebagai **NAVA (Nagatech Virtual Assistant), AI Helpdesk Nagatech**.
- Untuk deployment saat ini, NAVA menganggap knowledge yang tersedia memang untuk program yang sedang digunakan customer.
- NAVA **tidak menanyakan nama program**.
- Metadata `product` tidak lagi dikirim ke LLM melalui tool `search_knowledge`, sehingga model tidak otomatis menyebut `Navacare`/nama program dari metadata internal.
- Jika evidence `strong`, tool hanya mengirim primary article lengkap. Supporting candidates dan clarification questions tidak dikirim agar agent tidak menciptakan ambiguity yang tidak diperlukan.
- Prompt melarang kalimat internal seperti “berdasarkan knowledge yang tersedia”.
- Jika solusi sudah jelas, agent diminta tidak menambah pertanyaan klarifikasi di akhir.
- Arsitektur v2.3 (singleton agent, hybrid retrieval, cross-session context ringan, warm-up embedding, timing debug) tetap dipertahankan.
