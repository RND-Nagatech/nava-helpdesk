import { useEffect, useState, type ReactNode } from "react";
import { Bell, BookOpenText, Circle, LayoutDashboard, LogOut, MessageSquare, Ticket, UserRound } from "lucide-react";
import { clearHelpdeskSession, getHelpdeskToken, getStoredHelpdeskUser } from "../lib/helpdeskAuth";
import { handleHelpdeskNavigation } from "../lib/navigation";
import { ApiError, api } from "../services/api";
import type { HelpdeskUser } from "../types";

const menu = [
  { href: "/helpdesk/chat", label: "Chat Aktif", icon: MessageSquare },
  { href: "/helpdesk/handover", label: "Handover", icon: Ticket },
  { href: "/helpdesk/tickets", label: "Daftar Tiket", icon: Ticket },
  { href: "/helpdesk/articles", label: "Artikel", icon: BookOpenText },
  { href: "/helpdesk/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

export function HelpdeskLayout({ children }: { children: ReactNode }) {
  const path = window.location.pathname;
  const [user, setUser] = useState<HelpdeskUser | null>(() => getStoredHelpdeskUser());
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [newTicketCount, setNewTicketCount] = useState(0);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = getHelpdeskToken();
    if (!token) {
      const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
      window.location.replace(`/helpdesk/login?next=${next}`);
      return;
    }

    api.helpdeskMe()
      .then((currentUser) => {
        if (!cancelled) {
          setUser(currentUser);
          setAuthError("");
        }
      })
      .catch((error) => {
        if (!cancelled && error instanceof ApiError && error.status === 401) {
          clearHelpdeskSession();
          const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
          window.location.replace(`/helpdesk/login?next=${next}`);
        }
        if (!cancelled && (!(error instanceof ApiError) || error.status !== 401)) {
          setAuthError(error instanceof Error ? error.message : "Session helpdesk belum dapat diverifikasi.");
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const token = getHelpdeskToken();
    if (!token) return undefined;
    const stream = new EventSource(api.eventsUrl());
    stream.addEventListener("new_ticket", () => setNewTicketCount((current) => current + 1));
    return () => stream.close();
  }, []);

  async function logout() {
    await api.helpdeskLogout().catch(() => undefined);
    clearHelpdeskSession();
    window.location.href = "/helpdesk/login";
  }

  if (checking && !user) {
    return (
      <div className="ops-frame">
        <main className="ops-main auth-loading">Memeriksa session helpdesk...</main>
      </div>
    );
  }

  return (
    <div className="ops-frame">
      <header className="ops-topbar">
          <a className="ops-brand" href="/helpdesk/chat" onClick={handleHelpdeskNavigation}>
          <div className="brand-mark">N</div>
          <div>
            <strong>NAVA Helpdesk</strong>
            <span>Sistem Dukungan & Operasional</span>
          </div>
        </a>
        <nav className="ops-nav" aria-label="Navigasi helpdesk">
          {menu.map((item) => {
            const Icon = item.icon;
            const active = path === item.href || path.startsWith(`${item.href}/`);
            return (
              <a className={active ? "active" : ""} href={item.href} key={item.href} onClick={handleHelpdeskNavigation}>
                <Icon size={15} />
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="ops-userbar">
          <span className="online-chip"><Circle size={9} fill="currentColor" /> Online</span>
          <button
            className={`notification-button ${newTicketCount ? "has-notification" : ""}`}
            type="button"
            title={newTicketCount ? `${newTicketCount} ticket baru` : "Belum ada ticket baru"}
            onClick={() => {
              setNewTicketCount(0);
              if (!path.startsWith("/helpdesk/handover")) window.location.href = "/helpdesk/handover";
            }}
          >
            <Bell size={18} />
            {newTicketCount > 0 && <span>{newTicketCount > 9 ? "9+" : newTicketCount}</span>}
          </button>
          <div className="operator-name">
            <strong>{user?.name || "Helpdesk"}</strong>
            <span>{user?.tier || "Helpdesk"}</span>
          </div>
          <div className="user-avatar"><UserRound size={18} /></div>
          <button className="logout-button" type="button" onClick={() => setConfirmLogout(true)} title="Logout">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main className="ops-main">{children}</main>
      {authError && <div className="error-box auth-error">{authError} Coba refresh halaman setelah API kembali normal.</div>}
      {confirmLogout && (
        <div className="confirm-backdrop" role="presentation" onMouseDown={() => setConfirmLogout(false)}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="confirm-icon">
              <LogOut size={22} />
            </div>
            <h2 id="logout-title">Logout dari portal?</h2>
            <p>Session helpdesk di browser ini akan dihapus dan Anda perlu login lagi untuk membuka portal.</p>
            <div className="confirm-actions">
              <button className="button secondary" type="button" onClick={() => setConfirmLogout(false)}>Batal</button>
              <button className="button primary" type="button" onClick={logout}>Ya, Logout</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
