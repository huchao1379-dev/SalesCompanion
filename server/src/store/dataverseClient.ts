import { config } from '../config.js'

type TokenCache = {
  accessToken: string
  expiresAt: number
}

let tokenCache: TokenCache | null = null

export class DataverseHttpError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string, method: string, path: string) {
    super(`Dataverse ${method} ${path} → ${status}: ${body.slice(0, 400)}`)
    this.name = 'DataverseHttpError'
    this.status = status
    this.body = body
  }
}

function apiRoot(): string {
  const base = config.dataverseUrl.replace(/\/$/, '')
  if (base.includes('/api/data/')) return base
  return `${base}/api/data/v9.2`
}

function orgUrl(): string {
  return config.dataverseUrl.replace(/\/$/, '').replace(/\/api\/data\/v9\.\d+$/i, '')
}

async function resolveAccessToken(): Promise<string> {
  if (config.dataverseToken) return config.dataverseToken

  const { dataverseTenantId, dataverseClientId, dataverseClientSecret } = config
  if (!dataverseTenantId || !dataverseClientId || !dataverseClientSecret) {
    throw new Error(
      'Dataverse auth missing: set DATAVERSE_TOKEN or DATAVERSE_TENANT_ID + CLIENT_ID + CLIENT_SECRET',
    )
  }

  const now = Date.now()
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken
  }

  const scope = `${orgUrl()}/.default`
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: dataverseClientId,
    client_secret: dataverseClientSecret,
    scope,
  })
  const tokenUrl = `https://login.microsoftonline.com/${dataverseTenantId}/oauth2/v2.0/token`
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Dataverse token request failed ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = JSON.parse(text) as { access_token: string; expires_in?: number }
  tokenCache = {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  }
  return tokenCache.accessToken
}

export type DataverseQuery = {
  select?: string[]
  filter?: string
  orderby?: string
  top?: number
  expand?: string
}

function buildQuery(q?: DataverseQuery): string {
  if (!q) return ''
  const parts: string[] = []
  if (q.select?.length) parts.push(`$select=${q.select.join(',')}`)
  if (q.filter) parts.push(`$filter=${encodeURIComponent(q.filter)}`)
  if (q.orderby) parts.push(`$orderby=${encodeURIComponent(q.orderby)}`)
  if (q.top != null) parts.push(`$top=${q.top}`)
  if (q.expand) parts.push(`$expand=${q.expand}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

export async function dataverseRequest<T = unknown>(
  method: string,
  entityPath: string,
  options?: {
    body?: unknown
    query?: DataverseQuery
    headers?: Record<string, string>
  },
): Promise<{ status: number; data: T; headers: Headers }> {
  const token = await resolveAccessToken()
  const path = entityPath.startsWith('/') ? entityPath : `/${entityPath}`
  const url = `${apiRoot()}${path}${buildQuery(options?.query)}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
    ...options?.headers,
  }
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new DataverseHttpError(res.status, text, method, path)
  }
  const data = (text ? JSON.parse(text) : null) as T
  return { status: res.status, data, headers: res.headers }
}

export async function dataverseList<T extends Record<string, unknown>>(
  entitySet: string,
  query?: DataverseQuery,
): Promise<T[]> {
  const { data } = await dataverseRequest<{ value: T[] }>('GET', entitySet, { query })
  return data?.value ?? []
}

export async function dataverseGet<T extends Record<string, unknown>>(
  entitySet: string,
  id: string,
  query?: DataverseQuery,
): Promise<T | undefined> {
  try {
    const { data } = await dataverseRequest<T>('GET', `${entitySet}(${id})`, { query })
    return data
  } catch (err) {
    if (err instanceof DataverseHttpError && err.status === 404) return undefined
    throw err
  }
}

export async function dataverseCreate<T extends Record<string, unknown>>(
  entitySet: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data } = await dataverseRequest<T>('POST', entitySet, {
    body,
    headers: { Prefer: 'return=representation' },
  })
  return data
}

export async function dataversePatch<T extends Record<string, unknown>>(
  entitySet: string,
  id: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data } = await dataverseRequest<T>('PATCH', `${entitySet}(${id})`, {
    body,
    headers: {
      Prefer: 'return=representation',
      'If-Match': '*',
    },
  })
  return data
}

export function odataEscape(value: string): string {
  return value.replace(/'/g, "''")
}

export function lookupBind(entitySet: string, id: string): string {
  return `/${entitySet}(${id})`
}
