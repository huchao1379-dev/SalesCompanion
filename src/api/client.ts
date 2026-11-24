import type { DraftPayload } from '../agents/types'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api'
const CAPABILITY_CACHE_MS = 60_000

type ApiHealth = {
  ok: boolean
  deepseek: boolean
  openai?: boolean
  llm?: boolean
  llmModel?: string
  vision?: boolean
  visionModel?: string
  aiProvider?: 'deepseek' | 'openai' | 'copilotstudio'
  copilotstudio?: boolean
  dataverseMode: string
  promptVersion: string
  speechProvider?: 'iflytek' | 'webspeech'
  iflytek?: boolean
  capabilities?: {
    activityInsight?: boolean
    opportunityInsight?: boolean
    generalAssist?: boolean
    webSearch?: boolean
    webFetch?: boolean
    speechIFlytek?: boolean
  }
}

export type IFlytekIatTicket = {
  provider: 'iflytek'
  url: string
  wsMode?: 'proxy' | 'direct'
  proxyPath?: string
  appId: string
  host: string
  audio: {
    sampleRate: number
    format: string
    encoding: string
    frameBytes: number
    frameIntervalMs: number
  }
  business: {
    language: string
    domain: string
    accent: string
    dwa: string
    vadEos: number
  }
  expiresAt: string
}

/** 把 HTTP(S) API_BASE 转成浏览器应连接的讯飞代理 WSS 地址。 */
export function resolveIFlytekIatWsUrl(ticket: Pick<IFlytekIatTicket, 'url' | 'wsMode' | 'proxyPath'>) {
  // 旧票据若仍下发讯飞直连 URL，则沿用（仅本地调试）。
  if (ticket.wsMode === 'direct' || /^wss?:\/\//i.test(ticket.url)) {
    return ticket.url
  }
  const path = ticket.proxyPath || ticket.url || '/speech/iat/ws'
  const joined = path.startsWith('/') ? `${API_BASE}${path}` : `${API_BASE}/${path}`
  if (/^https:\/\//i.test(joined)) return joined.replace(/^https/i, 'wss')
  if (/^http:\/\//i.test(joined)) return joined.replace(/^http/i, 'ws')
  // 相对路径：跟当前页面同源（本地 Vite 代理 / 同域部署）
  if (typeof window === 'undefined') return joined
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${joined.startsWith('/') ? joined : `/${joined}`}`
}

let activityInsightCapability:
  | { supported: boolean; expiresAt: number }
  | undefined
let activityInsightCapabilityRequest: Promise<boolean> | undefined

let opportunityInsightCapability:
  | { supported: boolean; expiresAt: number }
  | undefined
let opportunityInsightCapabilityRequest: Promise<boolean> | undefined

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

async function supportsActivityInsight(): Promise<boolean> {
  const now = Date.now()
  if (activityInsightCapability && activityInsightCapability.expiresAt > now) {
    return activityInsightCapability.supported
  }
  if (activityInsightCapabilityRequest) return activityInsightCapabilityRequest

  activityInsightCapabilityRequest = request<ApiHealth>('/health')
    .then((health) => health.capabilities?.activityInsight === true)
    .catch(() => false)
    .then((supported) => {
      activityInsightCapability = {
        supported,
        expiresAt: Date.now() + CAPABILITY_CACHE_MS,
      }
      return supported
    })
    .finally(() => {
      activityInsightCapabilityRequest = undefined
    })

  return activityInsightCapabilityRequest
}

async function supportsOpportunityInsight(): Promise<boolean> {
  const now = Date.now()
  if (opportunityInsightCapability && opportunityInsightCapability.expiresAt > now) {
    return opportunityInsightCapability.supported
  }
  if (opportunityInsightCapabilityRequest) return opportunityInsightCapabilityRequest

  opportunityInsightCapabilityRequest = request<ApiHealth>('/health')
    .then((health) => health.capabilities?.opportunityInsight === true)
    .catch(() => false)
    .then((supported) => {
      opportunityInsightCapability = {
        supported,
        expiresAt: Date.now() + CAPABILITY_CACHE_MS,
      }
      return supported
    })
    .finally(() => {
      opportunityInsightCapabilityRequest = undefined
    })

  return opportunityInsightCapabilityRequest
}

type InsightApiResponse = {
  summary: string
  signals: Array<{
    id: string
    label: string
    value: string
    tone: 'neutral' | 'positive' | 'pending' | 'risk' | 'ai'
    source: 'activity' | 'opportunity' | 'visit' | 'ai' | 'derived'
  }>
  pendingChecks: Array<{
    id: string
    text: string
    source: 'missing_crm_field' | 'activity_notes' | 'ai' | 'opportunity' | 'visit'
  }>
  actions: Array<{
    id: string
    title: string
    description?: string
    priority: 'immediate' | 'this_week' | 'later'
    ownerName?: string | null
    contactName?: string | null
    dueAt?: string | null
    dueLabel?: string | null
    source?: string
    actionType?: 'follow_up' | 'log_activity' | 'opportunity' | 'meeting' | 'material' | 'other'
  }>
  updatedAt: string
  mode: 'deepseek' | 'openai' | 'heuristic' | 'copilotstudio'
  agentName: string
  confidence?: number
}

export const api = {
  health: () => request<ApiHealth>('/health'),
  /** Short-lived 讯飞听写 WebSocket URL (APISecret stays on server). */
  speechIatTicket: async () => {
    try {
      return await request<IFlytekIatTicket>('/speech/iat/ticket')
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 503) {
        throw new ApiRequestError('讯飞语音未配置（请在 server/.env 填写 IFLYTEK_*）', 'http', {
          status: 503,
          detail: err.detail,
        })
      }
      throw err
    }
  },
  supportsActivityInsight,
  supportsOpportunityInsight,
  orchestrate: (
    body: {
      utterance: string
      locale?: string
      context?: Record<string, string>
      turnId?: string
      attachments?: Array<{ name: string; mimeType: string; dataBase64: string }>
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
      turnId?: string
      attachments?: Array<{ name: string; mimeType: string; dataBase64: string }>
    },
    init?: { signal?: AbortSignal },
  ) =>
    request('/copilot/message', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: init?.signal,
    }),
  listDrafts: () => request<{ drafts: unknown[] }>('/drafts'),
  upsertDraft: (draft: DraftPayload) =>
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
      invocationCount: number
      byPromptVersion: Record<
        string,
        { count: number; success: number; latencyMs: number; avgLatencyMs: number }
      >
      byAgent: Record<string, { count: number; success: number; fallback: number }>
      business: {
        todayVisits: number
        riskOpportunities: number
        pendingSync: number
        openDrafts: number
        draftAdoptionPct: number
        accountCount?: number
        opportunityCount?: number
      }
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
  activityInsight: (body: {
    activity: {
      id: string
      title: string
      type: string
      status: string
      time?: string
      location?: string
      orgName: string
      orgIndustry?: string
      notes?: string
      contacts?: Array<{ name: string; role?: string }>
    }
    recentVisits?: Array<{
      title: string
      time?: string
      status?: string
      notes?: string
    }>
    refreshNonce?: string
  }) =>
    request<
      InsightApiResponse & {
        evidence: {
          activityIncluded: boolean
          opportunityCount: number
          recentVisitCount: number
          crmUpdatedAt: string | null
        }
        opportunityCount?: number
        visitCount?: number
      }
    >('/activity-insight', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  opportunityInsight: (body: {
    opportunity: {
      id: string
      name: string
      accountName: string
      accountRef?: string
      stage: string
      amount?: number
      currency?: string
      closeDate?: string
      productLine?: string
      quantity?: number
      ownerName?: string
      contactName?: string
      syncLabel?: string
      kind?: 'pipeline' | 'draft'
      budgetStatus?: string
      competition?: string
      missingForNextStage?: string[]
      supervisorHints?: string[]
      lastVisit?: {
        date: string
        sentiment?: 'positive' | 'neutral' | 'risk'
        summary?: string
      } | null
      winForecast?: { probability: number; source: 'crm' | 'ai' } | null
      contacts?: Array<{ name: string; role?: string; title?: string }>
    }
    recentVisits?: Array<{
      title: string
      time?: string
      status?: string
      notes?: string
    }>
    refreshNonce?: string
  }) =>
    request<
      InsightApiResponse & {
        evidence: {
          opportunityIncluded: boolean
          recentVisitCount: number
          missingFieldCount: number
          crmUpdatedAt: string | null
        }
        visitCount?: number
        missingFieldCount?: number
      }
    >('/opportunity-insight', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

export { API_BASE }
