import { chatJson, hasDeepSeek } from '../llm/deepseek.js'
import type { AccountRecord, AgentMessage, SourceRef } from '../types.js'
import { store } from '../store/dataverseStore.js'
import { ACCOUNT_PROFILE_SYSTEM } from './prompts.js'

export function resolveAccount(query: string): AccountRecord | undefined {
  const hits = store.searchAccounts(query)
  if (hits.length) return hits[0]
  for (const a of store.accounts) {
    if (query.includes(a.name) || query.includes(a.externalKey)) return a
  }
  if (/仁济/.test(query)) return store.getAccount('SAP-ACC-RENJI')
  if (/Alpha/i.test(query)) return store.getAccount('SAP-ACC-ALPHA')
  if (/Beta/i.test(query)) return store.getAccount('SAP-ACC-BETA')
  if (/Gamma/i.test(query)) return store.getAccount('SAP-ACC-GAMMA')
  if (/Delta/i.test(query)) return store.getAccount('SAP-ACC-DELTA')
  return undefined
}

function profileFacts(account: AccountRecord) {
  const opps = store.getOpportunitiesForAccount(account.id)
  const contacts = store.getContactsForAccount(account.id)
  const sources: SourceRef[] = [
    {
      kind: 'dataverse',
      label: `${account.name} · Account`,
      ref: account.externalKey,
      entity: 'crmai_account',
      id: account.id,
    },
    {
      kind: 'dataverse',
      label: `近 30 天拜访 ×${account.visitCount30d}`,
      ref: account.id,
      entity: 'crmai_account',
      id: account.id,
    },
    ...opps.slice(0, 2).map((o) => ({
      kind: 'dataverse' as const,
      label: `${o.name} · ${o.stage}`,
      ref: o.externalKey,
      entity: 'crmai_opportunity',
      id: o.id,
    })),
  ]

  const facts = {
    name: account.name,
    creditLevel: account.creditLevel,
    hasMsa: account.hasMsa,
    visitCount30d: account.visitCount30d,
    npsDelta: account.npsDelta,
    lastVisitAt: account.lastVisitAt,
    notes: account.notes,
    contacts: contacts.map((c) => ({ name: c.name, title: c.title })),
    opportunities: opps.map((o) => ({
      name: o.name,
      productLine: o.productLine,
      productModel: o.productModel,
      stage: o.stage,
      confidenceScore: o.confidenceScore,
    })),
  }

  return { facts, sources, opps, contacts }
}

function detectProfileFocus(utterance?: string) {
  const t = utterance || ''
  if (/信用|评级|MSA|msa/.test(t)) return 'credit' as const
  if (/商机|机会|pipeline|阶段|定标/.test(t)) return 'opportunities' as const
  if (/联系人|主任|谁负责|对接/.test(t)) return 'contacts' as const
  if (/拜访|近访|上次|最近|NPS|nps/.test(t)) return 'visits' as const
  return 'overview' as const
}

/** Sync heuristic — also used as DeepSeek fallback. Varies by question focus. */
export function buildAccountProfileMessage(
  account: AccountRecord,
  utterance?: string,
): AgentMessage {
  const { facts, sources, opps, contacts } = profileFacts(account)
  const focus = detectProfileFocus(utterance)
  const oppText =
    opps.length === 0
      ? '当前无开放商机种子'
      : opps
          .map(
            (o) =>
              `${o.productLine}${o.productModel ? ' ' + o.productModel : ''} · ${o.stage} · 信心度 ${(o.confidenceScore * 100).toFixed(0)}%`,
          )
          .join('；')
  const contactLine = contacts[0]
    ? `${contacts[0].name}${contacts[0].title ? '（' + contacts[0].title + '）' : ''}`
    : '暂无联系人种子'

  let content: string
  switch (focus) {
    case 'credit':
      content = `${facts.name} 信用等级 ${facts.creditLevel}${facts.hasMsa ? '，已签 MSA' : '，MSA 状态未标注'}。近 30 天拜访 ${facts.visitCount30d} 次${facts.notes ? `；备注：${facts.notes}` : ''}。若还要看开放商机，可以直接问我。`
      break
    case 'opportunities':
      content = `${facts.name} 当前开放商机：${oppText}。信用 ${facts.creditLevel}，近 30 天 ${facts.visitCount30d} 次拜访——评估推进时可一并参考。`
      break
    case 'contacts':
      content = `${facts.name} 主要对接人：${contactLine}。客户信用 ${facts.creditLevel}${facts.lastVisitAt ? `，上次接触 ${facts.lastVisitAt.slice(0, 10)}` : ''}。`
      break
    case 'visits':
      content = `${facts.name} 近 30 天拜访 ${facts.visitCount30d} 次${facts.lastVisitAt ? `，上次接触 ${facts.lastVisitAt.slice(0, 10)}` : ''}${facts.npsDelta ? `，NPS ${facts.npsDelta}` : ''}。开放商机：${oppText}。`
      break
    default:
      content = [
        `先说结论：${facts.name} 目前信用 ${facts.creditLevel}${facts.hasMsa ? '（已签 MSA）' : ''}。`,
        `近 30 天 ${facts.visitCount30d} 次拜访${facts.lastVisitAt ? `，上次 ${facts.lastVisitAt.slice(0, 10)}` : ''}；对接人 ${contactLine}。`,
        `开放商机：${oppText}${facts.notes ? `。备注：${facts.notes}` : ''}。`,
      ].join('')
  }

  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: 'assistant',
    agent_name: '客户画像 Agent',
    content,
    sources,
    confidence: 0.9,
    agent_chain: ['客户画像 Agent'],
    createdAt: new Date().toISOString(),
  }
}

/** DeepSeek 摘要合成；无 Key / 失败时回落启发式。 */
export async function synthesizeAccountProfile(
  account: AccountRecord,
  utterance?: string,
): Promise<{ message: AgentMessage; mode: 'deepseek' | 'heuristic' }> {
  const fallback = buildAccountProfileMessage(account, utterance)
  if (!hasDeepSeek()) return { message: fallback, mode: 'heuristic' }

  const { facts, sources } = profileFacts(account)
  try {
    const { data, mode } = await chatJson<{
      summary: string
      confidence?: number
      emphasis?: string
    }>({
      system: ACCOUNT_PROFILE_SYSTEM,
      user: JSON.stringify({
        question: utterance || '客户最近怎么样？',
        focusHint: detectProfileFocus(utterance),
        facts,
        instruction: '按问题重点组织答案，避免每次输出同一段固定套话。',
      }),
      temperature: 0.4,
    })
    if (!data.summary?.trim()) return { message: fallback, mode: 'heuristic' }
    return {
      mode,
      message: {
        ...fallback,
        content: data.summary.trim(),
        confidence: clamp(data.confidence ?? 0.88),
        sources,
      },
    }
  } catch {
    return { message: fallback, mode: 'heuristic' }
  }
}

function clamp(n: number) {
  return Math.max(0, Math.min(1, n))
}
