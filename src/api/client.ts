const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api'

function isPowerPlatformHost() {
  if (typeof window === 'undefined') return false
  return /\.powerplatformusercontent\.com$|\.powerapps\.com$/i.test(window.location.hostname)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      ...init,
    })
  } catch {
    if (isPowerPlatformHost() && API_BASE === '/api') {
      throw new Error(
        '线上 Code App 未配置编排 API：请先部署 server，并用 VITE_API_BASE 指向公网地址后重新构建发布。相对路径 /api 在 Power Platform 上不存在。',
      )
    }
    if (isPowerPlatformHost()) {
      throw new Error(
        `无法连接编排 API（${API_BASE}）。请检查 API 是否在线，以及 Power Platform CSP connect-src 是否允许该域名（不要只加 api.deepseek.com）。`,
      )
    }
    throw new Error('无法连接编排服务。请先启动 server（npm run dev:all 或 cd server && npm run dev）。')
  }
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
