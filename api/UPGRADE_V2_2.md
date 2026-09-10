# Upgrade v2.2.0 — LLM-first, Search-first, Nagatech Identity

## Tujuan

Mengembalikan behavior v2.1 yang cepat dan to the point, sambil memperbaiki identitas NAVA dan mengambil hanya peningkatan yang tidak menambah kompleksitas runtime.

## Yang dipertahankan dari v2.1

- LangChain `createAgent`
- DeepSeek sebagai agent utama
- history sederhana dari `tt_chat_helpdesk`
- hybrid keyword + vector retrieval
- problem-focused embedding `problem-v2`
- primary evidence reranking
- anti hypothesis-drift pada search tool
- agent trace

## Yang diperbaiki

1. NAVA sekarang berarti **Nagatech Virtual Assistant**.
2. NAVA membantu pertanyaan tentang program/produk Nagatech; NAVA bukan nama aplikasi customer.
3. Prompt memakai prinsip **SEARCH FIRST, CLARIFY SECOND**.
4. Jawaban diarahkan lebih ringkas/to the point.
5. Hard-coded smalltalk/intent classifier dihapus.
6. Forced structured output tidak dipakai.
7. Metadata response diturunkan dari hasil tool nyata.
8. Search dibatasi maksimal 2 call per turn melalui `SEARCH_TOOL_CALL_LIMIT`.
9. Local retrieval evaluation ditambahkan.

## Yang sengaja tidak dipakai dari v3

- MongoDB Checkpointer
- Conversation Summarization
- Long-Term Memory
- middleware kompleks
- structured output yang dipaksa di main agent

Alasan: belum memberi manfaat yang sebanding dengan latency/kompleksitas untuk pola NAVA saat ini.
