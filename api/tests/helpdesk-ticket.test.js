import test from "node:test";
import assert from "node:assert/strict";
import { createTicketDocument, normalizePriority, ticketCsv } from "../src/services/ticket-service.js";
import { filesToAttachments } from "../src/middleware/upload.js";
import {
  deriveHandoverIssue,
  escalationConsentQuestion,
  hasTicketCreatedClaim,
  isAffirmativeEscalationReply,
  isExplicitHumanHandoverRequest,
  isGenericHumanHandoverRequest,
  isInformationalProgramQuestion,
  isNegativeEscalationReply,
  sanitizeAnswerWithoutTicket,
  shouldCreateAgentEscalationTicket,
} from "../src/controllers/chat-controller.js";

test("create ticket customer escalation memakai session yang sama", () => {
  const ticket = createTicketDocument({
    sessionId: "session-123",
    customerId: "customer-456",
    customerName: "Budi",
    subject: "Struk tidak keluar",
    reason: "Customer menekan tombol eskalasi.",
    source: "customer_button",
    priority: "normal",
  });

  assert.equal(ticket.session_id, "session-123");
  assert.equal(ticket.customer_id, "customer-456");
  assert.equal(ticket.customer_name, "Budi");
  assert.equal(ticket.status, "new");
  assert.equal(ticket.handover_status, "pending");
  assert.equal(ticket.source, "customer_button");
  assert.match(ticket.ticket_code, /^TCK-\d{8}-[A-F0-9]{6}$/);
});

test("ticket agent escalation tetap masuk struktur ticket yang sama", () => {
  const ticket = createTicketDocument({
    sessionId: "session-agent",
    customerId: "customer-agent",
    subject: "Eskalasi otomatis NAVA",
    reason: "Knowledge meminta eskalasi.",
    source: "agent_escalation",
    priority: "high",
  });

  assert.equal(ticket.session_id, "session-agent");
  assert.equal(ticket.source, "agent_escalation");
  assert.equal(ticket.priority, "high");
  assert.equal(ticket.assigned_helpdesk_id, null);
  assert.equal(ticket.resolved_at, null);
});

test("priority tidak valid dinormalisasi ke normal", () => {
  assert.equal(normalizePriority("urgent"), "urgent");
  assert.equal(normalizePriority("aneh"), "normal");
});

test("upload attachment metadata sesuai kontrak frontend dan MongoDB", () => {
  const attachments = filesToAttachments([
    {
      filename: "1700000000000-test.png",
      originalname: "struk.png",
      mimetype: "image/png",
      size: 123456,
    },
  ]);

  assert.deepEqual(attachments, [
    {
      filename: "1700000000000-test.png",
      original_name: "struk.png",
      mime_type: "image/png",
      size: 123456,
      url: "/uploads/helpdesk/1700000000000-test.png",
    },
  ]);
});

test("permintaan petugas manusia generik perlu klarifikasi masalah baru", () => {
  assert.equal(isGenericHumanHandoverRequest("Saya ingin dibantu petugas manusia"), true);
  assert.equal(isGenericHumanHandoverRequest("hubungi admin dong"), true);
  assert.equal(isGenericHumanHandoverRequest("saya gak bisa login, hubungi helpdesk"), false);
  assert.equal(isGenericHumanHandoverRequest("minta admin karena lupa password"), false);
});

test("pertanyaan informasi program tidak otomatis dibuatkan ticket oleh eskalasi agent", () => {
  const escalation = {
    issue_summary: "Customer ingin diarahkan ke menu laporan rekap",
    reason: "Knowledge belum cukup untuk menunjuk menu.",
    attempted_steps: [],
  };

  assert.equal(isInformationalProgramQuestion("oh aku pengennya liat yg rekapan, liatnya dimana?"), true);
  assert.equal(shouldCreateAgentEscalationTicket({
    question: "oh aku pengennya liat yg rekapan, liatnya dimana?",
    escalation,
  }), false);
  assert.equal(shouldCreateAgentEscalationTicket({
    question: "saya gak bisa login dan minta admin bantu",
    escalation: { ...escalation, reason: "Customer gagal login." },
  }), true);
  assert.equal(shouldCreateAgentEscalationTicket({
    question: "struk tidak keluar setelah transaksi",
    escalation: { ...escalation, reason: "Troubleshooting sudah dicoba tetapi gagal." },
  }), true);
});

test("klaim ticket dibuat oleh model terdeteksi sebagai jawaban yang perlu disanitasi", () => {
  assert.equal(hasTicketCreatedClaim("Kendala ini sudah saya teruskan ke helpdesk dan ticket-nya sudah dibuat."), true);
  assert.equal(hasTicketCreatedClaim("Saya bisa teruskan ke helpdesk jika Anda membutuhkan bantuan petugas."), false);
});

test("jawaban proposal eskalasi meminta persetujuan user lebih dulu", () => {
  assert.match(
    escalationConsentQuestion({ issue_summary: "Customer tidak menemukan menu logout device lain" }),
    /Mau saya teruskan ke helpdesk/
  );
});

test("persetujuan eskalasi user dikenali sebelum ticket dibuat", () => {
  assert.equal(isAffirmativeEscalationReply("iya boleh lanjutkan"), true);
  assert.equal(isAffirmativeEscalationReply("oke teruskan ke petugas"), true);
  assert.equal(isNegativeEscalationReply("jangan dulu"), true);
  assert.equal(isNegativeEscalationReply("belum perlu"), true);
  assert.equal(isAffirmativeEscalationReply("ini maksud saya laporan rekap"), false);
});

test("export CSV ticket memakai kolom operasional dan fallback kosong", () => {
  const csv = ticketCsv([{
    ticket_code: "TCK-20260910-ABC123",
    customer_name: "Aan",
    subject: "Tidak bisa login",
    status: "resolved",
    assigned_helpdesk_name: "",
    created_at: new Date("2026-09-10T02:00:00.000Z"),
    resolved_at: null,
  }]);

  assert.match(csv, /"Kode Ticket","Customer","Subject","Status","Helpdesk","Tanggal Dibuat","Tanggal Selesai","Waktu Respons Pertama","Waktu Penyelesaian"/);
  assert.match(csv, /"TCK-20260910-ABC123","Aan","Tidak bisa login","resolved","Belum ditangani"/);
  assert.match(csv, /"-","-","-"/);
});


test("permintaan eksplisit helpdesk atau pembuatan ticket dianggap consent langsung", () => {
  assert.equal(isExplicitHumanHandoverRequest("boleh deh, langsung ke helpdesk aja"), true);
  assert.equal(isExplicitHumanHandoverRequest("Saya ingin dibantu petugas manusia"), true);
  assert.equal(isExplicitHumanHandoverRequest("iya teruskan ke helpdesk"), true);
  assert.equal(isExplicitHumanHandoverRequest("ya, bikinin tiketnya"), true);
  assert.equal(isExplicitHumanHandoverRequest("saya gak bisa login, hubungi helpdesk"), true);
  assert.equal(isExplicitHumanHandoverRequest("helpdesk itu apa?"), false);
  assert.equal(isExplicitHumanHandoverRequest("status tiket saya dimana?"), false);
});

test("subject handover mengambil kendala terakhir dan mengabaikan pesan minta helpdesk", () => {
  const issue = deriveHandoverIssue([
    { role: "user", content: "saya salah input transaksi titipan dan ingin membatalkannya" },
    { role: "assistant", content: "Saya bisa bantu teruskan ke helpdesk." },
    { role: "user", content: "boleh deh, langsung ke helpdesk aja" },
  ]);
  assert.match(issue.subject, /salah input transaksi titipan/i);
  assert.doesNotMatch(issue.subject, /langsung ke helpdesk/i);
});

test("handover tanpa konteks tetap bisa membuat ticket generik tanpa loop klarifikasi", () => {
  const issue = deriveHandoverIssue([
    { role: "user", content: "Saya ingin dibantu petugas manusia" },
  ]);
  assert.equal(issue.subject, "Permintaan bantuan helpdesk");
});

test("klaim ticket pada pertanyaan informasi tidak diubah menjadi tawaran eskalasi", () => {
  const answer = sanitizeAnswerWithoutTicket({
    answer: "Ticket sudah dibuat dan kendala diteruskan ke helpdesk.",
    question: "oh aku pengennya liat yg rekapan, liatnya dimana?",
    escalationBlocked: true,
  });
  assert.doesNotMatch(answer, /mau saya teruskan/i);
  assert.match(answer, /belum membuat ticket/i);
});
