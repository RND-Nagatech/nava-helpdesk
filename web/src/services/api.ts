import { getHelpdeskToken } from "../lib/helpdeskAuth";
import type { Attachment, ChatMessage, DashboardSummary, HelpdeskUser, KnowledgeArticle, Ticket } from "../types";

const API_URL = import.meta.env.VITE_API_URL as string;
const REQUEST_TIMEOUT_MS = 15000;

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
  code?: string;
  pagination?: Pagination;
};

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
};

export type ChatHistoryPage = {
  items: ChatMessage[];
  has_more: boolean;
  next_cursor: string | null;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function friendlyApiMessage(payload: ApiResponse<unknown> | null, status: number) {
  if (payload?.message && payload.message !== "Request tidak valid.") return payload.message;
  if (status === 400) return "Data yang diisi belum lengkap atau formatnya belum sesuai.";
  if (status === 401) return "Session sudah berakhir. Silakan login kembali.";
  if (status === 403) return "Anda tidak memiliki izin untuk melakukan tindakan ini.";
  if (status === 404) return "Data atau halaman yang diminta tidak ditemukan.";
  if (status === 409) return "Data tersebut sudah digunakan. Silakan gunakan data lain.";
  if (status >= 500) return "Terjadi kendala pada server. Silakan coba lagi beberapa saat.";
  return "Permintaan belum dapat diproses. Silakan coba lagi.";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const payload = await requestPayload<T>(path, init);
  return payload.data;
}

async function requestPayload<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
  const token = getHelpdeskToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request terlalu lama. Coba ulangi beberapa saat lagi.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok || !payload?.success) {
    throw new ApiError(friendlyApiMessage(payload as ApiResponse<unknown> | null, response.status), response.status);
  }
  return payload;
}

async function requestBlob(path: string): Promise<Blob> {
  const token = getHelpdeskToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) throw new ApiError(`Request gagal (${response.status})`, response.status);
    return response.blob();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request terlalu lama. Coba ulangi beberapa saat lagi.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  baseUrl: API_URL,
  imageUrl(path: string) {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    return `${API_URL}${path}`;
  },
  helpdeskLogin(input: { helpdesk_id: string; password: string }) {
    return request<{ token: string; user: HelpdeskUser }>("/api/auth/helpdesk/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  helpdeskMe() {
    return request<HelpdeskUser>("/api/auth/helpdesk/me");
  },
  helpdeskLogout() {
    return request<{ logged_out: boolean }>("/api/auth/helpdesk/logout", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  handoverCount() {
    return request<{ count: number }>("/api/helpdesk/handover/count");
  },
  helpdeskUsers(search = "") {
    const suffix = search ? `?search=${encodeURIComponent(search)}` : "";
    return request<HelpdeskUser[]>(`/api/helpdesk/users${suffix}`);
  },
  createHelpdeskUser(input: { helpdesk_id: string; name: string; password: string; role: "admin" | "helpdesk"; tier?: string; is_active?: boolean }) {
    return request<HelpdeskUser>("/api/helpdesk/users", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateHelpdeskUser(helpdeskId: string, input: Partial<{ helpdesk_id: string; name: string; password: string; role: "admin" | "helpdesk"; tier: string; is_active: boolean }>) {
    return request<HelpdeskUser>(`/api/helpdesk/users/${encodeURIComponent(helpdeskId)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  setHelpdeskUserActive(helpdeskId: string, is_active: boolean) {
    return request<HelpdeskUser>(`/api/helpdesk/users/${encodeURIComponent(helpdeskId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ is_active }),
    });
  },
  deleteHelpdeskUser(helpdeskId: string) {
    return request<{ deleted: boolean }>(`/api/helpdesk/users/${encodeURIComponent(helpdeskId)}`, {
      method: "DELETE",
    });
  },
  imageFallbackUrl(path: string) {
    if (!path || path.startsWith("http")) return "";
    if (path.startsWith("/uploads/")) return `${API_URL}/api${path}`;
    return "";
  },
  eventsUrl() {
    return `${API_URL}/api/events`;
  },
  chat(input: {
    question: string;
    session_id: string;
    customer_id: string;
    customer_name?: string;
    customer_domain?: string;
    attachments?: Attachment[];
  }) {
    return request<{
      session_id: string;
      customer_id: string;
      answer: string;
      handover_active?: boolean;
      ticket?: Partial<Ticket>;
    }>("/api/chat", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  history(sessionId: string, limit = 50, before = "") {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set("before", before);
    return request<ChatHistoryPage>(`/api/chat/${encodeURIComponent(sessionId)}/messages?${params}`);
  },
  upload(files: File[]) {
    const form = new FormData();
    files.forEach((file) => form.append("images", file));
    return fetch(`${API_URL}/api/uploads/helpdesk`, {
      method: "POST",
      body: form,
    })
      .then(async (response) => {
        const payload = (await response.json()) as ApiResponse<Attachment[]>;
        if (!response.ok || !payload.success) throw new Error(payload.message || "Upload gambar gagal.");
        return payload.data;
      });
  },
  createTicket(input: {
    session_id: string;
    customer_id: string;
    customer_name?: string;
    customer_domain?: string;
    subject?: string;
    reason?: string;
    source?: "customer_button" | "agent_escalation";
    priority?: string;
  }) {
    return request<{ ticket: Ticket; created: boolean }>("/api/tickets", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  tickets(params: Record<string, string> = {}) {
    const search = new URLSearchParams(params);
    const suffix = search.toString() ? `?${search}` : "";
    return request<Ticket[]>(`/api/tickets${suffix}`);
  },
  async ticketsPage(params: Record<string, string> = {}) {
    const search = new URLSearchParams(params);
    const suffix = search.toString() ? `?${search}` : "";
    const payload = await requestPayload<Ticket[]>(`/api/tickets${suffix}`);
    return {
      data: payload.data,
      pagination: payload.pagination || { page: 1, limit: payload.data.length || 20, total: payload.data.length, total_pages: 1 },
    };
  },
  ticketAssignees(params: Record<string, string> = {}) {
    const search = new URLSearchParams(params);
    const suffix = search.toString() ? `?${search}` : "";
    return request<Array<{ helpdesk_id: string; name: string }>>(`/api/tickets/assignees${suffix}`);
  },
  ticketExportCsv(params: Record<string, string> = {}) {
    const search = new URLSearchParams(params);
    const suffix = search.toString() ? `?${search}` : "";
    return requestBlob(`/api/tickets/export.csv${suffix}`);
  },
  ticketBySession(sessionId: string) {
    return request<Ticket | null>(`/api/tickets/session/${encodeURIComponent(sessionId)}`);
  },
  async ticket(ticketId: string) {
    const detail = await request<{ ticket: Ticket; messages: ChatMessage[] }>(`/api/tickets/${encodeURIComponent(ticketId)}?messages=false`);
    return detail.ticket;
  },
  acceptTicket(ticketId: string) {
    return request<Ticket>(`/api/tickets/${encodeURIComponent(ticketId)}/accept`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  resolveTicket(ticketId: string) {
    return request<Ticket>(`/api/tickets/${encodeURIComponent(ticketId)}/resolve`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  helpdeskReply(input: {
    session_id: string;
    customer_id?: string | null;
    message: string;
    attachments?: Attachment[];
  }) {
    return request<ChatMessage>("/api/helpdesk/reply", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  dashboard(params: Record<string, string> = {}) {
    const search = new URLSearchParams(params);
    const suffix = search.toString() ? `?${search}` : "";
    return request<DashboardSummary>(`/api/dashboard/summary${suffix}`);
  },
  knowledgeArticles(params: Record<string, string> = {}) {
    const search = new URLSearchParams(params);
    const suffix = search.toString() ? `?${search}` : "";
    return request<KnowledgeArticle[]>(`/api/knowledge/articles${suffix}`);
  },
  knowledgeCategories() {
    return request<string[]>("/api/knowledge/categories");
  },
  knowledgeArticle(articleId: string) {
    return request<KnowledgeArticle>(`/api/knowledge/articles/${encodeURIComponent(articleId)}`);
  },
  createKnowledgeArticle(input: Partial<KnowledgeArticle>) {
    return request<KnowledgeArticle>("/api/knowledge/articles", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateKnowledgeArticle(articleId: string, input: Partial<KnowledgeArticle>, options: { asDraft?: boolean } = {}) {
    const suffix = options.asDraft ? "?as_draft=true" : "";
    return request<KnowledgeArticle>(`/api/knowledge/articles/${encodeURIComponent(articleId)}${suffix}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  publishKnowledgeArticle(articleId: string) {
    return request<KnowledgeArticle>(`/api/knowledge/articles/${encodeURIComponent(articleId)}/publish`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  archiveKnowledgeArticle(articleId: string) {
    return request<KnowledgeArticle>(`/api/knowledge/articles/${encodeURIComponent(articleId)}/archive`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
};
