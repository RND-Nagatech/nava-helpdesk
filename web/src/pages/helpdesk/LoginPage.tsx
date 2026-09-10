import { FormEvent, useState } from "react";
import { Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { getRememberedHelpdeskId, getRememberedHelpdeskPassword, saveHelpdeskSession } from "../../lib/helpdeskAuth";
import { api } from "../../services/api";

export function LoginPage() {
  const [helpdeskId, setHelpdeskId] = useState(() => getRememberedHelpdeskId());
  const [password, setPassword] = useState(() => getRememberedHelpdeskPassword());
  const [remember, setRemember] = useState(() => Boolean(getRememberedHelpdeskId() || getRememberedHelpdeskPassword()));
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setLoading(true);
      setError("");
      const session = await api.helpdeskLogin({ helpdesk_id: helpdeskId, password });
      saveHelpdeskSession(session.token, session.user, remember, password);
      const next = new URLSearchParams(window.location.search).get("next") || "/helpdesk/chat";
      window.location.href = next.startsWith("/helpdesk") && next !== "/helpdesk/login" ? next : "/helpdesk/chat";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login helpdesk gagal.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="helpdesk-login-page">
      <section className="helpdesk-login-hero">
        <div className="brand-mark">N</div>
        <span>NAVA Helpdesk</span>
        <h1>Masuk portal petugas</h1>
        <p>Ticket, handover, dan balasan customer memakai identitas akun yang login.</p>
        <div className="login-note">
          <ShieldCheck size={18} />
          Akses internal tim helpdesk
        </div>
      </section>
      <form className="helpdesk-login-card" onSubmit={submit}>
        <div>
          <span className="eyebrow">Login Helpdesk</span>
          <h2>Verifikasi petugas</h2>
        </div>
        <label>
          Helpdesk ID
          <span className="login-input">
            <UserRound size={17} />
            <input
              value={helpdeskId}
              onChange={(event) => setHelpdeskId(event.target.value)}
              autoComplete="username"
              placeholder="Masukkan Helpdesk ID"
            />
          </span>
        </label>
        <label>
          Password
          <span className="login-input">
            <LockKeyhole size={17} />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Masukkan Password"
              autoFocus
            />
            <button
              className="password-toggle"
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              title={showPassword ? "Sembunyikan password" : "Lihat password"}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
        <label className="remember-check">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          Ingat Saya
        </label>
        {error && <div className="error-box">{error}</div>}
        <button className="button primary login-submit" type="submit" disabled={loading || !helpdeskId.trim() || !password}>
          {loading ? "Masuk..." : "Masuk Portal"}
        </button>
      </form>
    </main>
  );
}
