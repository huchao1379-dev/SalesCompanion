import { createHash } from 'node:crypto'
import type { AgentContext } from './agentTypes.js'

/**
 * Stable draft key for the demo:
 * - retries of the same turn update the same draft instead of duplicating;
 * - a new turn with the same wording creates a new draft (turnId differs).
 */
export function draftIdempotencyKey(
  kind: 'activity' | 'opportunity',
  ctx: AgentContext,
): string {
  const basis = [
    ctx.sessionKey || 'local',
    ctx.turnId || '',
    ctx.utterance.trim().toLowerCase(),
    ctx.state.account?.id || ctx.state.extracted?.accountName || '',
    kind,
    ctx.state.extracted?.productLine || '',
    ctx.state.extracted?.productModel || '',
  ].join('|')
  return `${kind}_${createHash('sha1').update(basis).digest('hex').slice(0, 20)}`
}
