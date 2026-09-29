import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Database, Pencil, Plus, Save, X } from "lucide-react";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { getStoredHelpdeskUser } from "../../lib/helpdeskAuth";
import { handleHelpdeskNavigation } from "../../lib/navigation";
import { api } from "../../services/api";
import type { InvestigationTarget } from "../../types";

const initialForm = {
  domain: "",
  connection_profile: "",
  database_name: "",
  display_name: "",
  status: "active" as "active" | "disabled",
};

function normalizeDomainInput(value: string) {
  const domain = value.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(domain)
    ? `${domain}.goldstore.id`
    : domain;
}

export function InvestigationTargetsPage() {
  const [targets, setTargets] = useState<InvestigationTarget[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<InvestigationTarget | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const user = getStoredHelpdeskUser();

  async function load() {
    try {
      setLoading(true);
      setError("");
      setTargets(await api.investigationTargets());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat target database.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(initialForm);
    setFormOpen(true);
    setError("");
    setNotice("");
  }

  function editTarget(target: InvestigationTarget) {
    setEditing(target);
    setForm({
      domain: target.domain,
      connection_profile: target.connection_profile,
      database_name: target.database_name,
      display_name: target.display_name,
      status: target.status,
    });
    setFormOpen(true);
    setError("");
    setNotice("");
  }

  function closeForm() {
    setEditing(null);
    setForm(initialForm);
    setFormOpen(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      const normalizedDomain = normalizeDomainInput(form.domain);
      const saved = await api.saveInvestigationTarget({
        domain: normalizedDomain,
        connection_profile: form.connection_profile || undefined,
        database_name: form.database_name || undefined,
        display_name: form.display_name || undefined,
        status: form.status,
      });
      setTargets((current) => {
        const withoutCurrent = current.filter((item) => item.domain !== saved.domain);
        return [...withoutCurrent, saved].sort((a, b) => a.domain.localeCompare(b.domain));
      });
      closeForm();
      setNotice("Target database berhasil disimpan.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan target database.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <HelpdeskLayout>
      <section className="investigation-target-page">
        <div className="article-head">
          <div>
            <span className="eyebrow"><Database size={14} /> Internal Configuration</span>
            <h1>Target Database Investigasi</h1>
            <p>Mapping domain Goldstore ke VM dan database NAGAGOLD. Secret koneksi tetap berada di backend.</p>
          </div>
          <div className="article-head-actions">
            <a className="button secondary investigation-back-button" href="/helpdesk/investigation" onClick={handleHelpdeskNavigation}><ArrowLeft size={15} /> Kembali ke Investigasi</a>
            {user?.role === "admin" && <button className="button primary" type="button" onClick={openCreate}><Plus size={15} /> Target Baru</button>}
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
        {notice && <div className="success-box">{notice}</div>}

        {user?.role !== "admin" && (
          <div className="training-warning">Hanya Admin yang dapat menambah atau mengubah target database.</div>
        )}

        <section className="panel-card investigation-target-list investigation-target-list-full">
            <div className="training-panel-head">
              <div>
                <span className="eyebrow"><Database size={14} /> Configured Targets</span>
                <h2>Daftar Target</h2>
              </div>
              <small>{targets.length} target</small>
            </div>
            {loading && <div className="empty-state">Memuat target...</div>}
            {!loading && !targets.length && <div className="empty-state">Belum ada target database.</div>}
            {!loading && targets.map((target) => (
              <article className="investigation-target-item" key={target.domain}>
                <div>
                  <strong>{target.display_name}</strong>
                  <span>{target.domain}</span>
                  <small>Profil: {target.connection_profile} · DB: {target.database_name}</small>
                </div>
                <div className="investigation-target-item-actions">
                  <span className={"training-status " + (target.status === "active" ? "active" : "closed")}>{target.status}</span>
                  {user?.role === "admin" && <button className="icon-ghost" type="button" title="Edit target" aria-label="Edit target" onClick={() => editTarget(target)}><Pencil size={15} /></button>}
                </div>
              </article>
            ))}
        </section>
      </section>

      {formOpen && (
        <div className="confirm-backdrop" role="presentation" onMouseDown={closeForm}>
          <form className="user-form-dialog investigation-target-dialog" role="dialog" aria-modal="true" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-heading">
              <div>
                <span className="eyebrow"><Database size={14} /> Target Mapping</span>
                <h2>{editing ? "Edit Target DB" : "Tambah Target DB"}</h2>
              </div>
              <button className="icon-ghost" type="button" onClick={closeForm} aria-label="Tutup"><X size={17} /></button>
            </div>
            <div className="user-form-grid">
              <label>Domain toko
                <input value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} placeholder="italy atau italy.goldstore.id" disabled={saving || Boolean(editing)} required />
              </label>
              <label>Profil koneksi / VM
                <input value={form.connection_profile} onChange={(event) => setForm({ ...form, connection_profile: event.target.value })} placeholder="Contoh: vm1 atau qc" disabled={saving} required />
              </label>
              <label>Nama database tenant
                <input value={form.database_name} onChange={(event) => setForm({ ...form, database_name: event.target.value })} placeholder="Nama database dari konfigurasi NAGAGOLD" disabled={saving} />
              </label>
              <label>Nama tampilan
                <input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} placeholder="Italy Pusat" disabled={saving} />
              </label>
              <label>Status
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "disabled" })} disabled={saving}>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
            </div>
            <p className="article-helper-note">Domain boleh ditulis singkat, misalnya <strong>italy</strong>; saat disimpan akan dinormalisasi menjadi <strong>italy.goldstore.id</strong>. Isi profil koneksi yang dikonfigurasi Admin, misalnya <strong>vm1</strong> atau <strong>qc</strong>. Connection string tidak diinput di sini.</p>
            {error && <div className="error-box user-dialog-error" role="alert">{error}</div>}
            <div className="confirm-actions">
              <button className="button secondary" type="button" onClick={closeForm}>Batal</button>
              <button className="button primary" type="submit" disabled={saving}>{saving ? "Menyimpan..." : <><Save size={15} /> Simpan Target</>}</button>
            </div>
          </form>
        </div>
      )}
    </HelpdeskLayout>
  );
}
