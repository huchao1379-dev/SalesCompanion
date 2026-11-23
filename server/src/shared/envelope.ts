/**
 * Shared Message Envelope contract (docs/03).
 * Server types re-export from here; frontend mirrors the same shapes in
 * `src/agents/types.ts`. Contract tests keep the two sides aligned.
 */

export type SourceKind = 'dataverse' | 'sap' | 'knowledge' | 'other'

export type SourceRef = {
  kind: SourceKind
  label: string
  ref?: string
  entity?: string
  id?: string
}

export type ConfidenceKind = 'answer' | 'extraction' | 'composite'

export type ReviewSeverity = 'info' | 'warn' | 'block'

export type ReviewAction = 'create' | 'link_existing' | 'update_stage' | 'edit'

export type ReviewFinding = {
  code: string
  severity: ReviewSeverity
  field?: string
  message: string
  suggestedAction?: ReviewAction
}

export type AgentStepStatus = 'ok' | 'fallback' | 'error' | 'skipped'

export type AgentStep = {
  agentId: string
  agentName: string
  status: AgentStepStatus
  latencyMs: number
  summary?: string
  errorCode?: string
}

export type AgentRole = 'user' | 'assistant' | 'system' | 'tool'

/** Envelope fields every assistant reply must carry for UI hard rules. */
export type EnvelopeCore = {
  id: string
  role: AgentRole
  agent_id?: string
  agent_name: string
  content: string
  sources: SourceRef[]
  confidence: number
  confidence_kind?: ConfidenceKind
  agent_chain?: string[]
  createdAt: string
  steps?: AgentStep[]
}

/** Keys that must exist on both server + client AgentMessage. */
export const ENVELOPE_REQUIRED_KEYS = [
  'id',
  'role',
  'agent_name',
  'content',
  'sources',
  'confidence',
  'createdAt',
] as const

export type EnvelopeRequiredKey = (typeof ENVELOPE_REQUIRED_KEYS)[number]
