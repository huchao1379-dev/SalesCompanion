/**
 * Optional live web tools for GeneralAssist.
 * Search requires WEB_SEARCH_API_KEY; fetch is gated by hasWebFetch().
 */
import { z } from 'zod'
import { config, hasWebFetch, hasWebSearch } from '../config.js'
import type { ChatTool } from '../llm/deepseek.js'

const SEARCH_TIMEOUT_MS = 8_000
const FETCH_TIMEOUT_MS = 8_000
const FETCH_MAX_CHARS = 8_000

const webSearchArgsSchema = z.object({
  query: z.string().min(1).max(200),
})

const webFetchArgsSchema = z.object({
  url: z.string().url().max(500),
})

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '::1'
  ) {
    return true
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function runSerperSearch(query: string) {
  const base = config.webSearchBaseUrl || 'https://google.serper.dev'
  const res = await fetch(`${base}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': config.webSearchApiKey,
    },
    body: JSON.stringify({ q: query, num: 5 }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Serper search failed (${res.status})`)
  const data = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>
  }
  return (data.organic || []).slice(0, 5).map((item) => ({
    title: item.title || '',
    url: item.link || '',
    snippet: item.snippet || '',
  }))
}

async function runTavilySearch(query: string) {
  const base = config.webSearchBaseUrl || 'https://api.tavily.com'
  const res = await fetch(`${base}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.webSearchApiKey,
      query,
      max_results: 5,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Tavily search failed (${res.status})`)
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>
  }
  return (data.results || []).slice(0, 5).map((item) => ({
    title: item.title || '',
    url: item.url || '',
    snippet: item.content || '',
  }))
}

export async function webSearch(query: string) {
  if (!hasWebSearch()) {
    return {
      enabled: false,
      results: [] as Array<{ title: string; url: string; snippet: string }>,
      note: '未配置 WEB_SEARCH_API_KEY，无法实时检索网页。',
    }
  }
  const provider = config.webSearchProvider === 'tavily' ? 'tavily' : 'serper'
  const results =
    provider === 'tavily' ? await runTavilySearch(query) : await runSerperSearch(query)
  return { enabled: true, provider, results }
}

export async function webFetch(url: string) {
  if (!hasWebFetch()) {
    return { enabled: false, url, text: '', note: '网页抓取未启用（WEB_FETCH_ENABLED / 搜索 Key）。' }
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { enabled: true, url, text: '', error: 'Invalid URL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { enabled: true, url, text: '', error: 'Only http(s) URLs are allowed' }
  }
  if (isPrivateHost(parsed.hostname)) {
    return { enabled: true, url, text: '', error: 'Private / local hosts are blocked' }
  }
  const res = await fetch(parsed.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': 'SalesCompanion-Demo/1.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    return { enabled: true, url, text: '', error: `Fetch failed (${res.status})` }
  }
  const contentType = res.headers.get('content-type') || ''
  const raw = await res.text()
  const text = (contentType.includes('html') ? stripHtml(raw) : raw).slice(0, FETCH_MAX_CHARS)
  return {
    enabled: true,
    url: parsed.toString(),
    contentType,
    text,
    truncated: raw.length > FETCH_MAX_CHARS,
  }
}

export const webSearchTool: ChatTool = {
  name: 'web_search',
  description:
    '检索公开网页摘要（需配置 WEB_SEARCH_API_KEY）。用于实时政策、产品公开信息、行业新闻；不用于编造 CRM 客户事实。',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: '搜索关键词' } },
    required: ['query'],
    additionalProperties: false,
  },
  inputSchema: webSearchArgsSchema,
  async execute(input) {
    const { query } = webSearchArgsSchema.parse(input)
    try {
      return await webSearch(query)
    } catch (error) {
      return {
        enabled: true,
        results: [],
        error: error instanceof Error ? error.message : 'search failed',
      }
    }
  },
}

export const webFetchTool: ChatTool = {
  name: 'web_fetch',
  description:
    '抓取指定 https 页面的可读文本摘要。仅在用户给出明确 URL，或搜索结果需要展开时使用。',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: '完整 http(s) URL' } },
    required: ['url'],
    additionalProperties: false,
  },
  inputSchema: webFetchArgsSchema,
  async execute(input) {
    const { url } = webFetchArgsSchema.parse(input)
    try {
      return await webFetch(url)
    } catch (error) {
      return {
        enabled: true,
        url,
        text: '',
        error: error instanceof Error ? error.message : 'fetch failed',
      }
    }
  },
}

export function generalAssistTools(): ChatTool[] {
  const tools: ChatTool[] = []
  if (hasWebSearch()) tools.push(webSearchTool)
  if (hasWebFetch()) tools.push(webFetchTool)
  return tools
}
