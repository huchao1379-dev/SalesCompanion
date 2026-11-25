/**
 * 讯飞在线语音合成（流式版）— 服务端合成 MP3，前端用 Audio 播放（国内可用，不依赖 Google）。
 * @see https://www.xfyun.cn/doc/tts/online_tts/API.html
 */
import { WebSocket } from 'ws'
import { config, hasIFlytek } from '../config.js'
import { buildIFlytekAuthUrl } from './iflytek.js'

const TTS_HOST = 'tts-api.xfyun.cn'
const TTS_PATH = '/v2/tts'
const TTS_BASE = `wss://${TTS_HOST}${TTS_PATH}`

/** 单次合成上限约 8000 字节；留余量按 UTF-8 截断。 */
const MAX_TEXT_BYTES = 7500

type TtsServerFrame = {
  code?: number
  message?: string
  sid?: string
  data?: {
    audio?: string
    status?: number
    ced?: string
  } | null
}

export type IFlytekTtsResult = {
  provider: 'iflytek'
  mimeType: 'audio/mpeg'
  encoding: 'lame'
  voice: string
  audioBase64: string
  byteLength: number
}

function truncateUtf8(text: string, maxBytes: number) {
  const buf = Buffer.from(text, 'utf8')
  if (buf.byteLength <= maxBytes) return text
  let end = maxBytes
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1
  return buf.subarray(0, end).toString('utf8')
}

function mapRateToSpeed(rate?: number) {
  // Browser speechSynthesis rate ~0.5–2 → 讯飞 speed 0–100（默认 50）。
  if (rate == null || !Number.isFinite(rate)) return 50
  const clamped = Math.max(0.5, Math.min(2, rate))
  return Math.round(25 + (clamped - 0.5) * (50 / 1.5))
}

/**
 * 一次性文本 → MP3。密钥只留服务端；浏览器走 POST /api/speech/tts。
 */
export function synthesizeIFlytekTts(
  text: string,
  opts?: { voice?: string; rate?: number; timeoutMs?: number },
): Promise<IFlytekTtsResult> {
  if (!hasIFlytek()) {
    return Promise.reject(new Error('讯飞语音未配置'))
  }
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) {
    return Promise.reject(new Error('合成文本为空'))
  }

  const payloadText = truncateUtf8(trimmed, MAX_TEXT_BYTES)
  const voice = (opts?.voice || config.iflytekTtsVcn || 'xiaoyan').trim() || 'xiaoyan'
  const timeoutMs = opts?.timeoutMs ?? 45_000
  const authUrl = buildIFlytekAuthUrl({ hostUrl: TTS_BASE })

  return new Promise<IFlytekTtsResult>((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (err?: Error, result?: IFlytekTtsResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        ws.close(1000)
      } catch {
        /* ignore */
      }
      if (err) reject(err)
      else if (result) resolve(result)
      else reject(new Error('讯飞合成失败'))
    }

    const ws = new WebSocket(authUrl)

    timer = setTimeout(() => {
      finish(new Error('讯飞合成超时'))
    }, timeoutMs)

    ws.on('open', () => {
      const frame = {
        common: { app_id: config.iflytekAppId },
        business: {
          aue: 'lame',
          sfl: 1,
          auf: 'audio/L16;rate=16000',
          vcn: voice,
          speed: mapRateToSpeed(opts?.rate),
          volume: 50,
          pitch: 50,
          bgs: 0,
          tte: 'UTF8',
        },
        data: {
          status: 2,
          text: Buffer.from(payloadText, 'utf8').toString('base64'),
        },
      }
      ws.send(JSON.stringify(frame))
    })

    ws.on('message', (raw) => {
      let payload: TtsServerFrame
      try {
        payload = JSON.parse(String(raw)) as TtsServerFrame
      } catch {
        finish(new Error('讯飞合成返回无法解析'))
        return
      }
      if (payload.code && payload.code !== 0) {
        finish(
          new Error(
            `讯飞合成错误 ${payload.code}：${payload.message || 'unknown'}`,
          ),
        )
        return
      }
      const audioB64 = payload.data?.audio
      if (audioB64) {
        try {
          chunks.push(Buffer.from(audioB64, 'base64'))
        } catch {
          /* ignore bad chunk */
        }
      }
      if (payload.data?.status === 2) {
        const buffer = Buffer.concat(chunks)
        if (!buffer.byteLength) {
          finish(new Error('讯飞合成未返回音频'))
          return
        }
        finish(undefined, {
          provider: 'iflytek',
          mimeType: 'audio/mpeg',
          encoding: 'lame',
          voice,
          audioBase64: buffer.toString('base64'),
          byteLength: buffer.byteLength,
        })
      }
    })

    ws.on('error', (err) => {
      finish(err instanceof Error ? err : new Error('讯飞合成连接失败'))
    })

    ws.on('close', () => {
      if (settled) return
      if (chunks.length) {
        const buffer = Buffer.concat(chunks)
        finish(undefined, {
          provider: 'iflytek',
          mimeType: 'audio/mpeg',
          encoding: 'lame',
          voice,
          audioBase64: buffer.toString('base64'),
          byteLength: buffer.byteLength,
        })
        return
      }
      finish(new Error('讯飞合成连接已关闭'))
    })
  })
}
