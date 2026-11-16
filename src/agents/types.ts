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
