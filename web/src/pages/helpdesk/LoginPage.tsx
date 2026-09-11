import { FormEvent, useState } from "react";
import { Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { getRememberedHelpdeskId, saveHelpdeskSession } from "../../lib/helpdeskAuth";
import { api } from "../../services/api";

export function LoginPage() {
  const [helpdeskId, setHelpdeskId] = useState(() => getRememberedHelpdeskId());
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(() => Boolean(getRememberedHelpdeskId()));
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setLoading(true);
      setError("");
      const session = await api.helpdeskLogin({ helpdesk_id: helpdeskId, password });
      saveHelpdeskSession(session.token, session.user, remember);
      const next = new URLSearchParams(window.location.search).get("next") || "/helpdesk/chat";
      window.location.href = next.startsWith("/helpdesk") && next !== "/helpdesk/login" ? next : "/helpdesk/chat";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login helpdesk gagal.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="profile-gate helpdesk-login-page">
      <div className="profile-live-status"><span /> Sistem terhubung ke NAVA & Tim Support Manusia</div>
      <div className="profile-copy">
        <span><ShieldCheck size={15} /> NAVA Helpdesk</span>
        <h1>Masuk portal petugas</h1>
        <p>Kelola handover, chat, dan ticket customer memakai akun Helpdesk yang terdaftar.</p>
      </div>
      <form className="profile-card" onSubmit={submit}>
        <h2>Login Helpdesk</h2>
        <label>
          Helpdesk ID
          <div className="field-with-icon">
            <UserRound size={17} />
            <input
              value={helpdeskId}
              onChange={(event) => setHelpdeskId(event.target.value)}
              autoComplete="username"
              placeholder="Masukkan Helpdesk ID"
            />
          </div>
        </label>
        <label>
          Password
          <div className="field-with-icon password-field">
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
          </div>
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
