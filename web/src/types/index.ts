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

export type SiteCheckResult = {
  domain: string;
  origin: string;
  frontend: {
    status: "online" | "offline" | "unauthorized";
    version?: string | null;
    base_version?: string | null;
    branch?: string;
    http_status?: number | null;
    error_code?: string;
  };
  backend: {
    status: "online" | "offline" | "unauthorized";
    version?: string | null;
    base_version?: string | null;
    branch?: string;
    store?: { kode_toko?: string; nama_toko?: string; tgl_system?: string } | null;
    http_status?: number | null;
    error_code?: string;
  };
  compatibility: "match" | "mismatch" | "unknown";
  checked_at: string;
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
  created_at?: string | null;
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
  siteScope?: {
    domain: string;
    frontendVersion?: string | null;
    backendVersion?: string | null;
    frontendBranch?: string;
    backendBranch?: string;
  } | null;
  status: KnowledgeArticleStatus;
  embedding_status: "ready" | "stale";
  created_at?: string;
  updated_at?: string;
  source?: {
    type: string;
    training_id?: string;
    created_by_helpdesk_id?: string;
    created_by_helpdesk_name?: string;
    supersedes_article_id?: string;
  };
};

export type TrainingKnowledgeReference = {
  query?: string;
  evidence_strength?: string;
  primary_article?: {
    article_id: string;
    title: string;
    category?: string;
  } | null;
};

export type TrainingMessage = {
  _id?: string;
  training_id: string;
  role: "helpdesk" | "assistant" | "correction";
  content: string;
  metadata?: {
    knowledge_used?: TrainingKnowledgeReference[];
    corrected_from_helpdesk?: boolean;
    evaluation?: "correct" | "needs_correction";
    [key: string]: unknown;
  };
  created_at: string;
};

export type TrainingSession = {
  training_id: string;
  helpdesk_id: string;
  helpdesk_name: string;
  title: string;
  status: "active" | "closed";
  created_at: string;
  updated_at: string;
  knowledge_draft_id?: string | null;
  customer_domain?: string;
  messages: TrainingMessage[];
};

export type InvestigationMessage = {
  _id?: string;
  training_id: string;
  role: "helpdesk" | "assistant";
  content: string;
  metadata?: {
    domain?: string | null;
    database_checks?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  created_at: string;
};

export type InvestigationSession = {
  training_id: string;
  helpdesk_id: string;
  helpdesk_name: string;
  title: string;
  room_type: "investigation";
  status: "active" | "closed";
  customer_domain?: string;
  created_at: string;
  updated_at: string;
  messages: InvestigationMessage[];
};

export type InvestigationTarget = {
  domain: string;
  tenant_id: string;
  connection_profile: string;
  database_name: string;
  display_name: string;
  status: "active" | "disabled";
  allowed_collection_profile: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type InvestigationDefinition = {
  operation_id: string;
  name: string;
  description: string;
  status: "draft" | "published" | "archived";
  allowed_collections: string[];
  filters: string[];
  group_by: string[];
  metrics: Array<{
    source: string;
    field: string;
    operation: "sum" | "count" | "avg" | "min" | "max";
    alias?: string;
  }>;
  relation?: {
    left_collection: string;
    left_field: string;
    right_collection: string;
    right_field: string;
  } | null;
  result_type: "unmatched_and_amount_difference" | "summary_difference" | "relation_lookup" | "custom";
  execution?: {
    source_collection: string;
    pipeline: Array<Record<string, unknown>>;
    max_rows?: number;
  } | null;
  linked_knowledge_ids: string[];
  executor?: string;
  created_at?: string;
  updated_at?: string;
};

export type InvestigationPlaybook = {
  playbook_id: string;
  name: string;
  description: string;
  status: "draft" | "published" | "archived";
  trigger_examples: string[];
  aggregation_source?: string;
  parameters: Array<{
    key: string;
    label: string;
    type: "text" | "date" | "number" | "boolean";
    required: boolean;
    description: string;
  }>;
  executor_id: string;
  executor_operation_id: string;
  collections: Array<{
    name: string;
    purpose: string;
    fields: string[];
  }>;
  relations: Array<{
    from_collection: string;
    from_field: string;
    to_collection: string;
    to_field: string;
    explanation: string;
  }>;
  steps: Array<{
    order: number;
    title: string;
    instruction: string;
    expected_result: string;
  }>;
  response_template: string;
  safety_notes: string;
  finding_rules: string;
  correction_guidance: string;
  execution: {
    source_collection: string;
    pipeline: Array<Record<string, unknown>>;
    max_rows?: number;
  } | null;
  created_at?: string;
  updated_at?: string;
};

export type InvestigationKnowledge = {
  articleId: string;
  title: string;
  category: string;
  symptoms: string[];
  tags: string[];
  troubleshootingSteps: KnowledgeStep[];
  userResponseTemplate: string;
  internalNotes: string;
  linked_operation_ids: string[];
  status: "draft" | "published" | "archived";
  created_at?: string;
  updated_at?: string;
};

export type TrainingSummary = {
  context: string;
  customer_question: string;
  previous_answer_issue: string;
  helpdesk_corrections: string[];
  confirmed_conclusion: string;
  solution_steps: string[];
  reusable_knowledge: string;
};

export type TrainingDraft = {
  title: string;
  category: string;
  product: string;
  clientScope: string[];
  symptoms: string[];
  troubleshootingSteps: Array<{
    order: number;
    title: string;
    instruction: string;
    expectedResult: string;
  }>;
  userResponseTemplate: string;
  tags: string[];
  internalNotes: string;
  escalationRules: string[];
};

export type TrainingGenerateResult = {
  can_save: boolean;
  training_id: string;
  summary: TrainingSummary;
  missing_confirmation: string[];
  draft: TrainingDraft | null;
  duplicate_candidates: Array<{
    article_id: string;
    title: string;
    category?: string;
    product?: string;
    confidence: number;
    evidence_strength: string;
  }>;
};
