import type { AccountRecord, AgentMessage, SourceRef } from '../types.js'
import { store } from '../store/dataverseStore.js'

export function resolveAccount(query: string): AccountRecord | undefined {
  const hits = store.searchAccounts(query)
  if (hits.length) return hits[0]
  // loose: try whole utterance tokens
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

export function buildAccountProfileMessage(account: AccountRecord): AgentMessage {
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
    `${account.name}：信用 ${account.creditLevel}${account.hasMsa ? '、已签 MSA' : ''}；近 30 天 ${account.visitCount30d} 次拜访`,
    account.npsDelta ? `NPS ${account.npsDelta}` : null,
    account.lastVisitAt ? `上次接触 ${account.lastVisitAt.slice(0, 10)}` : null,
    contacts[0] ? `主要联系人 ${contacts[0].name}${contacts[0].title ? '（' + contacts[0].title + '）' : ''}` : null,
    `开放商机：${oppText}`,
    account.notes || null,
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
