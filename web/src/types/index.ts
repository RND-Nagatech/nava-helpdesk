export type MessageRole = "user" | "assistant" | "helpdesk";

export type Attachment = {
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  url: string;
};

export type ChatMessage = {
  _id?: string;
  session_id: string;
  customer_id?: string | null;
  role: MessageRole;
  content: string;
  metadata?: {
    attachments?: Attachment[];
    helpdesk_name?: string;
    [key: string]: unknown;
  };
  created_at: string;
};

export type TicketStatus = "new" | "pending" | "in_progress" | "resolved";
export type HandoverStatus = "pending" | "active" | "resolved";
export type Priority = "low" | "normal" | "high" | "urgent";

export type Ticket = {
  _id: string;
  ticket_code: string;
  session_id: string;
  customer_id?: string | null;
  customer_name: string;
  customer_domain?: string | null;
  subject: string;
  reason: string;
  source: "customer_button" | "agent_escalation";
  priority: Priority;
  status: TicketStatus;
  handover_status: HandoverStatus;
  assigned_helpdesk_id?: string | null;
  assigned_helpdesk_name?: string | null;
  created_at: string;
  first_response_at?: string | null;
  resolved_at?: string | null;
  last_message_at?: string;
  last_message?: string;
};

export type DashboardPeriod = {
  start_date: string;
  end_date: string;
  timezone: string;
};

export type DashboardTimelineItem = {
  date: string;
  conversations: number;
  nava_responses: number;
  tickets: number;
  resolved: number;
};

export type HelpdeskPerformance = {
  helpdesk_id: string;
  name: string;
  tickets_handled: number;
  tickets_resolved: number;
  avg_response_ms: number;
  avg_response_minutes: number;
  avg_resolution_ms: number;
  avg_resolution_minutes: number;
};

export type DashboardSummary = {
  period: DashboardPeriod;
  agent: {
    total_conversations: number;
    total_responses: number;
    knowledge_usage_count: number;
    knowledge_usage_rate: number;
    escalation_count: number;
    escalation_rate: number;
    avg_latency_ms: number;
    avg_model_calls: number;
    avg_tool_calls: number;
    recursion_fallback_count: number;
  };
  helpdesk: {
    total_tickets: number;
    new_tickets: number;
    waiting_handover: number;
    in_progress: number;
    resolved: number;
    avg_first_response_ms: number;
    avg_first_response_minutes: number;
    avg_resolution_ms: number;
    avg_resolution_minutes: number;
    total_helpdesk_messages: number;
    performance_by_helpdesk: HelpdeskPerformance[];
  };
  timeline: DashboardTimelineItem[];
};

export type HelpdeskUser = {
  helpdesk_id: string;
  name: string;
  role: "admin" | "helpdesk";
  tier: string;
  is_active: boolean;
};

export type KnowledgeArticleStatus = "draft" | "published" | "archived";

export type KnowledgeStep = {
  order: number;
  title?: string;
  instruction: string;
  expectedResult?: string;
};

export type KnowledgeArticle = {
  _id?: string;
  articleId: string;
  title: string;
  category: string;
  product: string;
  clientScope?: string[];
  symptoms: string[];
  tags: string[];
  userResponseTemplate: string;
  troubleshootingSteps: KnowledgeStep[];
  escalationRules: string[];
  internalNotes?: string;
  status: KnowledgeArticleStatus;
  embedding_status: "ready" | "stale";
  created_at?: string;
  updated_at?: string;
};
