export type SyncStatus =
  | 'Draft'
  | 'Confirmed'
  | 'Syncing'
  | 'Synced'
  | 'SyncFailed'
  | 'Discarded'

export type SourceRef = {
  kind: 'dataverse' | 'sap' | 'knowledge' | 'other'
  label: string
  ref?: string
  entity?: string
  id?: string
}

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
  createdAt: string
  updatedAt: string
}

export type DraftPayload = ActivityDraft | OpportunityDraft

export type AgentMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  agent_name: string
  content: string
  sources: SourceRef[]
  confidence: number
  draft?: DraftPayload
  agent_chain?: string[]
  createdAt: string
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
  mode?: 'deepseek' | 'heuristic'
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
  contactName?: string
  productLine?: string
  productModel?: string
  quantity?: number
  followUpHint?: string
  visitType?: string
  summary?: string
  confidence: number
}

export type Intent =
  | 'capture_visit'
  | 'query_account'
  | 'query_order'
  | 'work_summary'
  | 'clarify'
