import { useEffect, useState } from "react";
import { CustomerChatPage } from "./pages/customer/ChatPage";
import { ChatRoomPage } from "./pages/helpdesk/ChatRoomPage";
import { DashboardPage } from "./pages/helpdesk/DashboardPage";
import { HandoverPage } from "./pages/helpdesk/HandoverPage";
import { ArticlePage } from "./pages/helpdesk/ArticlePage";
import { LoginPage } from "./pages/helpdesk/LoginPage";
import { TicketPage } from "./pages/helpdesk/TicketPage";

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const updatePath = () => setPath(window.location.pathname);
    window.addEventListener("popstate", updatePath);
    window.addEventListener("nava:navigate", updatePath);
    return () => {
      window.removeEventListener("popstate", updatePath);
      window.removeEventListener("nava:navigate", updatePath);
    };
  }, []);

  if (path === "/helpdesk/login") return <LoginPage />;
  if (path === "/helpdesk" || path === "/helpdesk/") return <ChatRoomPage />;
  if (path === "/helpdesk/dashboard") return <DashboardPage />;
  if (path === "/helpdesk/articles") return <ArticlePage />;
  if (path === "/helpdesk/tickets") return <TicketPage />;
  if (path === "/helpdesk/handover") return <HandoverPage />;
  if (path === "/helpdesk/chat") return <ChatRoomPage />;
  if (path.startsWith("/helpdesk/chat/")) {
    return <ChatRoomPage sessionId={decodeURIComponent(path.replace("/helpdesk/chat/", ""))} />;
  }

  return <CustomerChatPage />;
}
