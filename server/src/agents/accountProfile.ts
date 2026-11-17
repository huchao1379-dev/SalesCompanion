import { chatJson, hasDeepSeek } from '../llm/deepseek.js'
import type { AccountRecord, AgentMessage, SourceRef } from '../types.js'
import { store } from '../store/dataverseStore.js'

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

/** Sync heuristic — also used as DeepSeek fallback. */
export function buildAccountProfileMessage(account: AccountRecord): AgentMessage {
  const { facts, sources, opps, contacts } = profileFacts(account)
  const oppText =
    opps.length === 0
      ? '当前无开放商机种子。'
      : opps
          .map(
            (o) =>
              `${o.productLine}${o.productModel ? ' ' + o.productModel : ''} · ${o.stage} · 信心度 ${(o.confidenceScore * 100).toFixed(0)}%`,
          )
          .join('；')

  const content = [
    `${facts.name}：信用 ${facts.creditLevel}${facts.hasMsa ? '、已签 MSA' : ''}；近 30 天 ${facts.visitCount30d} 次拜访`,
    facts.npsDelta ? `NPS ${facts.npsDelta}` : null,
    facts.lastVisitAt ? `上次接触 ${facts.lastVisitAt.slice(0, 10)}` : null,
    contacts[0]
      ? `主要联系人 ${contacts[0].name}${contacts[0].title ? '（' + contacts[0].title + '）' : ''}`
      : null,
    `开放商机：${oppText}`,
    facts.notes || null,
  ]
    .filter(Boolean)
    .join('。')

  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: 'assistant',
    agent_name: '客户画像 Agent',
    content,
    sources,
    confidence: 0.9,
    agent_chain: ['客户画像 Agent', '商机评估 Agent'],
    createdAt: new Date().toISOString(),
  }
}

/** DeepSeek 摘要合成；无 Key / 失败时回落启发式。 */
export async function synthesizeAccountProfile(
  account: AccountRecord,
  utterance?: string,
): Promise<{ message: AgentMessage; mode: 'deepseek' | 'heuristic' }> {
  const fallback = buildAccountProfileMessage(account)
  if (!hasDeepSeek()) return { message: fallback, mode: 'heuristic' }

  const { facts, sources } = profileFacts(account)
  try {
    const { data, mode } = await chatJson<{ summary: string; confidence?: number }>({
      system: `你是医疗设备销售 CRM 的客户画像 Agent。根据给定事实写一段中文速览（2～4 句），不要编造事实未给出的信息。只输出 JSON：{"summary":"...","confidence":0-1}`,
      user: JSON.stringify({ question: utterance || '客户最近怎么样？', facts }),
      temperature: 0.2,
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
