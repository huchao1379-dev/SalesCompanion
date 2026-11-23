import { chatStructured, hasLlm } from '../llm/deepseek.js'
import { formatLlmTransportError } from '../llm/errors.js'
import { intentOutputSchema } from '../llm/schemas.js'
import type { Intent } from '../types.js'
import type { ConversationTurn } from './agentTypes.js'
import { buildIntentSystem } from './prompts/intent.js'
import { findHardMatchSkill, routableIntents, skillsForRouterPrompt } from './skills.js'
import { nowIsoInZone } from '../util/datetime.js'

const INTENTS: Intent[] = routableIntents()

/** @deprecated Prefer findHardMatchSkill / skills catalog; kept for orchestrator compat. */
export function looksLikeAccountListQuery(text: string) {
  return findHardMatchSkill(text)?.intent === 'list_accounts'
}

export type IntentFocus = 'capability' | 'greeting' | 'missing_info' | 'ambiguous' | 'none'

export type IntentClassification = {
  intent: Intent
  confidence: number
  mode: 'deepseek' | 'openai' | 'heuristic'
  reason?: string
  needsClarification: boolean
  missingSlots: string[]
  focus: IntentFocus
  /** When LLM path failed and heuristic was used. */
  llmError?: string
}

export type IntentOptions = {
  history?: ConversationTurn[]
  memory?: Record<string, string>
  knownAccounts?: Array<{ name: string; aliases?: string[] }>
  /** Skip LLM — used by golden fixtures for offline / deterministic routing. */
  forceHeuristic?: boolean
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

/**
 * Post-LLM / post-heuristic refinements that use memory, not keyword sprawl.
 * hardMatch skills (e.g. list_accounts) win over model misroutes.
 */
function refineClassification(
  utterance: string,
  base: Omit<IntentClassification, 'mode'>,
  options: IntentOptions,
): Omit<IntentClassification, 'mode'> {
  const text = utterance.trim()
  const memory = options.memory || {}
  const hard = findHardMatchSkill(text)
  if (hard && hard.intent !== base.intent) {
    return {
      intent: hard.intent,
      confidence: Math.max(base.confidence, 0.94),
      reason: `技能护栏：${hard.name}`,
      needsClarification: false,
      missingSlots: [],
      focus: 'none',
    }
  }

  const hasAccountContext = Boolean(memory.accountId || memory.accountName)
  const isCapabilityOrGreeting =
    /你能做|能做什么|有什么功能|怎么用|你会什么|帮我什么|capabilities|what can you/i.test(text) ||
    /^(你好|嗨|在吗|hello|hi)[\s!！.。]*$/i.test(text)

  // Pronoun / ambiguous follow-ups with remembered account → prefer account query.
  if (
    base.intent === 'clarify' &&
    hasAccountContext &&
    !isCapabilityOrGreeting &&
    (/那|它|这个|这家|刚才|这单|那单/.test(text) ||
      (base.focus === 'ambiguous' && /最近|怎么样|进度|信用|商机|画像/.test(text)))
  ) {
    return {
      intent: 'query_account',
      confidence: Math.max(base.confidence, 0.84),
      reason: '多轮客户记忆继承',
      needsClarification: false,
      missingSlots: [],
      focus: 'none',
    }
  }

  return base
}

/**
 * Skill-catalog Intent Router.
 * Primary path: DeepSeek agent chooses among ROUTABLE_SKILLS.
 * Fallback: thin heuristic (offline / LLM failure) — not the extension surface.
 */
export async function classifyIntent(
  utterance: string,
  options: IntentOptions = {},
): Promise<IntentClassification> {
  if (hasLlm() && !options.forceHeuristic) {
    try {
      const { data, mode } = await chatStructured({
        system: buildIntentSystem(),
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
          skills: skillsForRouterPrompt(),
        }),
        temperature: 0.1,
        maxTokens: 260,
        schema: intentOutputSchema,
      })
      if (isIntent(data.intent)) {
        const confidence = data.confidence ?? 0.8
        const refined = refineClassification(
          utterance,
          {
            intent: data.intent,
            confidence,
            reason: data.reason,
            needsClarification: data.needsClarification ?? confidence < 0.6,
            missingSlots: data.missingSlots ?? [],
            focus: data.focus ?? 'none',
          },
          options,
        )
        return { ...refined, mode }
      }
    } catch (error) {
      const heuristic = refineClassification(utterance, heuristicIntent(utterance, options), options)
      return {
        ...heuristic,
        mode: 'heuristic',
        llmError: formatLlmTransportError(error),
      }
    }
  }
  const heuristic = refineClassification(utterance, heuristicIntent(utterance, options), options)
  return { ...heuristic, mode: 'heuristic' }
}

/**
 * Offline / failure fallback. Keep thin and stable for golden tests.
 * Do NOT grow business coverage here — add a skill + pipeline instead.
 */
function heuristicIntent(utterance: string, options: IntentOptions): Omit<IntentClassification, 'mode'> {
  const text = utterance.trim()
  const memory = options.memory || {}
  const hasAccountContext = Boolean(memory.accountId || memory.accountName)
  const hasFollowUpReference = /^(那|它|这个|这家|刚才|上面)|它的|他的|这个客户|那家|那单|这单/.test(text)

  if (!text || text.length < 2) {
    return result('clarify', 0.92, '内容过短', true, ['action'], 'missing_info')
  }

  const hard = findHardMatchSkill(text)
  if (hard) {
    return result(hard.intent, 0.94, `技能护栏：${hard.name}`, false, [], 'none')
  }

  if (
    /你是谁|你叫什么|介绍一下你自己|你是什么|who are you|what are you/i.test(text)
  ) {
    return result('clarify', 0.93, '自我介绍', false, [], 'greeting')
  }
  if (/你能做|能做什么|有什么功能|怎么用|你会什么|帮我什么|capabilities|what can you/i.test(text)) {
    return result('clarify', 0.92, '能力询问', false, [], 'capability')
  }
  if (/^(你好|嗨|在吗|hello|hi)[\s!！.。]*$/i.test(text)) {
    return result('clarify', 0.9, '打招呼', false, [], 'greeting')
  }
  if (/日报|周报|工作总结|工作小结|今日小结|今日总结|帮我写.*总结|写.*日报|写.*周报|总结我今天/.test(text)) {
    return result('work_summary', 0.9, '工作总结', false, [], 'none')
  }
  if (
    /写.*(邮件|信|话术|开场|微信)|跟进邮件|感谢信|会议准备|准备会议|议程|卖点|怎么讲|异议处理|翻译|搜索|搜一下|查一下网上|打开链接|https?:\/\//i.test(
      text,
    ) ||
    (/帮我(写|改|润色|起草|准备)/.test(text) && !/拜访|录入|商机草稿|活动草稿/.test(text))
  ) {
    return result('general_assist', 0.88, '通用助手', false, [], 'none')
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
  const looksLikeVisit = /拜访|感兴趣|定标|要\s*\d+\s*台|\d+\s*台|刚拜访|录入拜访|记一下/.test(text)

  // Bare account name with no action → clarify.
  if (
    namedAccount &&
    text.length < 20 &&
    !looksLikeVisit &&
    !/怎么样|进度|画像|信用|订单|物流|总结|商机/.test(text)
  ) {
    return result('clarify', 0.78, '仅客户名缺动作', true, ['action'], 'missing_info')
  }

  // Need a named account, memory, or explicit “客户/Hospital” cue — bare「怎么样了」→ clarify.
  const looksLikeAccountQuery =
    (namedAccount && /最近|进度|怎么样|画像|信用|总结|商机/.test(text)) ||
    /客户.*怎么|Hospital.*(进度|怎么样)|仁济.*怎么|Alpha.*进度|总结.*情况/i.test(text) ||
    (hasAccountContext && /最近|进度|怎么样|画像|信用|商机/.test(text))
  if (!looksLikeVisit && looksLikeAccountQuery) {
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

  // Default unknown non-CRM phrasing to general assistant instead of a dead-end clarify.
  if (text.length >= 4) {
    return result('general_assist', 0.64, '通用问答', false, [], 'none')
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
