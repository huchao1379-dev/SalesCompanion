import type { AccountProfile, SourceRef } from '../agents/types'
import { api } from '../api/client'

type ApiAccount = {
  id: string
  externalKey: string
  name: string
  creditLevel: string
  visitCount30d: number
  npsDelta?: string
  lastVisitAt?: string
  notes?: string
}

type ApiOpp = {
  name: string
  stage: string
  confidenceScore: number
  productLine: string
  productModel?: string
}

const FALLBACK: Record<string, AccountProfile> = {
  'SAP-ACC-RENJI': {
    accountRef: 'SAP-ACC-RENJI',
    accountName: '上海仁济医院',
    creditRating: 'A',
    visitCount30d: 4,
    npsDelta: '+12',
    lastContactAt: '2026-04-22',
    openOpportunities: [
      { name: '监护仪 N17', stage: 'Identify', confidence: 0.78, productLine: '监护仪 N17' },
    ],
    summary: '信用 A 级、已签 MSA。开放商机以监护仪 N17（Identify）为主。',
    sources: [{ kind: 'dataverse', label: '上海仁济医院 · Account', ref: 'SAP-ACC-RENJI' }],
  },
  'SAP-ACC-ALPHA': {
    accountRef: 'SAP-ACC-ALPHA',
    accountName: 'Hospital Alpha',
    creditRating: 'A',
    visitCount30d: 3,
    npsDelta: '+8',
    lastContactAt: '2026-04-29',
    openOpportunities: [
      { name: 'A1 监护仪 ×8', stage: 'Identify', confidence: 0.78, productLine: 'A1 监护仪' },
    ],
    summary: '今日拜访关注 A3 演示反馈；ICU 升级评估可能在 6 月启动。',
    sources: [{ kind: 'sap', label: 'Hospital Alpha', ref: 'SAP-ACC-ALPHA' }],
  },
}

function toProfile(account: ApiAccount, opps: ApiOpp[] = [], sources: SourceRef[] = []): AccountProfile {
  return {
    accountRef: account.externalKey,
    accountName: account.name,
    creditRating: account.creditLevel,
    visitCount30d: account.visitCount30d,
    npsDelta: account.npsDelta,
    lastContactAt: account.lastVisitAt?.slice(0, 10),
    openOpportunities: opps.map((o) => ({
      name: o.name,
      stage: o.stage,
      confidence: o.confidenceScore,
      productLine: [o.productLine, o.productModel].filter(Boolean).join(' '),
    })),
    summary: account.notes || `${account.name} · 信用 ${account.creditLevel}`,
    sources:
      sources.length > 0
        ? sources
        : [{ kind: 'dataverse', label: `${account.name} · Account`, ref: account.externalKey }],
  }
}

export async function fetchAccountInsight(refOrName: string): Promise<AccountProfile | null> {
  try {
    const res = (await api.account(refOrName)) as {
      account: ApiAccount
      opportunities: ApiOpp[]
      profile?: { sources: SourceRef[]; content: string }
    }
    const profile = toProfile(res.account, res.opportunities, res.profile?.sources)
    if (res.profile?.content) profile.summary = res.profile.content
    return profile
  } catch {
    return getAccountInsight(refOrName)
  }
}

export function getAccountInsight(refOrName: string): AccountProfile | null {
  const key = refOrName.trim()
  if (FALLBACK[key]) return FALLBACK[key]
  const found = Object.values(FALLBACK).find(
    (a) => a.accountName === key || a.accountName.includes(key) || key.includes(a.accountName),
  )
  return found ?? null
}

export function listMockAccounts(): AccountProfile[] {
  return Object.values(FALLBACK)
}

export async function listAccountsFromApi(): Promise<AccountProfile[]> {
  try {
    const res = (await api.accounts()) as { accounts: ApiAccount[] }
    return res.accounts.map((a) => toProfile(a))
  } catch {
    return listMockAccounts()
  }
}
