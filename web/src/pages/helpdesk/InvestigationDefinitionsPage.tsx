import { useEffect, useState } from "react";
import { Archive, ArrowLeft, Code2, DatabaseZap, Plus, Save, Upload, X } from "lucide-react";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { getStoredHelpdeskUser } from "../../lib/helpdeskAuth";
import { handleHelpdeskNavigation } from "../../lib/navigation";
import { api } from "../../services/api";
import type { InvestigationDefinition } from "../../types";

type MetricForm = {
  source: string;
  field: string;
  operation: "sum" | "count" | "avg" | "min" | "max";
  alias: string;
};

type DefinitionForm = {
  operation_id: string;
  name: string;
  description: string;
  allowed_collections: string;
  filters: string;
  group_by: string;
  metrics: MetricForm[];
  left_collection: string;
  left_field: string;
  right_collection: string;
  right_field: string;
  result_type: InvestigationDefinition["result_type"];
  linked_knowledge_ids: string;
  execution_source_collection: string;
  execution_max_rows: string;
  pipeline_json: string;
};

const sampleDefinition: DefinitionForm = {
  operation_id: "finance.sales_vs_cash",
  name: "Selisih Penjualan dan Keuangan",
  description: "Membandingkan transaksi penjualan dengan catatan keuangan secara read-only.",
  allowed_collections: "tt_jual_detail, tt_cash_daily",
  filters: "tanggal_awal, tanggal_akhir, kode_toko",
  group_by: "no_faktur, kode_toko",
  metrics: [
    { source: "tt_jual_detail", field: "nominal", operation: "sum", alias: "total_penjualan" },
    { source: "tt_cash_daily", field: "jumlah_out", operation: "sum", alias: "total_cash" },
  ],
  left_collection: "tt_jual_detail",
  left_field: "no_faktur",
  right_collection: "tt_cash_daily",
  right_field: "deskripsi",
  result_type: "unmatched_and_amount_difference",
  linked_knowledge_ids: "",
  execution_source_collection: "",
  execution_max_rows: "100",
  pipeline_json: "",
};

const emptyDefinition: DefinitionForm = {
  ...sampleDefinition,
  operation_id: "",
  name: "",
  description: "",
  allowed_collections: "",
  filters: "",
  group_by: "",
  metrics: [{ source: "", field: "", operation: "sum", alias: "" }],
  left_collection: "",
  left_field: "",
  right_collection: "",
  right_field: "",
  linked_knowledge_ids: "",
  execution_source_collection: "",
  pipeline_json: "",
};

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formFromDefinition(definition: InvestigationDefinition): DefinitionForm {
  return {
    operation_id: definition.operation_id,
    name: definition.name,
    description: definition.description || "",
    allowed_collections: definition.allowed_collections.join(", "),
    filters: definition.filters.join(", "),
    group_by: definition.group_by.join(", "),
    metrics: definition.metrics.length ? definition.metrics.map((metric) => ({ ...metric, alias: metric.alias || "" })) : [{ source: "", field: "", operation: "sum", alias: "" }],
    left_collection: definition.relation?.left_collection || "",
    left_field: definition.relation?.left_field || "",
    right_collection: definition.relation?.right_collection || "",
    right_field: definition.relation?.right_field || "",
    result_type: definition.result_type,
    linked_knowledge_ids: definition.linked_knowledge_ids.join(", "),
    execution_source_collection: definition.execution?.source_collection || "",
    execution_max_rows: String(definition.execution?.max_rows || 100),
    pipeline_json: definition.execution?.pipeline?.length ? JSON.stringify(definition.execution.pipeline, null, 2) : "",
  };
}

function statusLabel(status?: string) {
  if (status === "published") return "Published";
  if (status === "archived") return "Archived";
  return "Draft";
}

export function InvestigationDefinitionsPage() {
  const user = getStoredHelpdeskUser();
  const [definitions, setDefinitions] = useState<InvestigationDefinition[]>([]);
  const [selected, setSelected] = useState<InvestigationDefinition | null>(null);
  const [form, setForm] = useState<DefinitionForm>(sampleDefinition);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");
      setDefinitions(await api.investigationDefinitions());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat definition investigasi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setSelected(null);
    setForm(emptyDefinition);
    setError("");
    setNotice("");
  }

  function openDefinition(definition: InvestigationDefinition) {
    setSelected(definition);
    setForm(formFromDefinition(definition));
    setError("");
    setNotice("");
  }

  function updateField<K extends keyof DefinitionForm>(key: K, value: DefinitionForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateMetric(index: number, key: keyof MetricForm, value: string) {
    setForm((current) => ({
      ...current,
      metrics: current.metrics.map((metric, metricIndex) => metricIndex === index ? { ...metric, [key]: value } : metric),
    }));
  }

  function payloadFromForm() {
    let pipeline: Array<Record<string, unknown>> = [];
    if (form.pipeline_json.trim()) {
      const parsed = JSON.parse(form.pipeline_json);
      if (!Array.isArray(parsed)) throw new Error("Pipeline harus berupa array JSON.");
      pipeline = parsed;
    }
    const collections = csv(form.allowed_collections);
    const relation = form.left_collection && form.left_field && form.right_collection && form.right_field
      ? { left_collection: form.left_collection, left_field: form.left_field, right_collection: form.right_collection, right_field: form.right_field }
      : null;
    return {
      operation_id: form.operation_id,
      name: form.name,
      description: form.description,
      status: "draft" as const,
      allowed_collections: collections,
      filters: csv(form.filters),
      group_by: csv(form.group_by),
      metrics: form.metrics.filter((metric) => metric.source && metric.field).map((metric) => ({ ...metric, alias: metric.alias || undefined })),
      relation,
      result_type: form.result_type,
      linked_knowledge_ids: csv(form.linked_knowledge_ids),
      execution: pipeline.length ? {
        source_collection: form.execution_source_collection || collections[0] || "",
        pipeline,
        max_rows: Number(form.execution_max_rows) || 100,
      } : null,
    };
  }

  async function save() {
    try {
      setSaving(true);
      setError("");
      setNotice("");
      const payload = payloadFromForm();
      const saved = selected
        ? await api.updateInvestigationDefinition(selected.operation_id, payload)
        : await api.createInvestigationDefinition(payload);
      setSelected(saved);
      setForm(formFromDefinition(saved));
      setNotice("Operation tersimpan sebagai draft.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Form operation atau pipeline belum valid.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!selected) return;
    try {
      setSaving(true);
      setError("");
      const saved = await api.publishInvestigationDefinition(selected.operation_id);
      setSelected(saved);
      setForm(formFromDefinition(saved));
      setNotice("Operation sudah published dan dapat dipanggil room Investigasi.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation belum siap dipublish.");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!selected) return;
    try {
      setSaving(true);
      setError("");
      const saved = await api.archiveInvestigationDefinition(selected.operation_id);
      setSelected(saved);
      setForm(formFromDefinition(saved));
      setNotice("Operation diarsipkan dan tidak akan dipanggil NAVA.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengarsipkan operation.");
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
            <span className="eyebrow"><DatabaseZap size={14} /> Internal Configuration</span>
            <h1>Operation Investigasi</h1>
            <p>Isi relasi dan aturan pemeriksaan tanpa harus menulis JSON. Hanya Admin yang dapat mengubahnya.</p>
          </div>
          <div className="article-head-actions">
            <a className="button secondary investigation-back-button" href="/helpdesk/investigation" onClick={handleHelpdeskNavigation}><ArrowLeft size={15} /> Kembali ke Investigasi</a>
            {user?.role === "admin" && <button className="button primary" type="button" onClick={openNew}><Plus size={15} /> Operation Baru</button>}
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
        {notice && <div className="success-box">{notice}</div>}

        <div className="investigation-definition-layout">
          <section className="panel-card investigation-definition-list">
            <div className="training-panel-head"><div><span className="eyebrow"><Code2 size={14} /> Operation Catalog</span><h2>Daftar Operation</h2></div><small>{definitions.length} item</small></div>
            {loading && <div className="empty-state">Memuat operation...</div>}
            {!loading && !definitions.length && <div className="empty-state">Belum ada operation.</div>}
            {definitions.map((definition) => (
              <button className={`article-item ${selected?.operation_id === definition.operation_id ? "active" : ""}`} type="button" key={definition.operation_id} onClick={() => openDefinition(definition)}>
                <strong>{definition.name}</strong><span>{definition.operation_id}</span><p>{definition.description || "Tanpa deskripsi."}</p><span className={`article-status status-${definition.status}`}>{statusLabel(definition.status)}</span>
              </button>
            ))}
          </section>

          <section className="panel-card investigation-definition-editor">
            <div className="training-panel-head"><div><span className="eyebrow"><Code2 size={14} /> Operation Form</span><h2>{selected ? selected.operation_id : "Operation Baru"}</h2></div>{selected && <span className={`article-status status-${selected.status}`}>{statusLabel(selected.status)}</span>}</div>
            <p className="article-helper-note">Simpan sebagai draft untuk menyimpan rancangan relasi. Operation hanya bisa dipublish jika pipeline read-only sudah diisi dan tervalidasi.</p>

            <div className="investigation-form-grid">
              <label>Operation ID<input value={form.operation_id} onChange={(event) => updateField("operation_id", event.target.value)} placeholder="finance.sales_vs_cash" disabled={Boolean(selected) || disabled} /></label>
              <label>Nama operation<input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Selisih Penjualan dan Keuangan" disabled={disabled} /></label>
              <label className="investigation-form-wide">Deskripsi<textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} placeholder="Kapan pemeriksaan ini digunakan?" disabled={disabled} /></label>
              <label className="investigation-form-wide">Collection yang digunakan<small>Pisahkan dengan koma.</small><input value={form.allowed_collections} onChange={(event) => updateField("allowed_collections", event.target.value)} placeholder="tt_jual_detail, tt_cash_daily" disabled={disabled} /></label>
              <label>Filter yang diminta<small>Pisahkan dengan koma.</small><input value={form.filters} onChange={(event) => updateField("filters", event.target.value)} placeholder="tanggal_awal, tanggal_akhir, kode_toko" disabled={disabled} /></label>
              <label>Group by<small>Pisahkan dengan koma.</small><input value={form.group_by} onChange={(event) => updateField("group_by", event.target.value)} placeholder="no_faktur, kode_toko" disabled={disabled} /></label>
            </div>

            <div className="investigation-form-section"><div className="investigation-form-section-head"><div><h3>Relasi collection</h3><p>Isi jika operation menghubungkan dua collection.</p></div></div><div className="investigation-form-grid">
              <label>Collection kiri<input value={form.left_collection} onChange={(event) => updateField("left_collection", event.target.value)} placeholder="tt_jual_detail" disabled={disabled} /></label>
              <label>Field kiri<input value={form.left_field} onChange={(event) => updateField("left_field", event.target.value)} placeholder="no_faktur" disabled={disabled} /></label>
              <label>Collection kanan<input value={form.right_collection} onChange={(event) => updateField("right_collection", event.target.value)} placeholder="tt_cash_daily" disabled={disabled} /></label>
              <label>Field kanan<input value={form.right_field} onChange={(event) => updateField("right_field", event.target.value)} placeholder="deskripsi" disabled={disabled} /></label>
            </div></div>

            <div className="investigation-form-section"><div className="investigation-form-section-head"><div><h3>Metric yang dibandingkan</h3><p>Contoh: jumlahkan nominal penjualan dan jumlah kas keluar.</p></div><button className="button secondary" type="button" onClick={() => setForm((current) => ({ ...current, metrics: [...current.metrics, { source: "", field: "", operation: "sum", alias: "" }] }))} disabled={disabled}>Tambah metric</button></div>
              {form.metrics.map((metric, index) => <div className="investigation-metric-row" key={`${index}-${metric.source}`}><input value={metric.source} onChange={(event) => updateMetric(index, "source", event.target.value)} placeholder="Collection" disabled={disabled} /><input value={metric.field} onChange={(event) => updateMetric(index, "field", event.target.value)} placeholder="Field" disabled={disabled} /><select value={metric.operation} onChange={(event) => updateMetric(index, "operation", event.target.value as MetricForm["operation"])} disabled={disabled}><option value="sum">Sum</option><option value="count">Count</option><option value="avg">Average</option><option value="min">Minimum</option><option value="max">Maximum</option></select><input value={metric.alias} onChange={(event) => updateMetric(index, "alias", event.target.value)} placeholder="Nama hasil" disabled={disabled} />{form.metrics.length > 1 && <button className="icon-ghost" type="button" onClick={() => setForm((current) => ({ ...current, metrics: current.metrics.filter((_, metricIndex) => metricIndex !== index) }))} disabled={disabled} title="Hapus metric" aria-label="Hapus metric"><X size={15} /></button>}</div>)}
            </div>

            <div className="investigation-form-grid"><label>Jenis hasil<select value={form.result_type} onChange={(event) => updateField("result_type", event.target.value as DefinitionForm["result_type"])} disabled={disabled}><option value="unmatched_and_amount_difference">Baris tidak cocok dan selisih nominal</option><option value="summary_difference">Selisih summary</option><option value="relation_lookup">Lookup relasi</option><option value="custom">Custom</option></select></label><label>Knowledge terkait<small>Pakai article ID, pisahkan dengan koma.</small><input value={form.linked_knowledge_ids} onChange={(event) => updateField("linked_knowledge_ids", event.target.value)} placeholder="INV-KB-..." disabled={disabled} /></label></div>

            <details className="investigation-advanced-config"><summary>Konfigurasi lanjutan: pipeline read-only</summary><p className="article-helper-note">Hanya untuk Admin yang memahami aggregation MongoDB. Tidak boleh berisi update, delete, insert, `$out`, atau `$merge`.</p><div className="investigation-form-grid"><label>Collection sumber<input value={form.execution_source_collection} onChange={(event) => updateField("execution_source_collection", event.target.value)} placeholder="Default: collection pertama" disabled={disabled} /></label><label>Batas hasil<input type="number" min="1" max="500" value={form.execution_max_rows} onChange={(event) => updateField("execution_max_rows", event.target.value)} disabled={disabled} /></label><label className="investigation-form-wide">Pipeline JSON<textarea className="investigation-definition-json" value={form.pipeline_json} onChange={(event) => updateField("pipeline_json", event.target.value)} placeholder={'[\n  { "$match": { "kode_toko": "{{kode_toko}}" } }\n]'} disabled={disabled} spellCheck={false} /></label></div></details>

            {user?.role === "admin" && <div className="article-actions"><button className="button secondary" type="button" onClick={save} disabled={saving}><Save size={15} /> {saving ? "Menyimpan..." : "Simpan Draft"}</button>{selected && selected.status !== "published" && <button className="button primary" type="button" onClick={publish} disabled={saving}><Upload size={15} /> Publish</button>}{selected && selected.status !== "archived" && <button className="button secondary" type="button" onClick={archive} disabled={saving}><Archive size={15} /> Archive</button>}</div>}
          </section>
        </div>
      </section>
    </HelpdeskLayout>
  );
}
