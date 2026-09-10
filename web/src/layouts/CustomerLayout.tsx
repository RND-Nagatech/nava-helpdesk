import type { ReactNode } from "react";
import { Circle, MessageSquare } from "lucide-react";

export function CustomerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ops-frame customer-frame">
      <header className="ops-topbar customer-topbar">
        <a className="ops-brand" href="/">
          <div className="brand-mark">N</div>
          <div>
            <strong>NAVA Helpdesk</strong>
            <span>Sistem Dukungan & Operasional</span>
          </div>
        </a>
        <nav className="ops-nav customer-nav" aria-label="Navigasi customer">
          <a className="active" href="/">
            <MessageSquare size={15} />
            Chat Room
          </a>
        </nav>
        <div className="ops-userbar">
          <span className="online-chip"><Circle size={9} fill="currentColor" /> Online</span>
        </div>
      </header>
      {children}
    </div>
  );
}
