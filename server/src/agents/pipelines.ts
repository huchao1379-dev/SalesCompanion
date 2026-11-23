/**
 * Manifest-driven intent → pipeline resolution.
 * Domain Agents declare intents in catalog; multi-step flows live here so
 * Orchestrator does not hardcode every new agent.
 */
import { findAgentForIntent, listAgents } from './registry.js'
import type { PipelineDef } from './agentTypes.js'
import type { Intent } from '../types.js'

/**
 * Explicit multi-agent pipelines. Single-route intents can omit an entry and
 * fall through to `findAgentForIntent`.
 */
export const PIPELINE_MANIFEST: Partial<Record<Intent, PipelineDef>> = {
  capture_visit: {
    mode: 'sequential',
    agents: [
      'EntityExtract',
      'ActivityCreate',
      'OpportunityCreate',
      'ActivitySupervisor',
      'OpportunitySupervisor',
    ],
  },
  query_account: {
    mode: 'fanout',
    agents: ['AccountProfile', 'OpportunityPulse'],
  },
  list_accounts: {
    mode: 'single',
    agents: ['AccountList'],
  },
  query_order: {
    mode: 'single',
    agents: ['OrderQuery'],
  },
  work_summary: {
    mode: 'single',
    agents: ['WorkSummary'],
  },
  general_assist: {
    mode: 'single',
    agents: ['GeneralAssist'],
  },
}

/** Resolve pipeline for an intent: manifest first, then single-agent ownership. */
export function resolvePipeline(intent: Intent): PipelineDef | undefined {
  const fromManifest = PIPELINE_MANIFEST[intent]
  if (fromManifest?.agents.length) return fromManifest

  const owner = findAgentForIntent(intent)
  if (owner) {
    return { mode: 'single', agents: [owner.name] }
  }

  // Last resort: any registered agent that lists the intent (stable order).
  const matches = listAgents().filter((agent) => agent.intents?.includes(intent))
  if (matches.length === 1) {
    return { mode: 'single', agents: [matches[0].name] }
  }
  if (matches.length > 1) {
    return { mode: 'fanout', agents: matches.map((agent) => agent.name) }
  }
  return undefined
}
