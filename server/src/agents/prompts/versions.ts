/**
 * Per-agent prompt versions — logged with every LLM / agent invocation.
 * Bump the matching key whenever that prompt's rules change.
 */

export const PROMPT_VERSIONS = {
  intent: 'intent@v4',
  clarify: 'clarify@v2',
  extract: 'extract@v2',
  accountProfile: 'accountProfile@v2',
  orderQuery: 'orderQuery@v2',
  workSummary: 'workSummary@v2',
  activityInsight: 'activityInsight@v1',
  opportunityInsight: 'opportunityInsight@v1',
  generalAssist: 'generalAssist@v1',
  compose: 'compose@v1',
} as const

export type PromptAgentKey = keyof typeof PROMPT_VERSIONS

const AGENT_PROMPT_KEY: Record<string, PromptAgentKey> = {
  IntentRouter: 'intent',
  EntityExtract: 'extract',
  Clarify: 'clarify',
  AccountProfile: 'accountProfile',
  OrderQuery: 'orderQuery',
  WorkSummary: 'workSummary',
  ActivityInsight: 'activityInsight',
  OpportunityInsight: 'opportunityInsight',
  GeneralAssist: 'generalAssist',
  Orchestrator: 'compose',
  Compose: 'compose',
}

export function promptVersion(agent: PromptAgentKey | string): string {
  if (agent in PROMPT_VERSIONS) {
    return PROMPT_VERSIONS[agent as PromptAgentKey]
  }
  const mapped = AGENT_PROMPT_KEY[agent]
  if (mapped) return PROMPT_VERSIONS[mapped]
  return `demo/${agent}`
}
