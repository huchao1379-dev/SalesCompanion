import type { AccountProfile } from '../agents/types'
import { api } from '../api/client'
import {
  getMockAccountProfile,
  loadAccountProfile,
  toLegacyAccountProfile,
} from './accountProfile'

export async function fetchAccountInsight(refOrName: string): Promise<AccountProfile | null> {
  const res = await loadAccountProfile(refOrName)
  return res.view ? toLegacyAccountProfile(res.view) : null
}

export function getAccountInsight(refOrName: string): AccountProfile | null {
  const mock = getMockAccountProfile(refOrName)
  return mock ? toLegacyAccountProfile(mock) : null
}

export function listMockAccounts(): AccountProfile[] {
  return ['SAP-ACC-RENJI', 'SAP-ACC-ALPHA']
    .map((k) => getMockAccountProfile(k))
    .filter(Boolean)
    .map((v) => toLegacyAccountProfile(v!))
}

export async function listAccountsFromApi(): Promise<AccountProfile[]> {
  try {
    const res = (await api.accounts()) as {
      accounts: Array<{
        id: string
        externalKey: string
        name: string
        creditLevel: string
        visitCount30d: number
        npsDelta?: string
        lastVisitAt?: string
        notes?: string
      }>
    }
    return res.accounts.map((a) => ({
      accountRef: a.externalKey,
      accountName: a.name,
      creditRating: a.creditLevel,
      visitCount30d: a.visitCount30d,
      npsDelta: a.npsDelta,
      lastContactAt: a.lastVisitAt?.slice(0, 10),
      openOpportunities: [],
      summary: a.notes || `${a.name} · 信用 ${a.creditLevel}`,
      sources: [{ kind: 'dataverse', label: `${a.name} · Account`, ref: a.externalKey }],
    }))
  } catch {
    return listMockAccounts()
  }
}
