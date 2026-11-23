import type {
  AccountRecord,
  ActivityDraft,
  AgentMessage,
  ContactRecord,
  DraftPayload,
  ExtractedVisit,
  Intent,
  OpportunityDraft,
  OpportunityRecord,
  ReviewFinding,
} from '../types.js'

export type { Intent }

export type ConversationTurn = {
  role: string
  content: string
  agentName?: string
}

/** Shared memory + structured state passed along a pipeline. */
export type PipelineState = {
  extracted?: ExtractedVisit
  account?: AccountRecord
  contact?: ContactRecord
  existingOpportunity?: OpportunityRecord
  activity?: ActivityDraft
  opportunity?: OpportunityDraft
  review?: ReviewFinding[]
}

export type AgentContext = {
  utterance: string
  locale?: string
  sessionKey?: string
  /** Stable per-turn id; used for draft idempotency. */
  turnId?: string
  intent: Intent
  /** String bag for Shared Memory (persisted on conversation). */
  memory: Record<string, string>
  /** Typed bag for sequential / fan-out steps. */
  state: PipelineState
  /** Recent conversation turns (already truncated) for multi-turn prompts. */
  history?: ConversationTurn[]
  /** Known account names/aliases from the active store, for extraction grounding. */
  knownAccounts?: Array<{ id: string; name: string; aliases?: string[] }>
  modes: Set<'deepseek' | 'openai' | 'heuristic'>
}

export type AgentResult = {
  messages?: AgentMessage[]
  drafts?: DraftPayload[]
  memoryPatch?: Record<string, string>
  statePatch?: Partial<PipelineState>
  review?: ReviewFinding[]
  /** Stop remaining steps in a sequential pipeline. */
  halt?: boolean
  mode?: 'deepseek' | 'openai' | 'heuristic'
  /** When LLM path fails and agent returns heuristic, short reason for steps / logs. */
  fallbackReason?: string
}

/**
 * Domain Agent contract — register once, Orchestrator schedules.
 * Agents must not call each other; share data via context.state / memory.
 */
export type DomainAgent = {
  /** Stable English id used in registry & pipelines. */
  name: string
  displayName: string
  description: string
  /** Intents this agent can own when used as a single-route target. */
  intents?: Intent[]
  run: (ctx: AgentContext) => Promise<AgentResult>
}

export type PipelineMode = 'sequential' | 'fanout' | 'single'

export type PipelineDef = {
  mode: PipelineMode
  /** Registry names, in order for sequential; parallel for fanout. */
  agents: string[]
}
