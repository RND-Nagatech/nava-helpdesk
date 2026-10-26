from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    KeepTogether,
)
from reportlab.pdfbase.pdfmetrics import stringWidth


OUTPUT = "/Users/aandiyanti/Documents/RnD/PROJECT/nava-langchain-fix/output/pdf/laya-untuk-nagatech.pdf"

NAVY = colors.HexColor("#17324D")
BLUE = colors.HexColor("#2C6286")
TEAL = colors.HexColor("#159A9C")
LIGHT_BLUE = colors.HexColor("#EAF3F7")
LIGHT_TEAL = colors.HexColor("#E8F6F4")
LIGHT_GRAY = colors.HexColor("#F4F7F9")
MID_GRAY = colors.HexColor("#667789")
DARK = colors.HexColor("#1D2A35")
WHITE = colors.white


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=31,
    leading=36,
    textColor=WHITE,
    alignment=TA_LEFT,
    spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="CoverSubtitle",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=14,
    leading=20,
    textColor=colors.HexColor("#DDEBF3"),
    alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="SectionTitle",
    parent=styles["Heading1"],
    fontName="Helvetica-Bold",
    fontSize=19,
    leading=24,
    textColor=NAVY,
    spaceBefore=0,
    spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="SubTitle",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=12.5,
    leading=16,
    textColor=BLUE,
    spaceBefore=8,
    spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="Body",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=9.4,
    leading=14,
    textColor=DARK,
    spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Small",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=8.2,
    leading=11,
    textColor=MID_GRAY,
    spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="TableHead",
    parent=styles["BodyText"],
    fontName="Helvetica-Bold",
    fontSize=8.2,
    leading=10.5,
    textColor=WHITE,
))
styles.add(ParagraphStyle(
    name="TableCell",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=8.1,
    leading=10.5,
    textColor=DARK,
))
styles.add(ParagraphStyle(
    name="TableCellBold",
    parent=styles["BodyText"],
    fontName="Helvetica-Bold",
    fontSize=8.1,
    leading=10.5,
    textColor=NAVY,
))
styles.add(ParagraphStyle(
    name="Callout",
    parent=styles["BodyText"],
    fontName="Helvetica-Bold",
    fontSize=10,
    leading=14,
    textColor=NAVY,
))
styles.add(ParagraphStyle(
    name="CodeBox",
    parent=styles["BodyText"],
    fontName="Courier",
    fontSize=8.1,
    leading=11,
    textColor=DARK,
))


def P(text, style="Body"):
    return Paragraph(text, styles[style])


def bullet(text):
    return P("- " + text, "Body")


def make_table(data, widths, header=True, row_bgs=None, font_size=None):
    table = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D3DEE5")),
    ]
    if header:
        commands.extend([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ])
    for row, bg in enumerate(row_bgs or []):
        commands.append(("BACKGROUND", (0, row + (1 if header else 0)), (-1, row + (1 if header else 0)), bg))
    table.setStyle(TableStyle(commands))
    return table


def code_box(text):
    table = Table([[P(text.replace("\n", "<br/>"), "CodeBox")]], colWidths=[174 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT_GRAY),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#C8D6DE")),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return table


def page_header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    if doc.page > 1:
        canvas.setStrokeColor(colors.HexColor("#D8E2E8"))
        canvas.setLineWidth(0.5)
        canvas.line(18 * mm, height - 14 * mm, width - 18 * mm, height - 14 * mm)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(NAVY)
        canvas.drawString(18 * mm, height - 10.5 * mm, "Laya untuk Nagatech")
    canvas.setStrokeColor(colors.HexColor("#D8E2E8"))
    canvas.setLineWidth(0.5)
    canvas.line(18 * mm, 13 * mm, width - 18 * mm, 13 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MID_GRAY)
    canvas.drawString(18 * mm, 8 * mm, "Dokumen R&D - 30 September 2026")
    canvas.drawRightString(width - 18 * mm, 8 * mm, f"Halaman {doc.page}")
    canvas.restoreState()


def cover_page(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, width, height, stroke=0, fill=1)
    canvas.setFillColor(TEAL)
    canvas.rect(0, height - 13 * mm, width, 13 * mm, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#24506F"))
    canvas.circle(width - 18 * mm, height - 55 * mm, 38 * mm, stroke=0, fill=1)
    canvas.circle(width - 43 * mm, height - 82 * mm, 15 * mm, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#1E405D"))
    canvas.rect(0, 0, width, 33 * mm, stroke=0, fill=1)
    canvas.restoreState()


def build():
    doc = SimpleDocTemplate(
        OUTPUT,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=21 * mm,
        bottomMargin=19 * mm,
        title="Laya untuk Nagatech",
        author="Nagatech R&D",
    )

    story = []

    # Cover
    story.append(Spacer(1, 37 * mm))
    story.append(P("LAYA", "CoverTitle"))
    story.append(P("Decision layer untuk aplikasi dan workflow Nagatech", "CoverSubtitle"))
    story.append(Spacer(1, 18 * mm))
    cover_card = Table([
        [P("Dokumen ini menjelaskan tujuan, manfaat, cara kerja, dan peluang penerapan Laya secara umum di lingkungan Nagatech.", "Callout")],
        [P("Fokus utama: membantu sistem memilih jalur tindakan yang tepat dari input natural language, tanpa menggantikan database, API, aturan bisnis, atau approval manusia.", "Body")],
    ], colWidths=[150 * mm])
    cover_card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0, WHITE),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(cover_card)
    story.append(Spacer(1, 70 * mm))
    story.append(P("Status: bahan R&D dan rekomendasi penerapan", "Small"))
    story.append(PageBreak())

    # 1
    story.append(P("1. Ringkasan eksekutif", "SectionTitle"))
    story.append(P("Laya adalah lapisan keputusan ringan yang menerima konteks atau pertanyaan, lalu menghasilkan keputusan terstruktur. Keputusan ini dapat berupa kategori masalah, tujuan pengguna, tingkat urgensi, domain bisnis, atau workflow yang perlu dijalankan.", "Body"))
    story.append(P("Dalam arsitektur AI, Laya berada di antara input pengguna dan sistem yang sudah ada:", "Body"))
    flow = Table([
        [P("Input user", "TableCellBold"), P("Laya", "TableCellBold"), P("Sistem Nagatech", "TableCellBold")],
        [P("Pertanyaan, keluhan, chat, event", "TableCell"), P("Keputusan terstruktur dan bounded", "TableCell"), P("API, database, workflow, atau petugas", "TableCell")],
    ], colWidths=[52 * mm, 52 * mm, 52 * mm])
    flow.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT_TEAL),
        ("BOX", (0, 0), (-1, -1), 0.7, TEAL),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#A7D7D0")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.append(flow)
    story.append(Spacer(1, 9))
    story.append(P("Nilai utama Laya untuk Nagatech:", "SubTitle"))
    for text in [
        "Mengurangi routing manual pada chat, ticket, dan workflow operasional.",
        "Membuat keputusan awal lebih konsisten karena label dan output dibatasi.",
        "Memisahkan keputusan cepat dari proses berat seperti retrieval, query database, dan approval.",
        "Memungkinkan satu pola decision layer dipakai oleh banyak project tanpa menyalin seluruh agent AI.",
    ]:
        story.append(bullet(text))
    callout = Table([[P("Kesimpulan singkat: Laya bukan pengganti LangChain atau backend. Laya adalah komponen yang membantu sistem memilih apa yang harus dilakukan selanjutnya.", "Callout")]], colWidths=[174 * mm])
    callout.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BLUE),
        ("BOX", (0, 0), (-1, -1), 0.8, BLUE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.append(Spacer(1, 4))
    story.append(callout)
    story.append(PageBreak())

    # 2
    story.append(P("2. Tujuan dan cara kerja Laya", "SectionTitle"))
    story.append(P("Tujuan Laya adalah membuat sistem dapat memilih jalur yang tepat dari input yang tidak terstruktur. Contohnya, satu kalimat pengguna dapat diarahkan menjadi pencarian knowledge, investigasi, pengecekan database, pembuatan ticket, atau eskalasi.", "Body"))
    steps = [
        [P("1", "TableCellBold"), P("Terima input", "TableCellBold"), P("Laya menerima pertanyaan, konteks sesi, project, dan metadata yang relevan.", "TableCell")],
        [P("2", "TableCellBold"), P("Baca definisi keputusan", "TableCellBold"), P("Sistem menentukan area, pilihan label, dan kriteria yang diperbolehkan.", "TableCell")],
        [P("3", "TableCellBold"), P("Hasilkan keputusan", "TableCellBold"), P("Laya mengembalikan label, confidence atau urgency, dan metadata keputusan.", "TableCell")],
        [P("4", "TableCellBold"), P("Jalankan workflow", "TableCellBold"), P("Aplikasi utama memanggil API, database, tool, atau petugas sesuai keputusan.", "TableCell")],
        [P("5", "TableCellBold"), P("Catat dan evaluasi", "TableCellBold"), P("Keputusan dicatat untuk audit, pengukuran akurasi, dan perbaikan definisi.", "TableCell")],
    ]
    step_table = Table(steps, colWidths=[12 * mm, 46 * mm, 116 * mm])
    step_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), LIGHT_TEAL),
        ("ROWBACKGROUNDS", (1, 0), (-1, -1), [WHITE, LIGHT_GRAY]),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D3DEE5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(step_table)
    story.append(Spacer(1, 10))
    story.append(P("Contoh keputusan yang aman dan terbatas:", "SubTitle"))
    story.append(code_box('Input: "Laporan penjualan tidak sama dengan cash."\n\nKeputusan Laya:\n{\n  "area": "finance",\n  "operation": "sales_vs_cash_reconciliation",\n  "urgency": true,\n  "requires_database_check": true\n}'))
    story.append(Spacer(1, 7))
    story.append(P("Laya tidak boleh membuat query MongoDB bebas berdasarkan teks pengguna. Ia hanya memilih operation yang sudah diizinkan oleh aplikasi.", "Small"))
    story.append(PageBreak())

    # 3
    story.append(P("3. Mengapa Laya relevan untuk Nagatech", "SectionTitle"))
    story.append(P("Workspace Nagatech memiliki beberapa jenis aplikasi: helpdesk, retail, finance, hospitality, perjalanan dinas, dan virtual assistant. Masing-masing mempunyai workflow serta sumber data berbeda, tetapi semuanya menghadapi masalah yang sama: input pengguna sering tidak rapi dan harus diarahkan ke proses yang benar.", "Body"))
    data = [
        [P("Masalah umum", "TableHead"), P("Tanpa decision layer", "TableHead"), P("Dengan Laya", "TableHead")],
        [P("Pertanyaan ambigu", "TableCellBold"), P("Agent menebak intent atau memanggil tool yang salah.", "TableCell"), P("Intent dibatasi ke label yang sudah ditentukan.", "TableCell")],
        [P("Banyak workflow", "TableCellBold"), P("Logika routing tersebar di banyak prompt dan controller.", "TableCell"), P("Routing dipusatkan pada keputusan yang dapat diaudit.", "TableCell")],
        [P("Operasi berisiko", "TableCellBold"), P("AI bisa menjawab sebelum data atau approval diverifikasi.", "TableCell"), P("Laya menandai kebutuhan validasi, approval, atau eskalasi.", "TableCell")],
        [P("Perubahan project", "TableCellBold"), P("Setiap project membangun pola klasifikasi sendiri.", "TableCell"), P("Pola decision layer dapat digunakan lintas project dengan definisi berbeda.", "TableCell")],
    ]
    story.append(make_table(data, [44 * mm, 64 * mm, 66 * mm], row_bgs=[WHITE, LIGHT_GRAY, WHITE, LIGHT_GRAY]))
    story.append(Spacer(1, 10))
    story.append(P("Arsitektur yang direkomendasikan:", "SubTitle"))
    story.append(code_box("Frontend / WhatsApp / internal app\n        |\n        v\nLaya decision service\n        |  { area, operation, urgency, confidence }\n        v\nAPI atau workflow project\n        |\n        v\nDatabase, knowledge base, approval, atau petugas"))
    story.append(Spacer(1, 7))
    story.append(P("Laya dapat dijalankan sebagai service terpisah. Project yang memakainya cukup mengirim request HTTP dan menerima JSON keputusan. Dengan cara ini, eksperimen Laya tidak harus mengubah seluruh arsitektur setiap project.", "Body"))
    story.append(PageBreak())

    # 4
    story.append(P("4. Kandidat project Nagatech", "SectionTitle"))
    story.append(P("Daftar berikut adalah rekomendasi penerapan, bukan klaim bahwa semuanya sudah terintegrasi. Saat ini integrasi Laya yang sudah ada berada di NAVA; project lain masih menjadi kandidat implementasi.", "Body"))
    projects = [
        [P("Project", "TableHead"), P("Peluang penerapan Laya", "TableHead"), P("Prioritas", "TableHead")],
        [P("Buana Virtual Assistance", "TableCellBold"), P("Memilih fungsi owner assistant: sales, stock, buyback, cash, debt, report, dan rekonsiliasi.", "TableCell"), P("Paling tinggi", "TableCellBold")],
        [P("NAGAGOLD Online / NAGAGOLD AI", "TableCellBold"), P("Routing masalah timbangan, stok, penjualan, receipt, buyback, dan laporan.", "TableCell"), P("Tinggi", "TableCellBold")],
        [P("Finance Transaksional", "TableCellBold"), P("Membedakan transaksi, summary, import, audit, approval, dan rekonsiliasi.", "TableCell"), P("Tinggi", "TableCellBold")],
        [P("Finance Budget", "TableCellBold"), P("Mengarahkan create budget, pemakaian, sisa budget, lampiran, dan approval.", "TableCell"), P("Menengah", "TableCellBold")],
        [P("Finance Subscriber", "TableCellBold"), P("Membedakan subscriber, invoice, payment, outstanding, dan rekap langganan.", "TableCell"), P("Menengah", "TableCellBold")],
        [P("Hospitality OS", "TableCellBold"), P("Memilih workflow front office, housekeeping, kitchen, maintenance, purchase, AP, dan lost and found.", "TableCell"), P("Menengah", "TableCellBold")],
        [P("App Perjalanan Dinas", "TableCellBold"), P("Mengarahkan pengajuan, approval, expense, reimbursement, dokumen, dan policy.", "TableCell"), P("Tahap dua", "TableCellBold")],
    ]
    story.append(make_table(projects, [43 * mm, 102 * mm, 29 * mm], row_bgs=[WHITE, LIGHT_GRAY, WHITE, LIGHT_GRAY, WHITE, LIGHT_GRAY, WHITE]))
    story.append(Spacer(1, 10))
    story.append(P("Rekomendasi urutan R&D", "SubTitle"))
    for text in [
        "Mulai dari Buana Virtual Assistance karena sudah memiliki pola percakapan owner dan banyak operasi bisnis yang jelas.",
        "Lanjutkan ke NAGAGOLD untuk menguji routing masalah operasional dan helpdesk.",
        "Uji Finance Transaksional setelah format rekonsiliasi, risk flag, dan validasi database siap.",
        "Setelah pola stabil, gunakan pendekatan yang sama pada budget, subscriber, hospitality, dan perjalanan dinas.",
    ]:
        story.append(bullet(text))
    story.append(PageBreak())

    # 5
    story.append(P("5. Contoh implementasi di beberapa project", "SectionTitle"))
    story.append(P("Laya menghasilkan keputusan singkat. Sistem project tetap bertanggung jawab untuk mengambil data, memvalidasi hak akses, menjalankan proses, dan menyusun jawaban.", "Body"))
    examples = [
        [P("Input", "TableHead"), P("Keputusan Laya", "TableHead"), P("Aksi project", "TableHead")],
        [P("\"Penjualan hari ini berapa?\"", "TableCell"), P("domain=sales; operation=sales_summary; period=today", "TableCell"), P("Panggil service laporan penjualan.", "TableCell")],
        [P("\"Stock barang saya sekarang berapa?\"", "TableCell"), P("domain=inventory; operation=stock_current", "TableCell"), P("Panggil API stok realtime.", "TableCell")],
        [P("\"Berat barang tidak muncul saat tambah barang.\"", "TableCell"), P("area=inventory_weight; workflow=scale_connection_check", "TableCell"), P("Tampilkan checklist timbangan atau buat ticket.", "TableCell")],
        [P("\"Struk penjualan tidak keluar.\"", "TableCell"), P("area=sales_receipt; workflow=printer_popup_check", "TableCell"), P("Tampilkan panduan printer atau eskalasi.", "TableCell")],
        [P("\"Kamar 305 AC rusak, tamu menunggu.\"", "TableCell"), P("area=maintenance; urgent=true", "TableCell"), P("Buat work order maintenance prioritas tinggi.", "TableCell")],
        [P("\"Saya sudah pulang dinas, bagaimana reimbursement?\"", "TableCell"), P("area=business_trip; operation=submit_reimbursement", "TableCell"), P("Buka workflow klaim dan cek dokumen.", "TableCell")],
    ]
    story.append(make_table(examples, [64 * mm, 61 * mm, 49 * mm], row_bgs=[WHITE, LIGHT_GRAY, WHITE, LIGHT_GRAY, WHITE, LIGHT_GRAY]))
    story.append(Spacer(1, 12))
    story.append(P("Contoh kontrak output", "SubTitle"))
    story.append(code_box('{\n  "project": "finance-transaksional",\n  "area": "reconciliation",\n  "operation": "compare_detail_and_summary",\n  "confidence": 0.91,\n  "urgent": false,\n  "requires_database_check": true\n}'))
    story.append(Spacer(1, 8))
    story.append(P("Field seperti project, area, dan operation sebaiknya hanya menerima nilai dari allowlist. Jika confidence rendah atau label tidak dikenal, sistem harus memakai fallback aman seperti klarifikasi atau eskalasi.", "Body"))
    story.append(PageBreak())

    # 6
    story.append(P("6. Batasan, keamanan, dan pembagian tanggung jawab", "SectionTitle"))
    story.append(P("Laya berguna ketika keputusan yang dibuatnya bounded dan dapat diverifikasi. Laya tidak boleh menjadi sumber kebenaran untuk data bisnis atau satu-satunya pengaman operasi berisiko.", "Body"))
    boundaries = [
        [P("Komponen", "TableHead"), P("Tanggung jawab", "TableHead")],
        [P("Laya", "TableCellBold"), P("Menentukan kategori, intent, area, urgency, dan kandidat workflow.", "TableCell")],
        [P("LangChain / agent", "TableCellBold"), P("Mengatur reasoning, pemanggilan tool, grounding, dan penyusunan jawaban.", "TableCell")],
        [P("API project", "TableCellBold"), P("Menerapkan aturan bisnis, authorization, validasi input, dan kontrak service.", "TableCell")],
        [P("Database", "TableCellBold"), P("Menjadi sumber data resmi untuk angka, status, transaksi, dan histori.", "TableCell")],
        [P("Hindsight atau memory", "TableCellBold"), P("Menyimpan konteks historis bila memang diperlukan dan sesuai scope customer/project.", "TableCell")],
        [P("Petugas / approver", "TableCellBold"), P("Mengambil keputusan final untuk kasus sensitif, finansial, akses, atau pengecualian.", "TableCell")],
    ]
    story.append(make_table(boundaries, [47 * mm, 127 * mm], row_bgs=[WHITE, LIGHT_GRAY, WHITE, LIGHT_GRAY, WHITE, LIGHT_GRAY]))
    story.append(Spacer(1, 12))
    story.append(P("Aturan minimum untuk implementasi", "SubTitle"))
    for text in [
        "Jangan kirim credential, connection string, atau data sensitif yang tidak diperlukan ke Laya.",
        "Jangan biarkan Laya membuat free-form database query.",
        "Gunakan allowlist untuk area, operation, workflow, dan status.",
        "Jika hasil ambigu, minta klarifikasi atau arahkan ke petugas.",
        "Simpan audit log keputusan, tetapi batasi isi log sesuai kebijakan data.",
        "Pisahkan konfigurasi Laya tiap project agar label finance tidak tercampur dengan label hospitality.",
    ]:
        story.append(bullet(text))
    story.append(PageBreak())

    # 7
    story.append(P("7. Rencana POC yang disarankan", "SectionTitle"))
    story.append(P("Agar keputusan penggunaan Laya tidak hanya berdasarkan asumsi, lakukan benchmark dengan pertanyaan nyata dan format evaluasi yang sama.", "Body"))
    poc = [
        [P("Tahap", "TableHead"), P("Aktivitas", "TableHead"), P("Output", "TableHead")],
        [P("1. Dataset", "TableCellBold"), P("Kumpulkan 50-100 pertanyaan helpdesk atau operasional yang sudah dianonimkan.", "TableCell"), P("Dataset dengan label expected.", "TableCell")],
        [P("2. Definisi", "TableCellBold"), P("Tentukan label seperti greeting, knowledge, troubleshooting, investigation, escalation, dan domain bisnis.", "TableCell"), P("Schema keputusan dan allowlist.", "TableCell")],
        [P("3. Baseline", "TableCellBold"), P("Uji dataset ke NAVA atau routing yang berjalan saat ini.", "TableCell"), P("Akurasi dan latency baseline.", "TableCell")],
        [P("4. Perbandingan", "TableCellBold"), P("Uji dataset yang sama ke Laya, Lev, dan Jev jika tersedia.", "TableCell"), P("Matriks hasil yang adil.", "TableCell")],
        [P("5. Review", "TableCellBold"), P("Periksa salah routing, timeout, biaya, dan kemudahan deployment.", "TableCell"), P("Daftar kelebihan dan risiko.", "TableCell")],
        [P("6. Keputusan", "TableCellBold"), P("Pilih engine berdasarkan data, bukan asumsi atau popularitas.", "TableCell"), P("Rekomendasi implementasi.", "TableCell")],
    ]
    story.append(make_table(poc, [33 * mm, 94 * mm, 47 * mm], row_bgs=[WHITE, LIGHT_GRAY, WHITE, LIGHT_GRAY, WHITE, LIGHT_GRAY]))
    story.append(Spacer(1, 12))
    story.append(P("Metrik yang perlu dicatat", "SubTitle"))
    for text in [
        "Akurasi label dan ketepatan workflow.",
        "Rata-rata dan percentile latency.",
        "Jumlah fallback, klarifikasi, timeout, dan error.",
        "Biaya model atau kebutuhan resource.",
        "Kemudahan instalasi, deployment, observability, dan debugging.",
        "Dampak terhadap keamanan dan data project.",
    ]:
        story.append(bullet(text))
    story.append(Spacer(1, 8))
    final = Table([[P("Rekomendasi akhir", "SubTitle")], [P("Mulai dari satu pilot yang terukur, paling tepat Buana Virtual Assistance atau routing operasional NAGAGOLD. Setelah hasilnya stabil, pola decision layer dapat dibagikan ke finance, hospitality, dan project internal lain tanpa mengubah Laya menjadi sumber data bisnis.", "Body")]], colWidths=[174 * mm])
    final.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT_TEAL),
        ("BOX", (0, 0), (-1, -1), 0.8, TEAL),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(final)

    doc.build(story, onFirstPage=cover_page, onLaterPages=page_header_footer)


if __name__ == "__main__":
    build()
    print(OUTPUT)
