const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api'

function isPowerPlatformHost() {
  if (typeof window === 'undefined') return false
  return /\.powerplatformusercontent\.com$|\.powerapps\.com$/i.test(window.location.hostname)
}

export class ApiRequestError extends Error {
  readonly kind: 'network' | 'http' | 'abort'
  readonly status?: number
  readonly detail?: string

  constructor(
    message: string,
    kind: 'network' | 'http' | 'abort',
    opts?: { status?: number; detail?: string },
  ) {
    super(message)
    this.name = 'ApiRequestError'
    this.kind = kind
    this.status = opts?.status
    this.detail = opts?.detail
  }
}

function isAbortError(err: unknown) {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  )
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      ...init,
    })
  } catch (err) {
    if (isAbortError(err) || init?.signal?.aborted) {
      throw new ApiRequestError('请求已取消', 'abort')
    }
    console.error('[api] fetch failed', path, err)
    if (isPowerPlatformHost() && API_BASE === '/api') {
      throw new ApiRequestError(
        '暂时无法连接服务，请检查网络后重试',
        'network',
        {
          detail:
            '线上 Code App 未配置编排 API：请先部署 server，并用 VITE_API_BASE 指向公网地址后重新构建发布。',
        },
      )
    }
    if (isPowerPlatformHost()) {
      throw new ApiRequestError('暂时无法连接服务，请检查网络后重试', 'network', {
        detail: `无法连接编排 API（${API_BASE}）。请检查 API 是否在线及 CSP connect-src。`,
      })
    }
    throw new ApiRequestError('暂时无法连接服务，请检查网络后重试', 'network', {
      detail: '请先启动 server（npm run dev:all 或 cd server && npm run dev）。',
    })
  }
  if (!res.ok) {
    const body = await res.text()
    console.error('[api] http error', path, res.status, body)
    throw new ApiRequestError('回答生成失败，请稍后重试', 'http', {
      status: res.status,
      detail: body || `API ${res.status}`,
    })
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () =>
    request<{
      ok: boolean
      deepseek: boolean
      aiProvider?: 'deepseek' | 'copilotstudio'
      copilotstudio?: boolean
      dataverseMode: string
      promptVersion: string
    }>('/health'),
  orchestrate: (
    body: {
      utterance: string
      locale?: string
      context?: Record<string, string>
    },
    init?: { signal?: AbortSignal },
  ) =>
    request('/orchestrate', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: init?.signal,
    }),
  copilotMessage: (
    body: {
      utterance: string
      locale?: string
      context?: Record<string, string>
    },
    init?: { signal?: AbortSignal },
  ) =>
    request('/copilot/message', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: init?.signal,
    }),
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
