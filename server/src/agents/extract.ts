import { chatJson, hasDeepSeek } from '../llm/deepseek.js'
import type { ExtractedVisit } from '../types.js'
import { EXTRACT_SYSTEM } from './prompts.js'

export async function extractVisit(utterance: string): Promise<{
  extracted: ExtractedVisit
  mode: 'deepseek' | 'heuristic'
}> {
  if (hasDeepSeek()) {
    try {
      const { data, mode } = await chatJson<ExtractedVisit>({
        system: EXTRACT_SYSTEM,
        user: JSON.stringify({ utterance }),
        temperature: 0.1,
      })
      return {
        extracted: {
          ...data,
          confidence: clamp(data.confidence ?? 0.75),
          visitType: data.visitType || 'Visit',
          summary: data.summary || utterance.slice(0, 120),
        },
        mode,
      }
    } catch {
      /* fall through */
    }
  }
  return { extracted: heuristicExtract(utterance), mode: 'heuristic' }
}

function heuristicExtract(utterance: string): ExtractedVisit {
  const accountName =
    match(utterance, /(上海仁济医院|仁济医院|Hospital Alpha|Hospital Beta|Hospital Gamma|Hospital Delta)/i) ||
    (utterance.includes('仁济') ? '上海仁济医院' : utterance.includes('Alpha') ? 'Hospital Alpha' : undefined)

  const contactName = match(utterance, /(张主任|Maria Silva|[A-Za-z\u4e00-\u9fa5]{1,8}主任)/)
  const productModel = match(utterance, /\b(N17|A1|A3)\b/i)?.toUpperCase()
  const productLine = utterance.includes('监护仪') || productModel ? '监护仪' : undefined
  const qtyMatch = utterance.match(/(\d+)\s*台/)
  const quantity = qtyMatch ? Number(qtyMatch[1]) : undefined
  const followUpHint = /下周三|下周|再约/.test(utterance) ? '下周三' : undefined

  let confidence = 0.55
  if (accountName) confidence += 0.15
  if (contactName) confidence += 0.1
  if (productModel) confidence += 0.1
  if (quantity) confidence += 0.05

  return {
    accountName,
    contactName,
    productLine,
    productModel,
    quantity,
    followUpHint,
    visitType: 'Visit',
    summary: utterance.slice(0, 160),
    confidence: clamp(confidence),
  }
}

function match(text: string, re: RegExp) {
  const m = text.match(re)
  return m?.[1]
}

function clamp(n: number) {
  return Math.max(0, Math.min(1, n))
}
