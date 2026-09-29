import { useEffect, useState } from "react";
import { Archive, ArrowLeft, BookOpenCheck, Plus, Save, ShieldCheck, Upload } from "lucide-react";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { getStoredHelpdeskUser } from "../../lib/helpdeskAuth";
import { handleHelpdeskNavigation } from "../../lib/navigation";
import { api } from "../../services/api";
import type { InvestigationPlaybook } from "../../types";

type PlaybookForm = {
  playbook_id: string;
  name: string;
  description: string;
  trigger_examples: string;
  aggregation_source: string;
  finding_rules: string;
  correction_guidance: string;
  response_template: string;
  safety_notes: string;
};

const defaultAggregation = `db.th_barang_saldo.aggregate([
  { "$match": { "tanggal": "{{tanggal}}" } },
  { "$limit": 50 }
])`;

const emptyForm: PlaybookForm = {
  playbook_id: "",
  name: "",
  description: "",
  trigger_examples: "",
  aggregation_source: defaultAggregation,
  finding_rules: "Jelaskan kondisi yang dianggap selisih, field yang dibandingkan, dan cara membaca hasil aggregation.",
  correction_guidance: "Tuliskan collection, filter, field current, field expected, serta pemeriksaan sebelum koreksi. Jangan melakukan perubahan otomatis.",
  response_template: "TEMUAN\n...\n\nEVIDENCE\n...\n\nKEMUNGKINAN PENYEBAB\n...\n\nSARAN PERBAIKAN\n...",
  safety_notes: "Read-only. Jangan mengubah database otomatis. Pastikan transaksi backdate, pembatalan, dan stock opname sudah diperiksa sebelum menyarankan koreksi.",
};

function statusLabel(status?: string) {
  if (status === "published") return "Published";
  if (status === "archived") return "Archived";
  return "Draft";
}

function statusClass(status?: string) {
  return `article-status status-${status || "draft"}`;
}

function formFromPlaybook(item: InvestigationPlaybook): PlaybookForm {
  return {
    playbook_id: item.playbook_id,
    name: item.name || "",
    description: item.description || "",
    trigger_examples: (item.trigger_examples || []).join("\n"),
    aggregation_source: item.aggregation_source || (item.execution?.source_collection ? `db.${item.execution.source_collection}.aggregate(${JSON.stringify(item.execution.pipeline || [], null, 2)})` : defaultAggregation),
    finding_rules: item.finding_rules || "",
    correction_guidance: item.correction_guidance || "",
    response_template: item.response_template || "",
    safety_notes: item.safety_notes || "",
  };
}

export function InvestigationPlaybooksPage() {
  const user = getStoredHelpdeskUser();
  const [playbooks, setPlaybooks] = useState<InvestigationPlaybook[]>([]);
  const [selected, setSelected] = useState<InvestigationPlaybook | null>(null);
  const [form, setForm] = useState<PlaybookForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");
      setPlaybooks(await api.investigationPlaybooks());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat Playbook investigasi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function resetEditor() {
    setSelected(null);
    setForm(emptyForm);
    setError("");
    setNotice("");
  }

  function updateField<K extends keyof PlaybookForm>(key: K, value: PlaybookForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function payloadFromForm() {
    return {
      playbook_id: form.playbook_id.trim() || undefined,
      name: form.name,
      description: form.description,
      status: "draft" as const,
      trigger_examples: form.trigger_examples.split("\n").map((item) => item.trim()).filter(Boolean),
      aggregation_source: form.aggregation_source,
      finding_rules: form.finding_rules,
      correction_guidance: form.correction_guidance,
      response_template: form.response_template,
      safety_notes: form.safety_notes,
    };
  }

  async function save() {
    try {
      setSaving(true); setError(""); setNotice("");
      const payload = payloadFromForm();
      const saved = selected ? await api.updateInvestigationPlaybook(selected.playbook_id, payload) : await api.createInvestigationPlaybook(payload);
      setSelected(saved); setForm(formFromPlaybook(saved));
      setNotice("Playbook tersimpan sebagai draft. Setelah diuji, publish agar bisa dipakai NAVA.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Playbook belum dapat disimpan.");
    } finally { setSaving(false); }
  }

  async function publish() {
    if (!selected) return;
    try {
      setSaving(true); setError("");
      const saved = await api.publishInvestigationPlaybook(selected.playbook_id);
      setSelected(saved); setForm(formFromPlaybook(saved));
      setNotice("Playbook published dan akan dipakai NAVA tanpa perubahan script backend.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Playbook belum siap dipublish.");
    } finally { setSaving(false); }
  }

  async function archive() {
    if (!selected) return;
    try {
      setSaving(true); setError("");
      const saved = await api.archiveInvestigationPlaybook(selected.playbook_id);
      setSelected(saved); setForm(formFromPlaybook(saved));
      setNotice("Playbook diarsipkan dan tidak akan dipilih NAVA.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengarsipkan Playbook.");
    } finally { setSaving(false); }
  }

  const disabled = user?.role !== "admin" || saving;

  return (
    <HelpdeskLayout>
      <section className="investigation-definition-page investigation-playbook-page">
        <div className="article-head">
          <div><span className="eyebrow"><BookOpenCheck size={14} /> Investigation Design</span><h1>Playbook Investigasi</h1><p>Isi resep pemeriksaan sekali. NAVA akan memilih Playbook dari pertanyaan Helpdesk, menjalankan aggregation read-only, lalu menjelaskan temuan dan saran koreksi.</p></div>
          <div className="article-head-actions"><a className="button secondary investigation-back-button" href="/helpdesk/investigation" onClick={handleHelpdeskNavigation}><ArrowLeft size={15} /> Kembali</a>{user?.role === "admin" && <button className="button primary" type="button" onClick={resetEditor}><Plus size={15} /> Playbook Baru</button>}</div>
        </div>

        <div className="playbook-legacy-note"><ShieldCheck size={18} /><div><strong>Konfigurasi tanpa update backend per kasus</strong><span>Operation lama tetap tersedia sebagai fallback. Playbook baru cukup disimpan, diuji, dan dipublish dari sini. Query tetap read-only dan dibatasi collection serta operator yang aman.</span></div></div>
        {error && <div className="error-box">{error}</div>}
        {notice && <div className="success-box">{notice}</div>}

        <div className={`investigation-definition-layout ${playbooks.length ? "" : "playbook-editor-only"}`}>
          <section className="panel-card investigation-definition-list"><div className="training-panel-head"><div><span className="eyebrow"><BookOpenCheck size={14} /> Catalog</span><h2>Daftar Playbook</h2></div><small>{playbooks.length} item</small></div>{loading && <div className="empty-state">Memuat Playbook...</div>}{!loading && !playbooks.length && <div className="empty-state">Belum ada Playbook baru.</div>}{playbooks.map((item) => <button className={`article-item ${selected?.playbook_id === item.playbook_id ? "active" : ""}`} type="button" key={item.playbook_id} onClick={() => { setSelected(item); setForm(formFromPlaybook(item)); setError(""); setNotice(""); }}><strong>{item.name}</strong><span>{item.playbook_id}</span><p>{item.description || "Belum ada konteks masalah."}</p><span className={statusClass(item.status)}>{statusLabel(item.status)}</span></button>)}</section>

          <section className="panel-card investigation-definition-editor">
            <div className="training-panel-head"><div><span className="eyebrow"><BookOpenCheck size={14} /> Resep pemeriksaan</span><h2>{selected?.name || "Playbook Baru"}</h2></div>{selected && <span className={statusClass(selected.status)}>{statusLabel(selected.status)}</span>}</div>

            <div className="playbook-section-title"><span className="playbook-section-icon"><BookOpenCheck size={16} /></span><div><h3>1. Masalah yang dikenali NAVA</h3><p>Bagian ini membantu NAVA memilih Playbook dari bahasa Helpdesk.</p></div></div>
            <div className="investigation-form-grid"><label className="investigation-form-wide">Nama Playbook<input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Selisih laporan barang summary dan detail" disabled={disabled} /></label><label className="investigation-form-wide">Masalah yang ditangani<textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} placeholder="Mencari barcode yang membuat saldo summary berbeda dengan saldo barang realtime." disabled={disabled} /></label><label className="investigation-form-wide">Contoh pertanyaan<small>Satu pertanyaan per baris. Tulis dengan bahasa yang biasa dipakai Helpdesk.</small><textarea value={form.trigger_examples} onChange={(event) => updateField("trigger_examples", event.target.value)} placeholder={'Kenapa laporan summary dan detail barang berbeda?\nCari barcode yang membuat stok hari ini selisih.'} disabled={disabled} /></label></div>

            <div className="playbook-section-title"><span className="playbook-section-icon">2</span><div><h3>2. Aggregation pemeriksaan</h3><p>Cukup tempel aggregation lengkap. Collection sumber, collection `$lookup`, parameter <code>{"{{...}}"}</code>, dan batas hasil akan dibaca otomatis oleh backend.</p></div></div>
            <label className="playbook-code-label">Aggregation MongoDB read-only<small>Gunakan format <code>db.nama_collection.aggregate([...])</code>. Untuk nilai dari pertanyaan Helpdesk, gunakan placeholder seperti <code>{`{{tanggal}}`}</code> atau <code>{`{{kode_gudang}}`}</code>.</small><textarea className="playbook-pipeline-input" value={form.aggregation_source} onChange={(event) => updateField("aggregation_source", event.target.value)} placeholder={defaultAggregation} disabled={disabled} spellCheck={false} /></label>

            <div className="playbook-section-title"><span className="playbook-section-icon">3</span><div><h3>3. Cara membaca dan menjawab hasil</h3><p>Bagian ini menjadikan hasil query berguna bagi Helpdesk, termasuk kandidat koreksi.</p></div></div>
            <div className="investigation-form-grid"><label className="investigation-form-wide">Aturan temuan<textarea value={form.finding_rules} onChange={(event) => updateField("finding_rules", event.target.value)} placeholder="Jika stock_akhir tanggal sebelumnya berbeda dengan stock_awal tanggal berikutnya, status mismatch." disabled={disabled} /></label><label className="investigation-form-wide">Panduan koreksi<textarea value={form.correction_guidance} onChange={(event) => updateField("correction_guidance", event.target.value)} placeholder="Tampilkan collection, filter, current, expected, dan pemeriksaan sebelum koreksi." disabled={disabled} /></label><label className="investigation-form-wide">Format jawaban<textarea value={form.response_template} onChange={(event) => updateField("response_template", event.target.value)} placeholder="TEMUAN, EVIDENCE, KEMUNGKINAN PENYEBAB, SARAN PERBAIKAN" disabled={disabled} /></label><label className="investigation-form-wide">Batasan keamanan<textarea value={form.safety_notes} onChange={(event) => updateField("safety_notes", event.target.value)} placeholder="Read-only; koreksi tetap dilakukan manual." disabled={disabled} /></label></div>

            {user?.role === "admin" && <div className="article-actions"><button className="button secondary" type="button" onClick={save} disabled={saving}><Save size={15} /> {saving ? "Menyimpan..." : "Simpan Draft"}</button>{selected && selected.status !== "published" && <button className="button primary" type="button" onClick={publish} disabled={saving}><Upload size={15} /> Publish</button>}{selected && selected.status !== "archived" && <button className="button secondary" type="button" onClick={archive} disabled={saving}><Archive size={15} /> Archive</button>}</div>}
          </section>
        </div>
      </section>
    </HelpdeskLayout>
  );
}
