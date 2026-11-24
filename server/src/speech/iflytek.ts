/**
 * 讯飞语音听写（流式版）WebAPI — 服务端只负责鉴权签票，密钥不下发前端。
 * @see https://www.xfyun.cn/doc/asr/voicedictation/API.html
 */
import crypto from 'node:crypto'
import { config, hasIFlytek } from '../config.js'

const IAT_HOST = 'iat-api.xfyun.cn'
const IAT_PATH = '/v2/iat'
const IAT_BASE = `wss://${IAT_HOST}${IAT_PATH}`

/** RFC1123 / GMT，与 Node 的 toUTCString 一致（讯飞要求 UTC+0）。 */
function rfc1123Date(date = new Date()) {
  return date.toUTCString()
}

export function buildIFlytekIatAuthUrl(opts?: {
  apiKey?: string
  apiSecret?: string
  hostUrl?: string
}): string {
  const apiKey = opts?.apiKey || config.iflytekApiKey
  const apiSecret = opts?.apiSecret || config.iflytekApiSecret
  const hostUrl = opts?.hostUrl || IAT_BASE
  if (!apiKey || !apiSecret) {
    throw new Error('讯飞语音未配置：请设置 IFLYTEK_APP_ID / IFLYTEK_API_KEY / IFLYTEK_API_SECRET')
  }

  const url = new URL(hostUrl)
  const date = rfc1123Date()
  const signatureOrigin = [
    `host: ${url.host}`,
    `date: ${date}`,
    `GET ${url.pathname} HTTP/1.1`,
  ].join('\n')

  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(signatureOrigin)
    .digest('base64')

  // 文档示例含逗号后空格；须与示例一致，否则鉴权 401。
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
  const authorization = Buffer.from(authorizationOrigin, 'utf8').toString('base64')

  // 官方示例用 %20 而非 +（URLSearchParams 会把空格编成 +，部分握手会鉴权失败）
  const query =
    `authorization=${encodeURIComponent(authorization)}` +
    `&date=${encodeURIComponent(date)}` +
    `&host=${encodeURIComponent(url.host)}`
  return `${hostUrl}?${query}`
}

export type IFlytekIatTicket = {
  provider: 'iflytek'
  /**
   * 浏览器应连接的 WebSocket 地址。
   * 默认走服务端代理路径（相对 `/api/...`），避免移动端 CSP/WebView 拦讯飞域名。
   */
  url: string
  /**
   * http = fetch+SSE（适配 Power Apps CSP 仅 https）；
   * ws = WebSocket 代理（需 CSP 放行 wss://你的API）。
   */
  transport: 'http' | 'ws'
  /** proxy = 连自家 API；direct = 直连讯飞（仅调试） */
  wsMode: 'proxy' | 'direct'
  /** 相对 API 根的代理路径，如 `/speech/iat/ws`（配合 VITE_API_BASE） */
  proxyPath: string
  appId: string
  host: string
  /** 推荐音频参数，供前端对齐 */
  audio: {
    sampleRate: 16000
    format: 'audio/L16;rate=16000'
    encoding: 'raw'
    frameBytes: 1280
    frameIntervalMs: 40
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

/** 相对 apiRouter 挂载点 `/api` 的路径 */
export const IFLYTEK_IAT_PROXY_ROUTE = '/speech/iat/ws'

export function issueIFlytekIatTicket(): IFlytekIatTicket {
  if (!hasIFlytek()) {
    throw new Error('讯飞语音未配置')
  }
  const issuedAt = new Date()
  // 讯飞允许 date 偏差约 300s；前端应尽快连接。
  const expiresAt = new Date(issuedAt.getTime() + 4 * 60 * 1000)
  return {
    provider: 'iflytek',
    // 默认 HTTP：Power Apps connect-src 常只有 https://你的API，没有 wss://。
    url: IFLYTEK_IAT_PROXY_ROUTE,
    transport: 'http',
    wsMode: 'proxy',
    proxyPath: IFLYTEK_IAT_PROXY_ROUTE,
    appId: config.iflytekAppId,
    host: IAT_HOST,
    audio: {
      sampleRate: 16000,
      format: 'audio/L16;rate=16000',
      encoding: 'raw',
      frameBytes: 1280,
      frameIntervalMs: 40,
    },
    business: {
      language: config.iflytekLanguage,
      domain: config.iflytekDomain,
      accent: config.iflytekAccent,
      dwa: config.iflytekDwa,
      vadEos: config.iflytekVadEos,
    },
    expiresAt: expiresAt.toISOString(),
  }
}
