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
} from '../types.js'

export type { Intent }

/** Shared memory + structured state passed along a pipeline. */
export type PipelineState = {
  extracted?: ExtractedVisit
  account?: AccountRecord
  contact?: ContactRecord
  existingOpportunity?: OpportunityRecord
  activity?: ActivityDraft
  opportunity?: OpportunityDraft
}

export type AgentContext = {
  utterance: string
  locale?: string
  sessionKey?: string
  intent: Intent
  /** String bag for Shared Memory (persisted on conversation). */
  memory: Record<string, string>
  /** Typed bag for sequential / fan-out steps. */
  state: PipelineState
  modes: Set<'deepseek' | 'heuristic'>
}

export type AgentResult = {
  messages?: AgentMessage[]
  drafts?: DraftPayload[]
  memoryPatch?: Record<string, string>
  statePatch?: Partial<PipelineState>
  /** Stop remaining steps in a sequential pipeline. */
  halt?: boolean
  mode?: 'deepseek' | 'heuristic'
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
