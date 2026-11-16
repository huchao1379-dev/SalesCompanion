import { chatJson, hasDeepSeek } from '../llm/deepseek.js'
import type { Intent } from '../types.js'

const SYSTEM = `你是销售 CRM 意图分类器。只输出 JSON：{"intent":"capture_visit|query_account|query_order|clarify","confidence":0-1}
规则：
- 拜访结果、约见、意向采购、台数 → capture_visit
- 客户怎么样、画像、进度（非明确订单物流）→ query_account
- 订单、物流、清关、发货、到港 → query_order
- 信息不足无法判断 → clarify`

export async function classifyIntent(utterance: string): Promise<{
  intent: Intent
  confidence: number
  mode: 'deepseek' | 'heuristic'
}> {
  if (hasDeepSeek()) {
    try {
      const { data, mode } = await chatJson<{ intent: Intent; confidence?: number }>({
        system: SYSTEM,
        user: utterance,
      })
      if (data.intent) {
        return { intent: data.intent, confidence: data.confidence ?? 0.8, mode }
      }
    } catch {
      /* fall through */
    }
  }
  return { ...heuristicIntent(utterance), mode: 'heuristic' }
}

function heuristicIntent(utterance: string): { intent: Intent; confidence: number } {
  const t = utterance.trim()
  if (!t || t.length < 2) return { intent: 'clarify', confidence: 0.9 }
  if (/订单|物流|清关|发货|到港|运单|shipment|order/i.test(t)) {
    return { intent: 'query_order', confidence: 0.86 }
  }
  const looksLikeVisit = /拜访|感兴趣|定标|要\s*\d+\s*台|\d+\s*台|刚拜访/.test(t)
  if (
    !looksLikeVisit &&
    (/怎么样|进度|画像|信用|最近怎么样|客户.*怎么|Hospital.*(进度|怎么样)|仁济.*怎么|Alpha.*进度/i.test(
      t,
    ) ||
      (/仁济|Hospital Alpha|Hospital Beta|Hospital Gamma|Hospital Delta/.test(t) &&
        /最近|进度|怎么样|画像|信用/.test(t)))
  ) {
    return { intent: 'query_account', confidence: 0.88 }
  }
  if (looksLikeVisit || /主任|监护仪|N17|A1|商机/.test(t) || t.length > 22) {
    return { intent: 'capture_visit', confidence: 0.88 }
  }
  if (/怎么样|进度|客户|仁济|Hospital/.test(t)) return { intent: 'query_account', confidence: 0.72 }
  return { intent: 'clarify', confidence: 0.6 }
}
