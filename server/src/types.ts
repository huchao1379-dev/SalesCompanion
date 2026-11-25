export type {
  SourceRef,
  SourceKind,
  ConfidenceKind,
  ReviewSeverity,
  ReviewAction,
  ReviewFinding,
  AgentStepStatus,
  AgentStep,
  AgentRole,
  EnvelopeCore,
} from './shared/envelope.js'
export { ENVELOPE_REQUIRED_KEYS } from './shared/envelope.js'

export type SyncStatus =
  | 'Draft'
  | 'Confirmed'
  | 'Syncing'
  | 'Synced'
  | 'SyncFailed'
  | 'Discarded'

import type {
  SourceRef,
  ConfidenceKind,
  ReviewFinding,
  ReviewAction,
  AgentStep,
} from './shared/envelope.js'

export type ActivityDraft = {
  kind: 'activity'
  id: string
  subject: string
  summary: string
  visitType: string
  accountName: string
  accountRef?: string
  accountId?: string
  contactName: string
  contactId?: string
  occurredAt?: string
  scheduledStart?: string
  scheduledEnd?: string
  followUpAt: string
  transcript: string
  syncStatus: SyncStatus
  confidence: number
  sources: SourceRef[]
  agentName: string
  idempotencyKey: string
  sapExternalId?: string
  syncError?: string
  sessionKey?: string
  promptVersion?: string
  reviewStatus?: 'passed' | 'warn' | 'blocked'
  reviewFindings?: ReviewFinding[]
  pipelineStatus?: 'ok' | 'partial'
  createdAt: string
  updatedAt: string
}

export type OpportunityDraft = {
  kind: 'opportunity'
  id: string
  name: string
  accountName: string
  accountRef?: string
  accountId?: string
  productLine: string
  productModel?: string
  quantity: number
  estimatedValue: number
  currency: string
  stage: string
  closeDate: string
  confidence: number
  reuseExisting: boolean
  existingOpportunityRef?: string
  supervisorHints: string[]
  syncStatus: SyncStatus
  sources: SourceRef[]
  agentName: string
  idempotencyKey: string
  linkedActivityKey?: string
  linkedActivityId?: string
  sapExternalId?: string
  syncError?: string
  isSeed?: boolean
  sessionKey?: string
  reviewStatus?: 'passed' | 'warn' | 'blocked'
  reviewFindings?: ReviewFinding[]
  recommendedAction?: ReviewAction
  confirmedAction?: 'create' | 'link_existing'
  linkedExistingOpportunityId?: string
  pipelineStatus?: 'ok' | 'partial'
  createdAt: string
  updatedAt: string
}

export type DraftPayload = ActivityDraft | OpportunityDraft

export type MessageUiMetricTone = 'good' | 'warn' | 'neutral' | 'accent'

export type MessageUiMetric = {
  label: string
  value: string
  tone?: MessageUiMetricTone
  /** Primary metrics stay large; secondary render as a compact strip. */
  priority?: 'primary' | 'secondary'
}

export type MessageUiItem = {
  title: string
  subtitle?: string
  badge?: string
  kind?: 'opportunity' | 'contact' | 'other'
}

export type MessageUiAction = {
  id: 'open_account' | 'open_opportunity' | 'edit_send_email' | string
  label: string
}

/** Editable email draft for chat UI → Power Automate send. */
export type EmailDraftFields = {
  to: string
  subject: string
  body: string
}

/** Structured blocks for rich chat rendering (not raw JSON dump). */
export type MessageUiBlock = {
  type:
    | 'account_pulse'
    | 'opportunity_list'
    | 'order_status'
    | 'metric_strip'
    | 'clarify'
    | 'work_summary'
    | 'capture_result'
    | 'review'
    | 'general_assist'
  title?: string
  metrics?: MessageUiMetric[]
  items?: MessageUiItem[]
  actions?: MessageUiAction[]
  accountKey?: string
  /** Business data provenance, e.g. "CRM 数据". */
  originLabel?: string
  /** Freshness line, e.g. "数据更新于 2026-11-18（种子演示数据，请核实）". */
  footnote?: string
  /** Explicit AI suggestion — never mix into confirmed facts. */
  hint?: string
  /** Unverified memo/notes — rendered separately from facts. */
  unverifiedNotes?: string
  /** Clarify card: one focused question plus tappable examples. */
  question?: string
  examples?: string[]
  /** Dynamic follow-up chips under any rich answer. */
  followUps?: string[]
  /** Work summary / capture result structured sections. */
  sections?: Array<{
    heading?: string
    bullets: Array<{ text: string; activityId?: string; status?: string }>
  }>
  /** Capture result facts grid. */
  facts?: Array<{ label: string; value: string; tone?: MessageUiMetricTone }>
  /** Supervisor findings (non-blocking unless severity=block). */
  findings?: ReviewFinding[]
  /** Follow-up email draft for client modal + cloud flow send. */
  emailDraft?: EmailDraftFields
  tone?: 'info' | 'warn' | 'success'
}

export type AgentMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  agent_id?: string
  agent_name: string
  content: string
  sources: SourceRef[]
  confidence: number
  confidence_kind?: ConfidenceKind
  draft?: DraftPayload
  agent_chain?: string[]
  createdAt: string
  /** Optional rich UI payload rendered by the chat client. */
  ui?: MessageUiBlock
  steps?: AgentStep[]
}

/** Client-supplied file for this turn (base64, no data-URL prefix). */
export type OrchestratorAttachment = {
  name: string
  mimeType: string
  dataBase64: string
}

export type OrchestratorRequest = {
  utterance: string
  locale?: string
  context?: Record<string, string>
  /** Stable per user turn; retries reuse it so drafts stay idempotent. */
  turnId?: string
  /** Optional images / text files for this turn. */
  attachments?: OrchestratorAttachment[]
}

export type OrchestratorResponse = {
  messages: AgentMessage[]
  drafts: DraftPayload[]
  context: Record<string, string>
  latencyMs: number
  intent?: string
  mode?: 'deepseek' | 'openai' | 'heuristic' | 'mixed' | 'copilotstudio'
  degraded_reason?: string
  steps?: AgentStep[]
}

export type AccountRecord = {
  id: string
  externalKey: string
  name: string
  region: string
  creditLevel: string
  lastVisitAt?: string
  visitCount30d: number
  npsDelta?: string
  hasMsa: boolean
  notes?: string
}

export type ContactRecord = {
  id: string
  accountId: string
  externalKey?: string
  name: string
  title?: string
  phone?: string
}

export type OpportunityRecord = {
  id: string
  externalKey?: string
  name: string
  accountId: string
  accountName: string
  productLine: string
  productModel?: string
  quantity: number
  amount: number
  currencyCode: string
  stage: string
  confidenceScore: number
  closeDate?: string
  syncStatus?: SyncStatus
  isSeed?: boolean
  reuseExisting?: boolean
  existingOpportunityId?: string
  supervisorHints?: string[]
  linkedActivityId?: string
  idempotencyKey?: string
  createdByAgent?: string
  sourcesJson?: string
  createdAt?: string
  updatedAt?: string
}

export type OrderRecord = {
  id: string
  externalKey: string
  name: string
  accountId: string
  status: string
  orderedAt: string
  amount: number
  currencyCode: string
}

export type ShipmentRecord = {
  id: string
  orderId: string
  name: string
  status: string
  eta: string
  trackingNo: string
}

export type InvocationLog = {
  id: string
  sessionId?: string
  agentName: string
  inputSummary: string
  outputEnvelope?: string
  latencyMs: number
  success: boolean
  confidence?: number
  errorMessage?: string
  errorCode?: string
  fallbackReason?: string
  promptVersion?: string
  modelName?: string
  createdAt: string
}

export type ConversationRecord = {
  id: string
  sessionKey: string
  contextJson: string
  messagesJson: string
  lastMessageAt: string
}

export type ExtractedVisit = {
  accountName?: string
  accountId?: string
  contactName?: string
  productLine?: string
  productModel?: string
  quantity?: number
  unit?: string
  occurredAt?: string
  followUpAt?: string
  followUpHint?: string
  visitType?: string
  summary?: string
  fieldConfidence?: Record<string, number>
  missingFields?: string[]
  confidence: number
}

export type Intent =
  | 'capture_visit'
  | 'query_account'
  | 'list_accounts'
  | 'query_order'
  | 'work_summary'
  | 'general_assist'
  | 'clarify'
