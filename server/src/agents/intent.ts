import { chatJson, hasDeepSeek } from '../llm/deepseek.js'
import type { Intent } from '../types.js'
import { INTENT_SYSTEM } from './prompts.js'

const INTENTS: Intent[] = [
  'capture_visit',
  'query_account',
  'query_order',
  'work_summary',
  'clarify',
]

function isIntent(v: unknown): v is Intent {
  return typeof v === 'string' && (INTENTS as string[]).includes(v)
}

export async function classifyIntent(utterance: string): Promise<{
  intent: Intent
  confidence: number
  mode: 'deepseek' | 'heuristic'
  reason?: string
}> {
  if (hasDeepSeek()) {
    try {
      const { data, mode } = await chatJson<{
        intent: Intent
        confidence?: number
        reason?: string
      }>({
        system: INTENT_SYSTEM,
        user: JSON.stringify({ utterance }),
        temperature: 0.1,
      })
      if (isIntent(data.intent)) {
        return {
          intent: data.intent,
          confidence: data.confidence ?? 0.8,
          mode,
          reason: data.reason,
        }
      }
    } catch {
      /* fall through */
    }
  }
  return { ...heuristicIntent(utterance), mode: 'heuristic' }
}

function heuristicIntent(utterance: string): {
  intent: Intent
  confidence: number
  reason: string
} {
  const t = utterance.trim()
  if (!t || t.length < 2) {
    return { intent: 'clarify', confidence: 0.9, reason: '内容过短' }
  }

  if (/你能做|能做什么|有什么功能|怎么用|你会什么|帮我什么|capabilities|what can you/i.test(t)) {
    return { intent: 'clarify', confidence: 0.92, reason: '能力询问' }
  }
  if (/^(你好|嗨|在吗|hello|hi)[\s!！.。]*$/i.test(t)) {
    return { intent: 'clarify', confidence: 0.88, reason: '打招呼' }
  }
  if (/日报|周报|工作总结|今日小结|帮我总结/.test(t)) {
    return { intent: 'work_summary', confidence: 0.9, reason: '工作总结' }
  }
  if (/订单|物流|清关|发货|到港|运单|shipment|order/i.test(t)) {
    return { intent: 'query_order', confidence: 0.86, reason: '订单物流' }
  }

  const looksLikeVisit = /拜访|感兴趣|定标|要\s*\d+\s*台|\d+\s*台|刚拜访|录入拜访/.test(t)
  if (
    !looksLikeVisit &&
    (/怎么样|进度|画像|信用|最近怎么样|客户.*怎么|Hospital.*(进度|怎么样)|仁济.*怎么|Alpha.*进度/i.test(
      t,
    ) ||
      (/仁济|Hospital Alpha|Hospital Beta|Hospital Gamma|Hospital Delta/.test(t) &&
        /最近|进度|怎么样|画像|信用/.test(t)))
  ) {
    return { intent: 'query_account', confidence: 0.88, reason: '客户画像查询' }
  }
  if (looksLikeVisit || (/主任|监护仪|N17|A1|商机/.test(t) && t.length > 12)) {
    return { intent: 'capture_visit', confidence: 0.88, reason: '拜访录入' }
  }
  if (/怎么样|进度|客户|仁济|Hospital/.test(t)) {
    return { intent: 'query_account', confidence: 0.72, reason: '客户相关' }
  }
  return { intent: 'clarify', confidence: 0.6, reason: '信息不足' }
}
