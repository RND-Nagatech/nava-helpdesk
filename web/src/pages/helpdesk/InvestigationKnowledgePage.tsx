import { useEffect, useState } from "react";
import { Archive, ArrowLeft, BookOpenText, Plus, Save, Upload, X } from "lucide-react";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { getStoredHelpdeskUser } from "../../lib/helpdeskAuth";
import { handleHelpdeskNavigation } from "../../lib/navigation";
import { api } from "../../services/api";
import type { InvestigationKnowledge, KnowledgeStep } from "../../types";

type KnowledgeForm = {
  articleId: string;
  title: string;
  category: string;
  symptoms: string;
  tags: string;
  steps: KnowledgeStep[];
  userResponseTemplate: string;
  internalNotes: string;
  linked_operation_ids: string;
};

const emptyKnowledge: KnowledgeForm = {
  articleId: "",
  title: "",
  category: "",
  symptoms: "",
  tags: "",
  steps: [{ order: 1, title: "", instruction: "", expectedResult: "" }],
  userResponseTemplate: "",
  internalNotes: "",
  linked_operation_ids: "",
};

const sampleKnowledge: KnowledgeForm = {
  articleId: "",
  title: "Selisih keuangan dan penjualan",
  category: "keuangan",
  symptoms: "Total keuangan berbeda dengan laporan penjualan",
  tags: "cash, penjualan, selisih",
  steps: [{ order: 1, title: "Validasi periode", instruction: "Samakan periode, toko, dan status transaksi sebelum membandingkan laporan.", expectedResult: "Scope laporan sama." }],
  userResponseTemplate: "Gunakan operation investigasi finance.sales_vs_cash jika sudah published.",
  internalNotes: "Jelaskan collection dan field relasi berdasarkan operation. Jangan mengklaim database sudah diubah.",
  linked_operation_ids: "finance.sales_vs_cash",
};

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formFromKnowledge(item: InvestigationKnowledge): KnowledgeForm {
  return {
    articleId: item.articleId,
    title: item.title || "",
    category: item.category || "",
    symptoms: item.symptoms.join(", "),
    tags: item.tags.join(", "),
    steps: item.troubleshootingSteps.length ? item.troubleshootingSteps : [{ order: 1, title: "", instruction: "", expectedResult: "" }],
    userResponseTemplate: item.userResponseTemplate || "",
    internalNotes: item.internalNotes || "",
    linked_operation_ids: item.linked_operation_ids.join(", "),
  };
}

function statusLabel(status?: string) {
  if (status === "published") return "Published";
  if (status === "archived") return "Archived";
  return "Draft";
}

export function InvestigationKnowledgePage() {
  const user = getStoredHelpdeskUser();
  const [items, setItems] = useState<InvestigationKnowledge[]>([]);
  const [selected, setSelected] = useState<InvestigationKnowledge | null>(null);
  const [form, setForm] = useState<KnowledgeForm>(sampleKnowledge);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");
      setItems(await api.investigationKnowledge());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat knowledge investigasi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setSelected(null);
    setForm(emptyKnowledge);
    setError("");
    setNotice("");
  }

  function openItem(item: InvestigationKnowledge) {
    setSelected(item);
    setForm(formFromKnowledge(item));
    setError("");
    setNotice("");
  }

  function updateField<K extends keyof KnowledgeForm>(key: K, value: KnowledgeForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateStep(index: number, key: keyof KnowledgeStep, value: string) {
    setForm((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, [key]: value } : step) }));
  }

  function payloadFromForm() {
    return {
      articleId: form.articleId,
      title: form.title,
      category: form.category,
      symptoms: csv(form.symptoms),
      tags: csv(form.tags),
      troubleshootingSteps: form.steps.filter((step) => step.instruction.trim()).map((step, index) => ({ ...step, order: index + 1 })),
      userResponseTemplate: form.userResponseTemplate,
      internalNotes: form.internalNotes,
      linked_operation_ids: csv(form.linked_operation_ids),
      status: "draft" as const,
    };
  }

  async function save() {
    try {
      setSaving(true);
      setError("");
      setNotice("");
      const saved = selected
        ? await api.updateInvestigationKnowledge(selected.articleId, payloadFromForm())
        : await api.createInvestigationKnowledge(payloadFromForm());
      setSelected(saved);
      setForm(formFromKnowledge(saved));
      setNotice("Knowledge investigasi tersimpan sebagai draft.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Form knowledge belum valid.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!selected) return;
    try {
      setSaving(true);
      setError("");
      const saved = await api.publishInvestigationKnowledge(selected.articleId);
      setSelected(saved);
      setForm(formFromKnowledge(saved));
      setNotice("Knowledge investigasi sudah published dan hanya dipakai room Investigasi.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Knowledge belum siap dipublish.");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!selected) return;
    try {
      setSaving(true);
      setError("");
      const saved = await api.archiveInvestigationKnowledge(selected.articleId);
      setSelected(saved);
      setForm(formFromKnowledge(saved));
      setNotice("Knowledge investigasi diarsipkan.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengarsipkan knowledge.");
    } finally {
      setSaving(false);
    }
  }

  const disabled = user?.role !== "admin" || saving;

  return (
    <HelpdeskLayout>
      <section className="investigation-definition-page">
        <div className="article-head">
          <div>
            <span className="eyebrow"><BookOpenText size={14} /> Internal Knowledge</span>
            <h1>Knowledge Investigasi</h1>
            <p>Isi panduan dengan form biasa. Knowledge ini tidak masuk retrieval customer.</p>
          </div>
          <div className="article-head-actions">
            <a className="button secondary investigation-back-button" href="/helpdesk/investigation" onClick={handleHelpdeskNavigation}><ArrowLeft size={15} /> Kembali ke Investigasi</a>
            {user?.role === "admin" && <button className="button primary" type="button" onClick={openNew}><Plus size={15} /> Knowledge Baru</button>}
          </div>
        </div>
        {error && <div className="error-box">{error}</div>}
        {notice && <div className="success-box">{notice}</div>}

        <div className="investigation-definition-layout">
          <section className="panel-card investigation-definition-list">
            <div className="training-panel-head"><div><span className="eyebrow"><BookOpenText size={14} /> Internal Catalog</span><h2>Daftar Panduan</h2></div><small>{items.length} item</small></div>
            {loading && <div className="empty-state">Memuat knowledge...</div>}
            {!loading && !items.length && <div className="empty-state">Belum ada knowledge investigasi.</div>}
            {items.map((item) => <button className={`article-item ${selected?.articleId === item.articleId ? "active" : ""}`} type="button" key={item.articleId} onClick={() => openItem(item)}><strong>{item.title}</strong><span>{item.category || "tanpa kategori"}</span><p>{item.symptoms?.[0] || "Tanpa konteks."}</p><span className={`article-status status-${item.status}`}>{statusLabel(item.status)}</span></button>)}
          </section>

          <section className="panel-card investigation-definition-editor">
            <div className="training-panel-head"><div><span className="eyebrow"><BookOpenText size={14} /> Knowledge Form</span><h2>{selected?.title || "Knowledge Baru"}</h2></div>{selected && <span className={`article-status status-${selected.status}`}>{statusLabel(selected.status)}</span>}</div>
            <p className="article-helper-note">Gunakan satu panduan untuk satu konteks investigasi agar NAVA mudah menemukan relasi dan prosedurnya.</p>

            <div className="investigation-form-grid">
              <label>Judul panduan<input value={form.title} onChange={(event) => updateField("title", event.target.value)} placeholder="Contoh: Selisih keuangan dan penjualan" disabled={disabled} /></label>
              <label>Kategori<input value={form.category} onChange={(event) => updateField("category", event.target.value)} placeholder="keuangan, barang, buyback" disabled={disabled} /></label>
              <label className="investigation-form-wide">Konteks atau gejala<small>Jelaskan pertanyaan/masalah yang akan memanggil panduan ini.</small><textarea value={form.symptoms} onChange={(event) => updateField("symptoms", event.target.value)} placeholder="Total keuangan berbeda dengan laporan penjualan" disabled={disabled} /></label>
              <label className="investigation-form-wide">Kata kunci<small>Pisahkan dengan koma.</small><input value={form.tags} onChange={(event) => updateField("tags", event.target.value)} placeholder="cash, penjualan, selisih" disabled={disabled} /></label>
            </div>

            <div className="investigation-form-section"><div className="investigation-form-section-head"><div><h3>Langkah investigasi</h3><p>Susun langkah dari validasi input sampai cara membaca hasil.</p></div><button className="button secondary" type="button" onClick={() => setForm((current) => ({ ...current, steps: [...current.steps, { order: current.steps.length + 1, title: "", instruction: "", expectedResult: "" }] }))} disabled={disabled}>Tambah langkah</button></div>
              {form.steps.map((step, index) => <div className="investigation-step-card" key={index}><div className="investigation-step-number">{index + 1}</div><div className="investigation-form-grid"><label>Judul langkah<input value={step.title || ""} onChange={(event) => updateStep(index, "title", event.target.value)} placeholder="Validasi periode" disabled={disabled} /></label><label>Hasil yang diharapkan<input value={step.expectedResult || ""} onChange={(event) => updateStep(index, "expectedResult", event.target.value)} placeholder="Scope laporan sama" disabled={disabled} /></label><label className="investigation-form-wide">Instruksi<textarea value={step.instruction} onChange={(event) => updateStep(index, "instruction", event.target.value)} placeholder="Samakan periode, toko, gudang, dan status transaksi." disabled={disabled} /></label></div>{form.steps.length > 1 && <button className="icon-ghost investigation-step-remove" type="button" onClick={() => setForm((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }))} disabled={disabled} title="Hapus langkah" aria-label="Hapus langkah"><X size={15} /></button>}</div>)}
            </div>

            <div className="investigation-form-grid"><label className="investigation-form-wide">Template jawaban internal<small>Format ringkas yang membantu NAVA menjelaskan hasil kepada Helpdesk.</small><textarea value={form.userResponseTemplate} onChange={(event) => updateField("userResponseTemplate", event.target.value)} placeholder="Jelaskan temuan, evidence, penyebab, dan saran perbaikan." disabled={disabled} /></label><label className="investigation-form-wide">Catatan internal<small>Relasi collection, field, status transaksi, atau batasan teknis.</small><textarea value={form.internalNotes} onChange={(event) => updateField("internalNotes", event.target.value)} placeholder="tt_jual_detail.no_faktur direlasikan ke tt_cash_daily.deskripsi..." disabled={disabled} /></label><label className="investigation-form-wide">Operation terkait<small>Pakai operation ID, pisahkan dengan koma.</small><input value={form.linked_operation_ids} onChange={(event) => updateField("linked_operation_ids", event.target.value)} placeholder="finance.sales_vs_cash" disabled={disabled} /></label></div>

            {user?.role === "admin" && <div className="article-actions"><button className="button secondary" type="button" onClick={save} disabled={saving}><Save size={15} /> {saving ? "Menyimpan..." : "Simpan Draft"}</button>{selected && selected.status !== "published" && <button className="button primary" type="button" onClick={publish} disabled={saving}><Upload size={15} /> Publish</button>}{selected && selected.status !== "archived" && <button className="button secondary" type="button" onClick={archive} disabled={saving}><Archive size={15} /> Archive</button>}</div>}
          </section>
        </div>
      </section>
    </HelpdeskLayout>
  );
}
