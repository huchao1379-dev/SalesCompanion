/**
 * Backward-compatible barrel — prefer `./prompts/index.js` for new code.
 */
export {
  PROMPT_VERSIONS,
  promptVersion,
  COMPOSE_SYSTEM,
  INTENT_SYSTEM,
  buildIntentSystem,
  CLARIFY_SYSTEM,
  EXTRACT_SYSTEM,
  ACCOUNT_PROFILE_SYSTEM,
  ORDER_QUERY_SYSTEM,
  ACTIVITY_INSIGHT_SYSTEM,
  OPPORTUNITY_INSIGHT_SYSTEM,
  WORK_SUMMARY_SYSTEM,
  ACCOUNT_PROFILE_TOOL_ADDENDUM,
  ORDER_QUERY_TOOL_ADDENDUM,
  GENERAL_ASSIST_SYSTEM,
  GENERAL_ASSIST_TOOL_ADDENDUM,
} from './prompts/index.js'
export type { PromptAgentKey } from './prompts/index.js'
