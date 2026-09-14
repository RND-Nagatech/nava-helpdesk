import { FormEvent, useState } from "react";
import { ArrowRight, Clock3, ShieldCheck, Store, UserRound, Zap } from "lucide-react";
import { type CustomerProfile, isGoldstoreDomain, normalizeCustomerDomain, saveCustomerProfile } from "../../lib/session";

export function ProfileGate({ initial, onSave }: { initial: CustomerProfile | null; onSave: (profile: CustomerProfile) => void }) {
  const [name, setName] = useState(initial?.name || "");
  const [domain, setDomain] = useState(initial?.domain || "");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = { name: name.trim(), domain: normalizeCustomerDomain(domain) };
    if (!next.name || !next.domain) {
      setError("Nama dan domain/nama toko wajib diisi dulu.");
      return;
    }
    if (!isGoldstoreDomain(next.domain)) {
      setError("Masukkan domain Goldstore, misalnya italy atau italy.goldstore.id.");
      return;
    }
    setError("");
    onSave(saveCustomerProfile(next));
  }

  return (
    <section className="profile-gate">
      <div className="profile-steps">
        <span className="active">1. Registrasi Sesi & Identitas</span>
        <span>2. Ruang Chat Aktif</span>
      </div>
      <div className="profile-live-status">
        <span />
        Sistem terhubung ke NAVA & Tim Support Manusia
      </div>
      <div className="profile-copy">
        <span><Zap size={15} /> NAVA Helpdesk</span>
        <h1>Bantuan cepat untuk kendala operasional toko</h1>
        <p>Jelaskan masalahnya. Agent akan mencari SOP, mengecek website dan backend, lalu memberi langkah awal yang aman.</p>
        <div className="profile-benefits">
          <span><ShieldCheck size={16} /> Verifikasi Otomatis Domain</span>
          <span><Clock3 size={16} /> Histori Chat Tersimpan</span>
        </div>
      </div>
      <form className="profile-card" onSubmit={submit}>
        <h2>Data Customer</h2>
        <label>
          Nama customer
          <div className="field-with-icon">
            <UserRound size={17} />
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Contoh: Andi" />
          </div>
        </label>
        <label>
          Domain toko / program
          <small className="profile-field-hint">Masukkan domain toko. Bisa ditulis dengan atau tanpa <code>.goldstore.id</code>.</small>
          <div className="field-with-icon">
            <Store size={17} />
            <input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="Contoh: italy atau italy.goldstore.id" />
          </div>
        </label>
        {error && <p className="public-profile-error">{error}</p>}
        <button className="button primary" type="submit">Mulai Chat <ArrowRight size={17} /></button>
      </form>
    </section>
  );
}
