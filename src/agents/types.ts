/** Message Envelope — aligns with docs/03-agent-architecture.md */

export type AgentRole = 'user' | 'assistant' | 'system' | 'tool'

export type SourceKind = 'dataverse' | 'sap' | 'knowledge' | 'other'

export type SourceRef = {
  kind: SourceKind
  label: string
  ref?: string
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
  subject: string
  summary: string
  visitType: string
  accountName: string
  contactName: string
  followUpAt: string
  transcript: string
  syncStatus: SyncStatus
  confidence: number
  sources: SourceRef[]
  agentName: string
  idempotencyKey: string
  sapExternalId?: string
  syncError?: string
}

export type OpportunityDraftPayload = {
  kind: 'opportunity'
  name: string
  accountName: string
  productLine: string
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
  sapExternalId?: string
  syncError?: string
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
}
