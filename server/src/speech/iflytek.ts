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
  /** 短时有效的鉴权 WebSocket URL（含 signature，约 5 分钟内有效） */
  url: string
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

export function issueIFlytekIatTicket(): IFlytekIatTicket {
  if (!hasIFlytek()) {
    throw new Error('讯飞语音未配置')
  }
  const issuedAt = new Date()
  // 讯飞允许 date 偏差约 300s；前端应尽快连接。
  const expiresAt = new Date(issuedAt.getTime() + 4 * 60 * 1000)
  return {
    provider: 'iflytek',
    url: buildIFlytekIatAuthUrl(),
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
