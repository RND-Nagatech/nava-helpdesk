import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, Search, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { HelpdeskLayout } from "../../layouts/HelpdeskLayout";
import { api } from "../../services/api";
import type { HelpdeskUser } from "../../types";

type UserForm = {
  helpdesk_id: string;
  name: string;
  password: string;
  role: "admin" | "helpdesk";
  tier: string;
  is_active: boolean;
};

const emptyForm: UserForm = {
  helpdesk_id: "",
  name: "",
  password: "",
  role: "helpdesk",
  tier: "Tier 1 Helpdesk",
  is_active: true,
};

export function UsersPage() {
  const [users, setUsers] = useState<HelpdeskUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<HelpdeskUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<HelpdeskUser | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<UserForm>(emptyForm);

  async function load(nextSearch = search) {
    try {
      setLoading(true);
      setError("");
      setUsers(await api.helpdeskUsers(nextSearch));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat user helpdesk.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
    setError("");
    setNotice("");
  }

  function openEdit(user: HelpdeskUser) {
    setEditing(user);
    setFormOpen(true);
    setForm({
      helpdesk_id: user.helpdesk_id,
      name: user.name,
      password: "",
      role: user.role,
      tier: user.tier,
      is_active: user.is_active,
    });
    setError("");
    setNotice("");
  }

  function closeForm() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.password && !editing) {
      setError("Password wajib diisi.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      setNotice("");
      if (editing) {
        const { password, ...rest } = form;
        await api.updateHelpdeskUser(editing.helpdesk_id, password ? { ...rest, password } : rest);
        setNotice("User helpdesk berhasil diperbarui.");
      } else {
        await api.createHelpdeskUser(form);
        setNotice("User helpdesk berhasil ditambahkan.");
      }
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan user helpdesk.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(user: HelpdeskUser) {
    try {
      setError("");
      await api.setHelpdeskUserActive(user.helpdesk_id, !user.is_active);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah status user.");
    }
  }

  async function remove(user: HelpdeskUser) {
    setError("");
    setConfirmDelete(user);
  }

  async function confirmRemove() {
    if (!confirmDelete) return;
    try {
      setError("");
      await api.deleteHelpdeskUser(confirmDelete.helpdesk_id);
      setConfirmDelete(null);
      setNotice("User helpdesk berhasil dihapus.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus user.");
    }
  }

  return (
    <HelpdeskLayout>
      <section className="queue-hero compact">
        <div>
          <span className="eyebrow"><ShieldCheck size={14} /> Administrasi</span>
          <h1>Users</h1>
          <p>Kelola akun petugas Helpdesk yang digunakan untuk masuk ke portal.</p>
        </div>
        <button className="button primary" type="button" onClick={openCreate}><Plus size={16} /> Tambah User</button>
      </section>

      <section className="ticket-board ticket-board-list">
        <div className="filters ticket-filters users-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") load(); }} placeholder="Cari Helpdesk ID, nama, role..." />
          </label>
          <button className="button secondary" type="button" onClick={() => load()}>Cari</button>
        </div>
      </section>

      {error && <div className="error-box">{error}</div>}
      {notice && <div className="notice-box">{notice}</div>}
      {loading ? <div className="empty-state">Memuat user...</div> : (
        <div className="table-wrap">
          <table className="data-table users-table">
            <thead><tr><th>Helpdesk ID</th><th>Nama</th><th>Role</th><th>Tier</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.helpdesk_id}>
                  <td><strong>{user.helpdesk_id}</strong></td>
                  <td><span className="user-name-cell"><UserRound size={15} /> {user.name}</span></td>
                  <td><span className="tag-chip">{user.role}</span></td>
                  <td>{user.tier || "-"}</td>
                  <td><span className={`status-pill ${user.is_active ? "status-active" : "status-inactive"}`}>{user.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  <td className="mono-cell">{user.created_at ? new Date(user.created_at).toLocaleString("id-ID") : "-"}</td>
                  <td><div className="row-actions"><button type="button" onClick={() => openEdit(user)}><Pencil size={14} /> Edit</button><button type="button" onClick={() => toggle(user)}>{user.is_active ? "Nonaktifkan" : "Aktifkan"}</button><button className="danger-action" type="button" onClick={() => remove(user)}><Trash2 size={14} /></button></div></td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={7}>Belum ada user helpdesk.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <div className="confirm-backdrop" role="presentation" onMouseDown={closeForm}>
          <form className="user-form-dialog" role="dialog" aria-modal="true" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-heading"><div><span className="eyebrow">{editing ? "Perbarui akun" : "Akun baru"}</span><h2>{editing ? "Edit User" : "Tambah User"}</h2></div><button className="icon-ghost" type="button" onClick={closeForm} aria-label="Tutup">×</button></div>
            <div className="user-form-grid">
              <label>Helpdesk ID<input value={form.helpdesk_id} disabled={Boolean(editing)} onChange={(event) => setForm({ ...form, helpdesk_id: event.target.value })} placeholder="Contoh: HD-02" /></label>
              <label>Nama<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nama petugas" /></label>
              <label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserForm["role"] })}><option value="helpdesk">helpdesk</option><option value="admin">admin</option></select></label>
              <label>Tier<input value={form.tier} onChange={(event) => setForm({ ...form, tier: event.target.value })} placeholder="Tier 1 Helpdesk" /></label>
              <label className="user-password-field">{editing ? "Password baru (opsional)" : "Password"}<input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" autoComplete="new-password" placeholder={editing ? "Kosongkan jika tidak diganti" : "Masukkan password"} /></label>
              <label className="checkbox-field"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Aktif</label>
            </div>
            {error && <div className="error-box user-dialog-error" role="alert">{error}</div>}
            <div className="confirm-actions"><button className="button secondary" type="button" onClick={closeForm}>Batal</button><button className="button primary" type="submit" disabled={saving}>{saving ? "Menyimpan..." : "Simpan"}</button></div>
          </form>
        </div>
      )}
      {confirmDelete && (
        <div className="confirm-backdrop" role="presentation" onMouseDown={() => setConfirmDelete(null)}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-user-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="confirm-icon"><Trash2 size={20} /></div>
            <h2 id="delete-user-title">Hapus user?</h2>
            <p>User <strong>{confirmDelete.name || confirmDelete.helpdesk_id}</strong> akan dihapus dan tidak dapat login lagi.</p>
            {error && <div className="error-box user-dialog-error" role="alert">{error}</div>}
            <div className="confirm-actions"><button className="button secondary" type="button" onClick={() => setConfirmDelete(null)}>Batal</button><button className="button primary danger-button" type="button" onClick={confirmRemove}>Ya, Hapus</button></div>
          </section>
        </div>
      )}
    </HelpdeskLayout>
  );
}
