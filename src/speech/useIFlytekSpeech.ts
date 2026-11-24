/**
 * 讯飞语音听写（流式版）— 浏览器采 PCM → 短时签票 → 直连 iat-api.xfyun.cn。
 * 与 useWebSpeech 暴露同一 SpeechRecognitionState 契约。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api,
  preferIFlytekHttpTransport,
  resolveIFlytekIatWsUrl,
} from '../api/client'
import type { SpeechErrorKind, SpeechRecognitionState, StopOptions } from './types'

type IatLink = {
  ready: boolean
  send: (payload: Record<string, unknown>) => boolean
  close: () => void
}

type IatServerPayload = {
  code?: number
  message?: string
  ready?: boolean
  data?: { status?: number; result?: IatWsResult }
}

const DEFAULT_GRACE_MS = 280
const DEFAULT_SETTLE_MS = 2500
const TARGET_RATE = 16000
const FRAME_BYTES = 1280 // 40ms @ 16kHz mono 16-bit

/** Map BCP-47 / common aliases → 讯飞 business.language（如 zh_cn、en_us）。 */
export function toIFlytekLanguage(lang?: string): string | undefined {
  if (!lang?.trim()) return undefined
  const raw = lang.trim().replace(/-/g, '_').toLowerCase()
  const map: Record<string, string> = {
    zh: 'zh_cn',
    zh_cn: 'zh_cn',
    zh_tw: 'zh_cn',
    zh_hk: 'zh_cn',
    en: 'en_us',
    en_us: 'en_us',
    en_gb: 'en_us',
    ja: 'ja_jp',
    ja_jp: 'ja_jp',
    ko: 'ko_kr',
    ko_kr: 'ko_kr',
  }
  if (map[raw]) return map[raw]
  if (map[raw.slice(0, 2)]) return map[raw.slice(0, 2)]
  return raw.includes('_') ? raw : undefined
}

type IatTicket = {
  url: string
  transport?: 'http' | 'ws'
  wsMode?: 'proxy' | 'direct'
  proxyPath?: string
  appId: string
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
}

type IatWsResult = {
  sn?: number
  ls?: boolean
  pgs?: string
  rg?: number[]
  ws?: Array<{ cw?: Array<{ w?: string }> }>
}

function joinTranscript(base: string, chunk: string) {
  const a = base.trimEnd()
  const b = chunk.trim()
  if (!b) return a
  if (!a) return b
  const needsSpace = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b)
  return needsSpace ? `${a} ${b}` : `${a}${b}`
}

function extractWords(result: IatWsResult | undefined): string {
  if (!result?.ws?.length) return ''
  return result.ws
    .map((item) => (item.cw || []).map((cw) => cw.w || '').join(''))
    .join('')
}

/** Linear resample Float32 mono → Int16 PCM at targetRate. */
function floatTo16kPcm(input: Float32Array, inputRate: number): Int16Array {
  if (inputRate === TARGET_RATE) {
    const out = new Int16Array(input.length)
    for (let i = 0; i < input.length; i += 1) {
      const s = Math.max(-1, Math.min(1, input[i]))
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return out
  }
  const ratio = inputRate / TARGET_RATE
  const outLength = Math.max(1, Math.floor(input.length / ratio))
  const out = new Int16Array(outLength)
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i * ratio
    const i0 = Math.floor(srcIndex)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = srcIndex - i0
    const sample = input[i0] * (1 - frac) + input[i1] * frac
    const s = Math.max(-1, Math.min(1, sample))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function mapMediaError(err: unknown): { kind: SpeechErrorKind; message: string } {
  const name = err instanceof DOMException ? err.name : ''
  const message = err instanceof Error ? err.message : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      kind: 'not-allowed',
      message: '麦克风权限被拒绝，请在系统设置中允许后重试，或改用键盘输入',
    }
  }
  if (
    name === 'SecurityError' ||
    /operation is insecure|not allowed by this document|secure context/i.test(message)
  ) {
    return {
      kind: 'not-allowed',
      message:
        '当前环境不允许使用麦克风（需 HTTPS，且宿主页须授权 microphone）。Power Apps 移动端请在系统设置允许麦克风，或用 Safari/Chrome 打开；也可改用键盘',
    }
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { kind: 'other', message: '未找到麦克风设备，请检查后重试或改用键盘' }
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return {
      kind: 'not-allowed',
      message: '非安全上下文无法录音，请使用 HTTPS 访问',
    }
  }
  if (err instanceof Error && /ticket|503|讯飞|IFLYTEK|网络|fetch|Failed/i.test(err.message)) {
    return {
      kind: 'network',
      message: `讯飞语音不可用：${err.message.slice(0, 80)}。可改用键盘或配置密钥后重试`,
    }
  }
  return {
    kind: 'other',
    message: err instanceof Error ? err.message.slice(0, 120) : '语音识别失败',
  }
}

export function useIFlytekSpeech(): SpeechRecognitionState {
  const [supported] = useState(() =>
    typeof window !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      (typeof AudioContext !== 'undefined' ||
        typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !==
          'undefined'),
  )
  const [listening, setListening] = useState(false)
  const [ready, setReady] = useState(false)
  const [paused, setPaused] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<SpeechErrorKind | null>(null)

  const finalRef = useRef('')
  const interimRef = useRef('')
  /** Dynamic-correction segments keyed by sn (讯飞 wpgs). */
  const segmentsRef = useRef<Map<number, string>>(new Map())
  const wantListeningRef = useRef(false)
  const intentionalStopRef = useRef(false)
  const listeningRef = useRef(false)
  const linkRef = useRef<IatLink | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const pcmQueueRef = useRef<Int16Array[]>([])
  const sendTimerRef = useRef<number | null>(null)
  const graceTimerRef = useRef<number | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  const settleResolverRef = useRef<((text: string) => void) | null>(null)
  const frameStatusRef = useRef<0 | 1 | 2>(0)
  const ticketRef = useRef<IatTicket | null>(null)
  const sessionLangRef = useRef<string | undefined>(undefined)
  const sessionEndedRef = useRef(false)
  const beginListeningRef = useRef<(clearTranscript: boolean) => Promise<void>>(async () => undefined)

  const clearSendTimer = useCallback(() => {
    if (sendTimerRef.current != null) {
      window.clearInterval(sendTimerRef.current)
      sendTimerRef.current = null
    }
  }, [])

  const clearGraceTimer = useCallback(() => {
    if (graceTimerRef.current != null) {
      window.clearTimeout(graceTimerRef.current)
      graceTimerRef.current = null
    }
  }, [])

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }, [])

  const setListeningState = useCallback((value: boolean) => {
    listeningRef.current = value
    setListening(value)
  }, [])

  const rebuildVisibleTranscript = useCallback(() => {
    const parts = [...segmentsRef.current.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, text]) => text)
    const stable = parts.join('')
    finalRef.current = stable
    setTranscript(stable)
    setInterimTranscript(interimRef.current)
  }, [])

  const applyIatResult = useCallback(
    (result: IatWsResult) => {
      const text = extractWords(result)
      const sn = result.sn ?? segmentsRef.current.size + 1

      if (result.pgs === 'rpl' && Array.isArray(result.rg) && result.rg.length >= 2) {
        const from = result.rg[0]
        const to = result.rg[1]
        for (let i = from; i <= to; i += 1) segmentsRef.current.delete(i)
        segmentsRef.current.set(from, text)
      } else if (result.pgs === 'apd' || result.pgs) {
        segmentsRef.current.set(sn, text)
      } else {
        // 无动态修正：按片追加；未完结片放 interim
        if (result.ls) {
          finalRef.current = joinTranscript(finalRef.current, text)
          interimRef.current = ''
          setTranscript(finalRef.current)
          setInterimTranscript('')
          return
        }
        interimRef.current = text
        setTranscript(finalRef.current)
        setInterimTranscript(text)
        return
      }

      interimRef.current = ''
      rebuildVisibleTranscript()
    },
    [rebuildVisibleTranscript],
  )

  const stopMicCapture = useCallback(() => {
    clearSendTimer()
    try {
      processorRef.current?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      sourceRef.current?.disconnect()
    } catch {
      /* ignore */
    }
    processorRef.current = null
    sourceRef.current = null
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    const ctx = audioCtxRef.current
    audioCtxRef.current = null
    if (ctx) {
      void ctx.close().catch(() => undefined)
    }
    pcmQueueRef.current = []
  }, [clearSendTimer])

  const clearError = useCallback(() => {
    setError(null)
    setErrorKind(null)
  }, [])

  const reset = useCallback(() => {
    finalRef.current = ''
    interimRef.current = ''
    segmentsRef.current = new Map()
    setTranscript('')
    setInterimTranscript('')
    setPaused(false)
    setReady(false)
    setError(null)
    setErrorKind(null)
  }, [])

  const resolveSettle = useCallback(() => {
    clearSettleTimer()
    if (interimRef.current) {
      finalRef.current = joinTranscript(finalRef.current, interimRef.current)
      interimRef.current = ''
      setTranscript(finalRef.current)
      setInterimTranscript('')
    }
    const text = finalRef.current.trim()
    const resolve = settleResolverRef.current
    settleResolverRef.current = null
    resolve?.(text)
    return text
  }, [clearSettleTimer])

  const finishSession = useCallback(
    (opts?: { pause?: boolean }) => {
      intentionalStopRef.current = true
      wantListeningRef.current = false
      clearGraceTimer()
      stopMicCapture()
      const link = linkRef.current
      linkRef.current = null
      try {
        link?.close()
      } catch {
        /* ignore */
      }
      setReady(false)
      setListeningState(false)
      setPaused(Boolean(opts?.pause))
      return resolveSettle()
    },
    [clearGraceTimer, resolveSettle, setListeningState, stopMicCapture],
  )

  const flushPcmFrame = useCallback(
    (status: 0 | 1 | 2) => {
      const link = linkRef.current
      const ticket = ticketRef.current
      if (!link?.ready || !ticket) return false

      let pcm: Int16Array
      if (status === 2) {
        // 结束帧可无音频
        pcm = new Int16Array(0)
      } else {
        const needed = Math.ceil((ticket.audio.frameBytes || FRAME_BYTES) / 2)
        const merged: number[] = []
        while (merged.length < needed && pcmQueueRef.current.length) {
          const next = pcmQueueRef.current.shift()!
          for (let i = 0; i < next.length; i += 1) merged.push(next[i])
        }
        if (merged.length === 0 && status !== 0) return false
        // Pad short first/middle frames with silence so engine gets steady frames.
        while (merged.length < needed) merged.push(0)
        pcm = Int16Array.from(merged.slice(0, needed))
      }

      const audio = pcmToBase64(pcm)
      if (status === 0) {
        const language =
          sessionLangRef.current || ticket.business.language || 'zh_cn'
        const business: Record<string, unknown> = {
          language,
          domain: ticket.business.domain || 'iat',
          accent: ticket.business.accent || 'mandarin',
          vad_eos: ticket.business.vadEos || 3000,
        }
        if (ticket.business.dwa) business.dwa = ticket.business.dwa
        if (
          !link.send({
            common: { app_id: ticket.appId },
            business,
            data: {
              status: 0,
              format: ticket.audio.format,
              encoding: ticket.audio.encoding,
              audio,
            },
          })
        ) {
          return false
        }
        frameStatusRef.current = 1
      } else if (status === 2) {
        if (
          !link.send({
            data: {
              status: 2,
              format: ticket.audio.format,
              encoding: ticket.audio.encoding,
              audio: '',
            },
          })
        ) {
          return false
        }
        frameStatusRef.current = 2
        sessionEndedRef.current = true
      } else if (
        !link.send({
          data: {
            status: 1,
            format: ticket.audio.format,
            encoding: ticket.audio.encoding,
            audio,
          },
        })
      ) {
        return false
      }
      return true
    },
    [],
  )

  const startPcmPump = useCallback(() => {
    clearSendTimer()
    const interval = ticketRef.current?.audio.frameIntervalMs || 40
    sendTimerRef.current = window.setInterval(() => {
      if (!wantListeningRef.current && frameStatusRef.current === 2) return
      if (sessionEndedRef.current) return
      if (frameStatusRef.current === 0) {
        flushPcmFrame(0)
        setReady(true)
        return
      }
      if (frameStatusRef.current === 1) {
        flushPcmFrame(1)
      }
    }, interval)
  }, [clearSendTimer, flushPcmFrame])

  const beginListening = useCallback(
    async (clearTranscript: boolean, lang?: string) => {
      if (!supported) {
        setErrorKind('unsupported')
        setError('当前环境不支持麦克风录音（需要 getUserMedia + WebSocket）')
        return
      }

      clearGraceTimer()
      clearSettleTimer()
      settleResolverRef.current = null
      intentionalStopRef.current = false
      wantListeningRef.current = true
      sessionEndedRef.current = false
      frameStatusRef.current = 0
      pcmQueueRef.current = []
      if (lang !== undefined) sessionLangRef.current = toIFlytekLanguage(lang)
      setError(null)
      setErrorKind(null)
      setPaused(false)
      setReady(false)

      if (clearTranscript) {
        finalRef.current = ''
        interimRef.current = ''
        segmentsRef.current = new Map()
        setTranscript('')
        setInterimTranscript('')
      } else {
        interimRef.current = ''
        setInterimTranscript('')
      }

      stopMicCapture()
      if (linkRef.current) {
        const prev = linkRef.current
        linkRef.current = null
        try {
          prev.close()
        } catch {
          /* ignore */
        }
      }

      setListeningState(true)

      const handleServerPayload = (payload: IatServerPayload) => {
        if (payload.code && payload.code !== 0) {
          setErrorKind('other')
          setError(`讯飞识别错误 ${payload.code}：${payload.message || 'unknown'}`)
          finishSession()
          return
        }
        if (payload.data?.result) applyIatResult(payload.data.result)
        if (payload.data?.status === 2) {
          if (settleResolverRef.current) {
            finishSession()
          } else if (wantListeningRef.current && !intentionalStopRef.current) {
            void beginListeningRef.current(false)
          }
        }
      }

      const onLinkError = () => {
        if (!wantListeningRef.current) return
        if (settleResolverRef.current) {
          finishSession()
          return
        }
        setErrorKind('network')
        setError('讯飞语音连接失败，请检查网络或密钥配置')
        finishSession()
      }

      try {
        if (typeof window !== 'undefined' && !window.isSecureContext) {
          throw new DOMException(
            'The operation is insecure.',
            'SecurityError',
          )
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException(
            'The operation is insecure.',
            'SecurityError',
          )
        }

        const ticket = (await api.speechIatTicket()) as IatTicket
        if (!wantListeningRef.current || intentionalStopRef.current) return
        ticketRef.current = ticket

        // 先拿麦：iOS WebView 常在此处抛 SecurityError，便于给出明确提示。
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        if (!wantListeningRef.current || intentionalStopRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        mediaStreamRef.current = stream

        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AC()
        audioCtxRef.current = ctx
        if (ctx.state === 'suspended') await ctx.resume()

        const source = ctx.createMediaStreamSource(stream)
        sourceRef.current = source
        // ScriptProcessor is deprecated but widely available; 4096 keeps callback rate manageable.
        const processor = ctx.createScriptProcessor(4096, 1, 1)
        processorRef.current = processor
        processor.onaudioprocess = (event) => {
          if (!wantListeningRef.current && intentionalStopRef.current && sessionEndedRef.current) {
            return
          }
          // During grace we still accept audio until status=2 is sent.
          if (sessionEndedRef.current) return
          const input = event.inputBuffer.getChannelData(0)
          const pcm = floatTo16kPcm(input, ctx.sampleRate)
          if (pcm.length) pcmQueueRef.current.push(pcm)
        }
        // Mute monitor path — ScriptProcessor must be in the graph to fire, but don't play mic.
        const mute = ctx.createGain()
        mute.gain.value = 0
        source.connect(processor)
        processor.connect(mute)
        mute.connect(ctx.destination)

        if (preferIFlytekHttpTransport(ticket)) {
          const session = await api.speechIatHttpOpen()
          if (!wantListeningRef.current || intentionalStopRef.current) {
            void api.speechIatHttpClose(session.sessionId)
            return
          }
          const events = new EventSource(api.speechIatHttpEventsUrl(session.sessionId))
          let closed = false
          const link: IatLink = {
            ready: false,
            send: (payload) => {
              void api.speechIatHttpAudio(session.sessionId, payload).catch(() => {
                if (!closed) onLinkError()
              })
              return true
            },
            close: () => {
              if (closed) return
              closed = true
              events.close()
              void api.speechIatHttpClose(session.sessionId)
            },
          }
          linkRef.current = link
          events.onmessage = (event) => {
            try {
              const payload = JSON.parse(String(event.data)) as IatServerPayload
              if (payload.ready && linkRef.current === link) {
                link.ready = true
                if (!wantListeningRef.current || intentionalStopRef.current) {
                  link.close()
                  return
                }
                startPcmPump()
                return
              }
              handleServerPayload(payload)
            } catch {
              /* ignore */
            }
          }
          events.onerror = () => {
            if (closed) return
            onLinkError()
          }
        } else {
          const wsUrl = resolveIFlytekIatWsUrl(ticket)
          const ws = new WebSocket(wsUrl)
          let closed = false
          const link: IatLink = {
            ready: false,
            send: (payload) => {
              if (ws.readyState !== WebSocket.OPEN) return false
              ws.send(JSON.stringify(payload))
              return true
            },
            close: () => {
              if (closed) return
              closed = true
              try {
                ws.close(1000)
              } catch {
                /* ignore */
              }
            },
          }
          linkRef.current = link
          ws.onopen = () => {
            if (!wantListeningRef.current || intentionalStopRef.current) {
              link.close()
              return
            }
            link.ready = true
            startPcmPump()
          }
          ws.onmessage = (event) => {
            try {
              handleServerPayload(JSON.parse(String(event.data)) as IatServerPayload)
            } catch {
              /* ignore */
            }
          }
          ws.onerror = () => {
            if (closed) return
            onLinkError()
          }
          ws.onclose = () => {
            if (settleResolverRef.current) {
              finishSession()
              return
            }
            if (!intentionalStopRef.current && wantListeningRef.current && !sessionEndedRef.current) {
              setErrorKind('network')
              setError('讯飞语音连接已断开')
              finishSession()
            }
          }
        }
      } catch (err) {
        const mapped = mapMediaError(err)
        setErrorKind(mapped.kind)
        setError(mapped.message)
        finishSession()
      }
    },
    [
      applyIatResult,
      clearGraceTimer,
      clearSettleTimer,
      finishSession,
      setListeningState,
      startPcmPump,
      stopMicCapture,
      supported,
    ],
  )

  useEffect(() => {
    beginListeningRef.current = beginListening
  }, [beginListening])

  const start = useCallback(
    (lang = 'zh-CN') => {
      void beginListening(true, lang)
    },
    [beginListening],
  )

  const resume = useCallback(
    (lang = 'zh-CN') => {
      void beginListening(false, lang)
    },
    [beginListening],
  )

  const requestStop = useCallback(
    (opts?: StopOptions & { pause?: boolean }) => {
      const graceMs = opts?.graceMs ?? DEFAULT_GRACE_MS
      const settleMs = opts?.settleMs ?? DEFAULT_SETTLE_MS
      const asPause = Boolean(opts?.pause)

      if (!linkRef.current && !listeningRef.current && !wantListeningRef.current) {
        if (interimRef.current) {
          finalRef.current = joinTranscript(finalRef.current, interimRef.current)
          interimRef.current = ''
          setTranscript(finalRef.current)
          setInterimTranscript('')
        }
        setPaused(asPause)
        return Promise.resolve(finalRef.current.trim())
      }

      if (settleResolverRef.current) {
        return new Promise<string>((resolve) => {
          const prev = settleResolverRef.current
          settleResolverRef.current = (text) => {
            prev?.(text)
            resolve(text)
          }
        })
      }

      return new Promise<string>((resolve) => {
        settleResolverRef.current = resolve
        intentionalStopRef.current = true
        // Keep wantListening until end frame is sent so grace audio still queues.
        clearGraceTimer()
        setReady(false)

        const cut = () => {
          graceTimerRef.current = null
          wantListeningRef.current = false
          // Send remaining audio then end frame.
          if (frameStatusRef.current === 0) flushPcmFrame(0)
          while (pcmQueueRef.current.length && frameStatusRef.current === 1) {
            if (!flushPcmFrame(1)) break
          }
          flushPcmFrame(2)
          clearSendTimer()
          stopMicCapture()

          clearSettleTimer()
          settleTimerRef.current = window.setTimeout(() => {
            finishSession({ pause: asPause })
          }, settleMs)
        }

        if (graceMs <= 0) cut()
        else graceTimerRef.current = window.setTimeout(cut, graceMs)
      })
    },
    [
      clearGraceTimer,
      clearSendTimer,
      clearSettleTimer,
      finishSession,
      flushPcmFrame,
      stopMicCapture,
    ],
  )

  const stop = useCallback((opts?: StopOptions) => requestStop(opts), [requestStop])
  const pause = useCallback(
    (opts?: StopOptions) => requestStop({ ...opts, pause: true }),
    [requestStop],
  )

  const cancel = useCallback(() => {
    intentionalStopRef.current = true
    wantListeningRef.current = false
    clearGraceTimer()
    clearSettleTimer()
    clearSendTimer()
    settleResolverRef.current = null
    stopMicCapture()
    const link = linkRef.current
    linkRef.current = null
    try {
      link?.close()
    } catch {
      /* ignore */
    }
    finalRef.current = ''
    interimRef.current = ''
    segmentsRef.current = new Map()
    setListeningState(false)
    setReady(false)
    setPaused(false)
    setTranscript('')
    setInterimTranscript('')
  }, [clearGraceTimer, clearSendTimer, clearSettleTimer, setListeningState, stopMicCapture])

  useEffect(() => {
    return () => {
      intentionalStopRef.current = true
      wantListeningRef.current = false
      clearGraceTimer()
      clearSettleTimer()
      clearSendTimer()
      settleResolverRef.current = null
      stopMicCapture()
      try {
        linkRef.current?.close()
      } catch {
        /* ignore */
      }
      linkRef.current = null
    }
  }, [clearGraceTimer, clearSendTimer, clearSettleTimer, stopMicCapture])

  return {
    supported,
    provider: 'iflytek',
    listening,
    ready,
    paused,
    transcript,
    interimTranscript,
    error,
    errorKind,
    start,
    resume,
    pause,
    stop,
    cancel,
    reset,
    setTranscript: (value: string) => {
      finalRef.current = value
      interimRef.current = ''
      segmentsRef.current = new Map([[1, value]])
      setTranscript(value)
      setInterimTranscript('')
    },
    clearError,
  }
}
