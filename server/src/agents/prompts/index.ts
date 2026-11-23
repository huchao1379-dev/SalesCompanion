/**
 * Prompt barrel — Domain Agents import from here.
 * Each agent module lives beside this file; versions are in versions.ts.
 */

export { PROMPT_VERSIONS, promptVersion } from './versions.js'
export type { PromptAgentKey } from './versions.js'

export { COMPOSE_SYSTEM } from './compose.js'
export { INTENT_SYSTEM, buildIntentSystem } from './intent.js'
export { CLARIFY_SYSTEM } from './clarify.js'
export { EXTRACT_SYSTEM } from './extract.js'
export {
  ACCOUNT_PROFILE_SYSTEM,
  ACCOUNT_PROFILE_TOOL_ADDENDUM,
} from './accountProfile.js'
export {
  ORDER_QUERY_SYSTEM,
  ORDER_QUERY_TOOL_ADDENDUM,
} from './orderQuery.js'
export { ACTIVITY_INSIGHT_SYSTEM } from './activityInsight.js'
export { OPPORTUNITY_INSIGHT_SYSTEM } from './opportunityInsight.js'
export { WORK_SUMMARY_SYSTEM } from './workSummary.js'
export {
  GENERAL_ASSIST_SYSTEM,
  GENERAL_ASSIST_TOOL_ADDENDUM,
} from './generalAssist.js'
