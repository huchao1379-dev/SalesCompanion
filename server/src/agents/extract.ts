import { chatStructured, hasLlm } from '../llm/deepseek.js'
import { extractVisitOutputSchema } from '../llm/schemas.js'
import type { ExtractedVisit } from '../types.js'
import type { ConversationTurn } from './agentTypes.js'
import { EXTRACT_SYSTEM } from './prompts.js'
import {
  isPastDate,
  normalizeIsoDate,
  normalizeIsoDateTime,
  nowIsoInZone,
  parseChineseRelativeDate,
} from '../util/datetime.js'

export type ExtractOptions = {
  now?: Date
  history?: ConversationTurn[]
  knownAccounts?: Array<{ id: string; name: string; aliases?: string[] }>
}

function clamp(n: number) {
  return Math.max(0, Math.min(1, n))
}

function compactHistory(history: ConversationTurn[] = []) {
  return history.slice(-4).map((turn) => ({
    role: turn.role,
    agent_name: turn.agentName,
    content: turn.content.replace(/\s+/g, ' ').slice(0, 200),
  }))
}

export async function extractVisit(
  utterance: string,
  options: ExtractOptions = {},
): Promise<{ extracted: ExtractedVisit; mode: 'deepseek' | 'openai' | 'heuristic' }> {
  const now = options.now ?? new Date()
  if (hasLlm()) {
    try {
      const { data, mode } = await chatStructured({
        system: EXTRACT_SYSTEM,
        user: JSON.stringify({
          utterance,
          now: nowIsoInZone(now),
          timezone: 'Asia/Shanghai',
          locale: 'zh-CN',
          conversation: compactHistory(options.history),
          knownAccounts: (options.knownAccounts || []).map((account) => ({
            id: account.id,
            name: account.name,
            aliases: account.aliases || [],
          })),
        }),
        temperature: 0.1,
        maxTokens: 620,
        schema: extractVisitOutputSchema,
      })

      const occurredAt =
        normalizeIsoDateTime(data.occurredAt, now) || nowIsoInZone(now)
      const parsedFollowUp =
        normalizeIsoDate(data.followUpAt, now) ||
        (data.followUpHint ? parseChineseRelativeDate(data.followUpHint, now)?.date : undefined) ||
        parseChineseRelativeDate(utterance, now)?.date
      const followUpAt = parsedFollowUp && !isPastDate(parsedFollowUp, now) ? parsedFollowUp : undefined
      const fieldConfidence = Object.fromEntries(
        Object.entries(data.fieldConfidence || {}).map(([key, value]) => [key, clamp(value)]),
      )
      const missingFields = new Set(data.missingFields || [])
      if (!data.accountName) missingFields.add('accountName')
      if (!data.contactName) missingFields.add('contactName')
      if (!data.productLine && !data.productModel) missingFields.add('productLine')
      if (!data.quantity) missingFields.add('quantity')
      if (!followUpAt) missingFields.add('followUpAt')

      const keyConfidence = [
        fieldConfidence.accountName,
        fieldConfidence.contactName,
        fieldConfidence.productLine ?? fieldConfidence.productModel,
        fieldConfidence.quantity,
        fieldConfidence.followUpAt,
      ].filter((value): value is number => typeof value === 'number')
      const confidence = clamp(
        data.confidence ?? (keyConfidence.length ? Math.min(...keyConfidence) : 0.7),
      )

      return {
        extracted: {
          accountName: data.accountName ?? undefined,
          accountId: data.accountId ?? undefined,
          contactName: data.contactName ?? undefined,
          productLine: data.productLine ?? undefined,
          productModel: data.productModel?.toUpperCase() || undefined,
          quantity: data.quantity ?? undefined,
          unit: data.unit || (data.quantity ? '台' : undefined),
          occurredAt,
          followUpAt,
          followUpHint: data.followUpHint ?? undefined,
          confidence,
          fieldConfidence,
          missingFields: [...missingFields],
          visitType: data.visitType || 'Visit',
          summary: data.summary?.trim() || utterance.slice(0, 120),
        },
        mode,
      }
    } catch {
      /* fall through to deterministic extraction */
    }
  }
  return { extracted: heuristicExtract(utterance, now, options.knownAccounts), mode: 'heuristic' }
}

function heuristicExtract(
  utterance: string,
  now: Date,
  knownAccounts: ExtractOptions['knownAccounts'] = [],
): ExtractedVisit {
  const matchedAccount = matchKnownAccount(utterance, knownAccounts)
  const accountName =
    matchedAccount?.name ||
    match(utterance, /(上海仁济医院|仁济医院|Hospital Alpha|Hospital Beta|Hospital Gamma|Hospital Delta)/i) ||
    (utterance.includes('仁济') ? '上海仁济医院' : utterance.includes('Alpha') ? 'Hospital Alpha' : undefined)
  const contactName = match(utterance, /(张主任|Maria Silva|[A-Za-z\u4e00-\u9fa5]{1,8}主任)/)
  const productModel = match(utterance, /\b(N17|A1|A3)\b/i)?.toUpperCase()
  const productLine = utterance.includes('监护仪') || productModel ? '监护仪' : undefined
  const quantity = parseQuantity(utterance)
  const followed = parseChineseRelativeDate(utterance, now)
  const followUpAt = followed && !isPastDate(followed.date, now) ? followed.date : undefined
  const followUpHint = followed?.source || (/下周|明天|后天|月底|下个月/.test(utterance) ? match(utterance, /(下(?:个)?周[一二三四五六日天]?|明天|后天|月底|下个月初)/) : undefined)

  const fieldConfidence: Record<string, number> = {
    accountName: accountName ? 0.92 : 0,
    contactName: contactName ? 0.88 : 0,
    productLine: productLine ? 0.9 : 0,
    productModel: productModel ? 0.9 : 0,
    quantity: quantity ? 0.88 : 0,
    followUpAt: followUpAt ? 0.86 : 0,
  }

  const missingFields: string[] = []
  if (!accountName) missingFields.push('accountName')
  if (!contactName) missingFields.push('contactName')
  if (!productLine && !productModel) missingFields.push('productLine')
  if (!quantity) missingFields.push('quantity')
  if (!followUpAt) missingFields.push('followUpAt')

  const present = [accountName, contactName, productLine, productModel, quantity, followUpAt].filter(Boolean).length
  const confidence = clamp(0.45 + present * 0.07)

  return {
    accountName,
    accountId: matchedAccount?.id,
    contactName,
    productLine,
    productModel,
    quantity,
    unit: quantity ? '台' : undefined,
    occurredAt: nowIsoInZone(now),
    followUpAt,
    followUpHint: followUpHint || undefined,
    visitType: /电话|call/i.test(utterance) ? 'Call' : /演示|demo/i.test(utterance) ? 'Demo' : /再约|跟进/.test(utterance) && !/拜访/.test(utterance) ? 'FollowUp' : 'Visit',
    summary: utterance.slice(0, 160),
    fieldConfidence,
    missingFields,
    confidence,
  }
}

function matchKnownAccount(
  utterance: string,
  knownAccounts: ExtractOptions['knownAccounts'] = [],
) {
  const lower = utterance.toLowerCase()
  return knownAccounts.find((account) => {
    const candidates = [account.name, ...(account.aliases || [])]
    return candidates.some((candidate) => candidate && lower.includes(candidate.toLowerCase()))
  })
}

function parseQuantity(text: string): number | undefined {
  const arabic = text.match(/(\d+)\s*台/)
  if (arabic) return Number(arabic[1])
  const chinese = text.match(/([一二两三四五六七八九十]+)\s*台/)
  if (!chinese) return undefined
  const value = parseChineseNumber(chinese[1])
  return value && value > 0 ? value : undefined
}

function parseChineseNumber(value: string): number | undefined {
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  }
  if (value === '十') return 10
  if (value.startsWith('十')) return 10 + (map[value[1]] || 0)
  if (value.includes('十')) {
    const [tens, ones] = value.split('十')
    return (map[tens] || 0) * 10 + (ones ? map[ones] || 0 : 0)
  }
  return map[value]
}

function match(text: string, re: RegExp) {
  return text.match(re)?.[1]
}
