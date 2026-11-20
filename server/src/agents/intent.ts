import { chatStructured, hasDeepSeek } from '../llm/deepseek.js'
import { intentOutputSchema } from '../llm/schemas.js'
import type { Intent } from '../types.js'
import type { ConversationTurn } from './agentTypes.js'
import { INTENT_SYSTEM } from './prompts.js'
import { nowIsoInZone } from '../util/datetime.js'

const INTENTS: Intent[] = ['capture_visit', 'query_account', 'query_order', 'work_summary', 'clarify']

export type IntentFocus = 'capability' | 'greeting' | 'missing_info' | 'ambiguous' | 'none'

export type IntentClassification = {
  intent: Intent
  confidence: number
  mode: 'deepseek' | 'heuristic'
  reason?: string
  needsClarification: boolean
  missingSlots: string[]
  focus: IntentFocus
}

export type IntentOptions = {
  history?: ConversationTurn[]
  memory?: Record<string, string>
  knownAccounts?: Array<{ name: string; aliases?: string[] }>
}

function isIntent(value: unknown): value is Intent {
  return typeof value === 'string' && (INTENTS as string[]).includes(value)
}

function compactHistory(history: ConversationTurn[] = []) {
  return history.slice(-6).map((turn) => ({
    role: turn.role,
    agent_name: turn.agentName,
    content: turn.content.replace(/\s+/g, ' ').slice(0, 240),
  }))
}

export async function classifyIntent(
  utterance: string,
  options: IntentOptions = {},
): Promise<IntentClassification> {
  if (hasDeepSeek()) {
    try {
      const { data, mode } = await chatStructured({
        system: INTENT_SYSTEM,
        user: JSON.stringify({
          utterance,
          now: nowIsoInZone(),
          timezone: 'Asia/Shanghai',
          locale: 'zh-CN',
          conversation: {
            recentTurns: compactHistory(options.history),
            lastIntent: options.memory?.lastIntent || null,
            accountId: options.memory?.accountId || null,
            accountName: options.memory?.accountName || null,
            accountRef: options.memory?.accountRef || null,
            lastActivityKey: options.memory?.lastActivityKey || null,
            lastOpportunityKey: options.memory?.lastOpportunityKey || null,
            lastAttachmentSummary: options.memory?.lastAttachmentSummary || null,
          },
          knownAccounts: (options.knownAccounts || []).map((account) => ({
            name: account.name,
            aliases: account.aliases || [],
          })),
        }),
        temperature: 0.1,
        maxTokens: 260,
        schema: intentOutputSchema,
      })
      if (isIntent(data.intent)) {
        const confidence = data.confidence ?? 0.8
        return {
          intent: data.intent,
          confidence,
          mode,
          reason: data.reason,
          needsClarification: data.needsClarification ?? confidence < 0.6,
          missingSlots: data.missingSlots ?? [],
          focus: data.focus ?? 'none',
        }
      }
    } catch {
      /* fall through to deterministic router */
    }
  }
  return { ...heuristicIntent(utterance, options), mode: 'heuristic' }
}

function heuristicIntent(utterance: string, options: IntentOptions): Omit<IntentClassification, 'mode'> {
  const text = utterance.trim()
  const memory = options.memory || {}
  const hasAccountContext = Boolean(memory.accountId || memory.accountName)
  const hasFollowUpReference = /^(那|它|这个|这家|刚才|上面)|它的|他的|这个客户|那家|那单|这单/.test(text)

  if (!text || text.length < 2) {
    return result('clarify', 0.92, '内容过短', true, ['action'], 'missing_info')
  }

  if (/你能做|能做什么|有什么功能|怎么用|你会什么|帮我什么|capabilities|what can you/i.test(text)) {
    return result('clarify', 0.92, '能力询问', false, [], 'capability')
  }
  if (/^(你好|嗨|在吗|hello|hi)[\s!！.。]*$/i.test(text)) {
    return result('clarify', 0.9, '打招呼', false, [], 'greeting')
  }
  if (/日报|周报|工作总结|工作小结|今日小结|今日总结|帮我写.*总结|写.*日报|写.*周报/.test(text)) {
    return result('work_summary', 0.9, '工作总结', false, [], 'none')
  }
  if (/订单|物流|清关|发货|到港|运单|shipment|order/i.test(text)) {
    return result(
      'query_order',
      hasAccountContext || /仁济|Hospital|医院|客户/.test(text) ? 0.88 : 0.72,
      '订单物流',
      !hasAccountContext && !/仁济|Hospital|医院/.test(text),
      ['account'],
      'missing_info',
    )
  }

  const namedAccount = /仁济|Hospital Alpha|Hospital Beta|Hospital Gamma|Hospital Delta|医院/.test(text)
  const looksLikeVisit = /拜访|感兴趣|定标|要\s*\d+\s*台|\d+\s*台|刚拜访|录入拜访/.test(text)

  if (
    !looksLikeVisit &&
    (/怎么样|进度|画像|信用|最近怎么样|客户.*怎么|Hospital.*(进度|怎么样)|仁济.*怎么|Alpha.*进度/i.test(
      text,
    ) ||
      (namedAccount && /最近|进度|怎么样|画像|信用/.test(text)))
  ) {
    return result(
      'query_account',
      hasAccountContext || namedAccount ? 0.88 : 0.62,
      '客户画像查询',
      !hasAccountContext && !namedAccount,
      ['account'],
      'missing_info',
    )
  }

  if (looksLikeVisit || (/主任|监护仪|N17|A1|商机/.test(text) && text.length > 12)) {
    return result(
      'capture_visit',
      namedAccount ? 0.9 : 0.68,
      '拜访录入',
      !namedAccount,
      namedAccount ? [] : ['account'],
      'missing_info',
    )
  }

  if (hasFollowUpReference && hasAccountContext) {
    return result('query_account', 0.84, '多轮客户跟进', false, [], 'none')
  }

  if (/怎么样|进度|客户|仁济|Hospital|这单|那单/.test(text)) {
    return result(
      'clarify',
      0.52,
      '信息不足',
      true,
      hasAccountContext ? ['action'] : ['account', 'action'],
      'ambiguous',
    )
  }

  return result('clarify', 0.6, '信息不足', true, ['action'], 'missing_info')
}

function result(
  intent: Intent,
  confidence: number,
  reason: string,
  needsClarification: boolean,
  missingSlots: string[],
  focus: IntentFocus,
): Omit<IntentClassification, 'mode'> {
  return { intent, confidence, reason, needsClarification, missingSlots, focus }
}
