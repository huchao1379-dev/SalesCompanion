/** Message Envelope — aligns with docs/03-agent-architecture.md */

export type AgentRole = 'user' | 'assistant' | 'system' | 'tool'

export type SourceKind = 'dataverse' | 'sap' | 'knowledge' | 'other'

export type SourceRef = {
  kind: SourceKind
  label: string
  ref?: string
  entity?: string
  id?: string
}

/** Draft → Confirmed → Syncing → Synced | SyncFailed | Discarded */
export type SyncStatus =
  | 'Draft'
  | 'Confirmed'
  | 'Syncing'
  | 'Synced'
  | 'SyncFailed'
  | 'Discarded'

export type ActivityDraftPayload = {
  kind: 'activity'
  id?: string
  subject: string
  summary: string
  visitType: string
  accountName: string
  accountRef?: string
  accountId?: string
  contactName: string
  contactId?: string
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
  createdAt?: string
  updatedAt?: string
}

export type OpportunityDraftPayload = {
  kind: 'opportunity'
  id?: string
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
  sessionKey?: string
  createdAt?: string
  updatedAt?: string
}

export type DraftPayload = ActivityDraftPayload | OpportunityDraftPayload

/** UI delivery state for assistant turns — not model internal reasoning. */
export type MessageDeliveryStatus = 'pending' | 'complete' | 'stopped' | 'error'

export type MessageFailureKind = 'network' | 'query' | 'generation' | 'write' | 'unknown'

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
  id: 'open_account' | 'open_opportunity' | string
  label: string
}

/** Structured blocks for rich chat rendering (not raw JSON dump). */
export type MessageUiBlock = {
  type: 'account_pulse' | 'opportunity_list' | 'order_status' | 'metric_strip'
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
}

export type AgentMessage = {
  id: string
  role: AgentRole
  agent_name: string
  content: string
  sources: SourceRef[]
  confidence: number
  draft?: DraftPayload
  agent_chain?: string[]
  createdAt: string
  /** Optional rich UI payload rendered by the chat client. */
  ui?: MessageUiBlock
  /** When the assistant finished generating (distinct from createdAt / send time). */
  completedAt?: string
  deliveryStatus?: MessageDeliveryStatus
  failureKind?: MessageFailureKind
  /** User-facing progress line while pending (not chain-of-thought). */
  progressLabel?: string
  /** Utterance to re-run on retry without duplicating the user bubble. */
  retryUtterance?: string
}

export type OrchestratorRequest = {
  utterance: string
  locale?: string
  context?: Record<string, string>
}

export type OrchestratorResponse = {
  messages: AgentMessage[]
  drafts: DraftPayload[]
  context: Record<string, string>
  latencyMs: number
  intent?: string
  mode?: 'deepseek' | 'heuristic' | 'copilotstudio'
}

export type AccountProfile = {
  accountRef: string
  accountName: string
  /** 信用等级，如 A / B / C */
  creditRating: string
  visitCount30d: number
  npsDelta?: string
  lastContactAt?: string
  openOpportunities: Array<{
    name: string
    stage: string
    confidence: number
    productLine: string
  }>
  summary: string
  sources: SourceRef[]
}

export type AgentInvocationRecord = {
  id: string
  conversationId?: string
  agentName: string
  utterance: string
  latencyMs: number
  success: boolean
  confidence?: number
  errorMessage?: string
  creditsEstimate?: number
  createdAt: string
}

export type AIMetadataRecord = {
  id: string
  regardingKey?: string
  regardingKind?: 'activity' | 'opportunity' | 'conversation' | 'other'
  summary?: string
  tags: string[]
  promptVersion?: string
  modelName?: string
  confidence?: number
  createdAt: string
}

export type OfflineUtterance = {
  id: string
  utterance: string
  locale: string
  createdAt: string
  synced: boolean
}
