const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body || `API ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () =>
    request<{
      ok: boolean
      deepseek: boolean
      dataverseMode: string
      promptVersion: string
    }>('/health'),
  orchestrate: (body: {
    utterance: string
    locale?: string
    context?: Record<string, string>
  }) => request('/orchestrate', { method: 'POST', body: JSON.stringify(body) }),
  listDrafts: () => request<{ drafts: unknown[] }>('/drafts'),
  upsertDraft: (draft: { idempotencyKey: string }) =>
    request(`/drafts/${encodeURIComponent(draft.idempotencyKey)}`, {
      method: 'PUT',
      body: JSON.stringify(draft),
    }),
  confirmDraft: (key: string, fail?: boolean) =>
    request(`/drafts/${encodeURIComponent(key)}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ fail: Boolean(fail) }),
    }),
  discardDraft: (key: string) =>
    request(`/drafts/${encodeURIComponent(key)}/discard`, { method: 'POST', body: '{}' }),
  metrics: () =>
    request<{
      todayVisits: number
      riskOpportunities: number
      pendingSync: number
      openDrafts: number
      draftAdoptionPct: number
    }>('/metrics'),
  accounts: () => request<{ accounts: unknown[] }>('/accounts'),
  account: (id: string) => request(`/accounts/${encodeURIComponent(id)}`),
  opportunities: () =>
    request<{
      opportunities: unknown[]
      dataSource: string
      note?: string
    }>('/opportunities'),
  logs: () => request<{ logs: unknown[] }>('/logs'),
}

export { API_BASE }
