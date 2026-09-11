import { useEffect, useState } from "react";
import { Camera, Headphones, MessageCircleQuestion } from "lucide-react";
import { ChatWindow } from "../../components/chat/ChatWindow";
import { ProfileGate } from "../../components/customer/ProfileGate";
import { CustomerLayout } from "../../layouts/CustomerLayout";
import { type CustomerProfile, createNewSessionId, getCustomerId, getSessionId, loadCustomerProfile } from "../../lib/session";
import { api } from "../../services/api";
import type { Ticket } from "../../types";

export function CustomerChatPage() {
  const [sessionId, setSessionId] = useState(getSessionId);
  const [customerId] = useState(getCustomerId);
  const [profile, setProfile] = useState<CustomerProfile | null>(() => loadCustomerProfile());
  const [showProfileGate, setShowProfileGate] = useState(() => !profile);
  const [ticket, setTicket] = useState<Ticket | null>(null);

  async function refreshTicket() {
    const row = await api.ticketBySession(sessionId);
    setTicket(row);
  }

  useEffect(() => {
    refreshTicket().catch(() => undefined);
  }, [sessionId]);

  useEffect(() => {
    const stream = new EventSource(api.eventsUrl());
    const refreshForCurrentSession = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data || "{}") as {
          session_id?: string;
          ticket?: Partial<Ticket>;
        };
        const eventSessionId = payload.session_id || payload.ticket?.session_id;
        if (eventSessionId === sessionId) refreshTicket().catch(() => undefined);
      } catch {
        // Abaikan event realtime yang tidak berisi payload ticket valid.
      }
    };
    ["new_ticket", "new_message", "ticket_updated", "handover_started", "handover_resolved"].forEach((eventName) => {
      stream.addEventListener(eventName, refreshForCurrentSession);
    });
    return () => stream.close();
  }, [sessionId]);

  function startNewSession() {
    setSessionId(createNewSessionId());
    setTicket(null);
  }

  return (
    <CustomerLayout>
      {!profile || showProfileGate ? (
        <ProfileGate
          initial={profile}
          onSave={(nextProfile) => {
            setProfile(nextProfile);
            setShowProfileGate(false);
          }}
        />
      ) : (
        <section className="customer-chat-stage">
          <aside className="customer-support-panel" aria-label="Informasi bantuan NAVA">
            <div className="support-brand">
              <div className="support-mark">N</div>
              <div>
                <strong>NAVA Helpdesk</strong>
                <span>Asisten bantuan toko</span>
              </div>
            </div>
            <h1>Asisten operasional toko</h1>
            <p>Ceritakan kendalanya dengan singkat. NAVA akan memberi langkah awal, lalu meneruskan ke petugas manusia bila dibutuhkan.</p>
            <div className="support-profile-card">
              <span>Ruang Aktif</span>
              <strong>{profile.name}</strong>
              <small>{profile.domain}</small>
              <small>{sessionId}</small>
            </div>
            <div className="support-scope-list">
              <div>
                <MessageCircleQuestion size={17} />
                <span><strong>Tulis kendala utama</strong><small>Contoh: tidak bisa login atau struk tidak keluar</small></span>
              </div>
              <div>
                <Camera size={17} />
                <span><strong>Lampirkan screenshot</strong><small>Gambar membantu petugas memahami kondisi layar</small></span>
              </div>
              <div>
                <Headphones size={17} />
                <span><strong>Bisa diteruskan ke petugas</strong><small>Percakapan tetap memakai session yang sama</small></span>
              </div>
            </div>
          </aside>
          <ChatWindow
            mode="customer"
            sessionId={sessionId}
            customerId={customerId}
            customerName={profile.name}
            customerDomain={profile.domain}
            ticket={ticket}
            onSent={refreshTicket}
            onEditProfile={() => setShowProfileGate(true)}
            onNewSession={startNewSession}
          />
        </section>
      )}
    </CustomerLayout>
  );
}
