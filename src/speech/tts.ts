import { api } from '../api/client'

type SpeakError = SpeechSynthesisErrorEvent & { detail?: string }

type SpeakOptions = {
  lang?: string
  rate?: number
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: SpeakError) => void
}

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null
let speechGateTimer: number | null = null
let audioUnlockCtx: AudioContext | null = null
let iflytekTtsCapable: boolean | null = null
let iflytekTtsProbe: Promise<boolean> | null = null
/**
 * Prefer Web Audio (decodeAudioData) over <audio src> —
 * Power Apps CSP is often `media-src 'self' data:` and blocks `blob:`;
 * large data: MP3 URLs also fail on some Android WebViews.
 * Web Audio does not go through media-src.
 */
let activeBufferSource: AudioBufferSourceNode | null = null
/** Fallback <audio> only when Web Audio decode fails. */
let sharedAudio: HTMLAudioElement | null = null
let sharedDataUrl: string | null = null
/** Bumped whenever real playback / hard-stop starts — voids stale silent-unlock .then(). */
let sharedAudioEpoch = 0
/** Active utterance stopper (browser synth and/or 讯飞 playback). */
let activeStop: (() => void) | null = null
/** Monotonic token so a cancelled async 讯飞 fetch never starts audio. */
let speakToken = 0

function hardStopSharedAudio() {
  sharedAudioEpoch += 1
  sharedDataUrl = null
  if (activeBufferSource) {
    try {
      activeBufferSource.onended = null
      activeBufferSource.stop()
    } catch {
      // ignore
    }
    try {
      activeBufferSource.disconnect()
    } catch {
      // ignore
    }
    activeBufferSource = null
  }
  const el = sharedAudio
  if (!el) return
  try {
    el.onplay = null
    el.onended = null
    el.onerror = null
    el.pause()
    el.removeAttribute('src')
    el.load()
  } catch {
    // ignore
  }
}

function ensureAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    if (!audioUnlockCtx || audioUnlockCtx.state === 'closed') {
      audioUnlockCtx = new AC()
    }
    return audioUnlockCtx
  } catch {
    return null
  }
}

function ensureSharedAudio(): HTMLAudioElement {
  if (typeof window === 'undefined') {
    throw new Error('no window')
  }
  if (!sharedAudio) {
    sharedAudio = new Audio()
    sharedAudio.preload = 'auto'
  }
  return sharedAudio
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bindActiveStop(stop: () => void): () => void {
  const prev = activeStop
  activeStop = null
  try {
    prev?.()
  } catch {
    // ignore
  }

  let cleared = false
  const wrapped = () => {
    if (cleared) return
    cleared = true
    if (activeStop === wrapped) activeStop = null
    try {
      stop()
    } catch {
      // ignore
    }
  }
  activeStop = wrapped
  return wrapped
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' ? window.speechSynthesis ?? null : null
}

function normalizeLang(lang: string) {
  return lang.replace('_', '-').toLowerCase()
}

function speakSilentUnlock(s: SpeechSynthesis) {
  const unlock = new SpeechSynthesisUtterance('\u200B')
  unlock.volume = 0
  unlock.rate = 2
  unlock.lang = 'zh-CN'
  s.speak(unlock)
}

/**
 * Unlock Web Audio inside the user gesture so later async 讯飞 decode/play works
 * on mobile (and bypasses media-src CSP entirely).
 */
function unlockAudioContext() {
  if (typeof window === 'undefined') return
  const ctx = ensureAudioCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    void ctx.resume()
  }
  // Brief silent buffer keeps the context "hot" across the async TTS fetch.
  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(0)
  } catch {
    // ignore
  }
}

export async function probeIFlytekTts(): Promise<boolean> {
  if (iflytekTtsCapable != null) return iflytekTtsCapable
  if (iflytekTtsProbe) return iflytekTtsProbe
  iflytekTtsProbe = api
    .health()
    .then((health) => {
      const ok = Boolean(
        health.iflytekTts ??
          health.capabilities?.speechTtsIFlytek ??
          health.iflytek ??
          health.capabilities?.speechIFlytek,
      )
      iflytekTtsCapable = ok
      return ok
    })
    .catch(() => {
      iflytekTtsCapable = false
      return false
    })
    .finally(() => {
      iflytekTtsProbe = null
    })
  return iflytekTtsProbe
}

/**
 * Prime speechSynthesis + HTMLAudio inside a user gesture so later (async)
 * speak() / 讯飞 play() work on mobile.
 */
export function unlockSpeech() {
  unlockAudioContext()
  void probeIFlytekTts()
  const s = synth()
  if (!s) return
  void ensureVoices()
  try {
    s.resume()
  } catch {
    // ignore
  }
  try {
    speakSilentUnlock(s)
    s.resume()
  } catch {
    // ignore
  }
}

export function armSpeechGate() {
  unlockSpeech()
  if (typeof window === 'undefined') return
  if (speechGateTimer != null) return
  speechGateTimer = window.setInterval(() => {
    const s = synth()
    if (!s) return
    try {
      s.resume()
    } catch {
      // ignore
    }
    if (!s.speaking && !s.pending) {
      try {
        speakSilentUnlock(s)
        s.resume()
      } catch {
        // ignore
      }
    }
  }, 1800)
}

export function disarmSpeechGate() {
  if (speechGateTimer != null) {
    window.clearInterval(speechGateTimer)
    speechGateTimer = null
  }
}

export function ensureVoices(timeoutMs = 2500): Promise<SpeechSynthesisVoice[]> {
  const s = synth()
  if (!s) return Promise.resolve([])
  if (voicesReady) return voicesReady

  voicesReady = new Promise((resolve) => {
    const existing = s.getVoices()
    if (existing.length) {
      resolve(existing)
      return
    }

    const finish = () => {
      s.removeEventListener('voiceschanged', finish)
      resolve(s.getVoices())
    }

    s.addEventListener('voiceschanged', finish)
    window.setTimeout(finish, timeoutMs)
  })

  return voicesReady
}

export function pickVoice(
  voices: SpeechSynthesisVoice[],
  preferredLang = 'zh-CN',
): SpeechSynthesisVoice | null {
  if (!voices.length) return null
  const want = normalizeLang(preferredLang)
  const prefix = want.split('-')[0] ?? want

  const exact =
    voices.find((v) => normalizeLang(v.lang) === want && v.localService) ||
    voices.find((v) => normalizeLang(v.lang) === want)
  if (exact) return exact

  const byPrefix =
    voices.find((v) => normalizeLang(v.lang).startsWith(prefix) && v.localService) ||
    voices.find((v) => normalizeLang(v.lang).startsWith(prefix))
  if (byPrefix) return byPrefix

  return null
}

function speakViaBrowser(text: string, options: SpeakOptions = {}): () => void {
  const s = synth()
  const trimmed = text.trim()
  if (!s || !trimmed) {
    options.onError?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent)
    return () => undefined
  }

  const lang = options.lang ?? 'zh-CN'
  const voices = s.getVoices()
  const voice = pickVoice(voices, lang)
  const token = ++speakToken

  try {
    if (s.speaking || s.pending) s.cancel()
  } catch {
    // ignore
  }

  let utter: SpeechSynthesisUtterance
  try {
    utter = new SpeechSynthesisUtterance(trimmed)
    utter.lang = voice?.lang || lang
    utter.rate = options.rate ?? 1
    utter.volume = 1
    if (voice) utter.voice = voice
  } catch {
    options.onError?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent)
    return () => undefined
  }

  let started = false
  let finished = false
  let keepAlive: number | null = null
  let watchdog: number | null = null

  const clearTimers = () => {
    if (keepAlive != null) {
      window.clearInterval(keepAlive)
      keepAlive = null
    }
    if (watchdog != null) {
      window.clearTimeout(watchdog)
      watchdog = null
    }
  }

  const markStarted = () => {
    if (started || finished || token !== speakToken) return
    started = true
    options.onStart?.()
  }

  utter.onstart = () => {
    markStarted()
  }

  utter.onend = () => {
    if (finished || token !== speakToken) return
    finished = true
    clearTimers()
    options.onEnd?.()
  }

  utter.onerror = (event) => {
    if (finished || token !== speakToken) return
    finished = true
    clearTimers()
    if (event.error === 'interrupted' || event.error === 'canceled') return
    options.onError?.(event)
  }

  try {
    s.speak(utter)
  } catch {
    options.onError?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent)
    return () => undefined
  }

  const kickResume = () => {
    try {
      s.resume()
    } catch {
      // ignore
    }
  }
  kickResume()
  window.setTimeout(kickResume, 60)
  window.setTimeout(kickResume, 250)

  watchdog = window.setTimeout(() => {
    if (started || finished || token !== speakToken) return
    finished = true
    clearTimers()
    options.onError?.({ error: 'not-allowed' } as SpeechSynthesisErrorEvent)
  }, 5000)

  keepAlive = window.setInterval(() => {
    if (token !== speakToken || !s.speaking) {
      if (keepAlive != null) {
        window.clearInterval(keepAlive)
        keepAlive = null
      }
      return
    }
    try {
      s.resume()
    } catch {
      // ignore
    }
  }, 4000)

  if (voices.length === 0) void ensureVoices()

  return () => {
    clearTimers()
    if (token === speakToken) speakToken += 1
    try {
      s.cancel()
    } catch {
      // ignore
    }
  }
}

async function playBytesViaWebAudio(
  bytes: Uint8Array,
  isStale: () => boolean,
  onStart: () => void,
  onEnd: () => void,
): Promise<boolean> {
  const ctx = ensureAudioCtx()
  if (!ctx) return false
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      return false
    }
  }
  if (isStale()) return false

  // decodeAudioData detaches the buffer — pass a copy.
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  let audioBuffer: AudioBuffer
  try {
    audioBuffer = await ctx.decodeAudioData(copy)
  } catch {
    return false
  }
  if (isStale()) return false

  sharedAudioEpoch += 1
  if (activeBufferSource) {
    try {
      activeBufferSource.onended = null
      activeBufferSource.stop()
      activeBufferSource.disconnect()
    } catch {
      // ignore
    }
    activeBufferSource = null
  }

  const source = ctx.createBufferSource()
  source.buffer = audioBuffer
  source.connect(ctx.destination)
  source.onended = () => {
    if (activeBufferSource === source) activeBufferSource = null
    onEnd()
  }
  activeBufferSource = source
  try {
    source.start(0)
  } catch {
    activeBufferSource = null
    return false
  }
  onStart()
  return true
}

function playViaHtmlAudioDataUrl(
  audioBase64: string,
  mime: string,
  isStale: () => boolean,
  onStart: () => void,
  onEnd: () => void,
  onFail: () => void,
): void {
  // data: avoids blob: CSP blocks; may still fail on huge payloads (hence Web Audio first).
  sharedDataUrl = `data:${mime};base64,${audioBase64}`
  const el = ensureSharedAudio()
  sharedAudioEpoch += 1
  el.onplay = null
  el.onended = null
  el.onerror = null
  try {
    el.pause()
  } catch {
    // ignore
  }
  el.volume = 1
  el.src = sharedDataUrl
  el.onplay = () => {
    if (isStale()) return
    onStart()
  }
  el.onended = () => onEnd()
  el.onerror = () => onFail()
  void el.play().catch((playErr: unknown) => {
    if (isStale()) return
    const name = playErr instanceof DOMException ? playErr.name : ''
    if (name === 'AbortError') return
    onFail()
  })
}

function speakViaIFlytek(text: string, options: SpeakOptions = {}): () => void {
  const trimmed = text.trim()
  if (!trimmed) {
    options.onError?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent)
    return () => undefined
  }

  const token = ++speakToken
  hardStopSharedAudio()

  let cancelled = false
  let started = false
  let finished = false
  let stopFallback: (() => void) | null = null
  const controller = new AbortController()

  const isStale = () => cancelled || token !== speakToken

  const fail = (
    code: SpeechSynthesisErrorEvent['error'] = 'synthesis-failed',
    detail?: string,
  ) => {
    if (finished || isStale()) return
    finished = true
    hardStopSharedAudio()
    options.onError?.({ error: code, detail } as SpeakError)
  }

  const markStarted = () => {
    if (started || finished || isStale()) return
    started = true
    options.onStart?.()
  }

  const succeedEnd = () => {
    if (finished || isStale()) return
    finished = true
    sharedDataUrl = null
    options.onEnd?.()
  }

  void (async () => {
    try {
      const result = await api.speechTts(
        { text: trimmed, rate: options.rate },
        { signal: controller.signal },
      )
      if (isStale()) return

      const bytes = base64ToBytes(result.audioBase64)
      const mime = result.mimeType || 'audio/mpeg'

      // 1) Web Audio — no media-src / blob CSP issues (Power Apps friendly).
      const played = await playBytesViaWebAudio(bytes, isStale, markStarted, succeedEnd)
      if (played || isStale()) return

      // 2) HTMLAudio data: fallback (still no blob:).
      playViaHtmlAudioDataUrl(result.audioBase64, mime, isStale, markStarted, succeedEnd, () => {
        fail('synthesis-failed')
      })
    } catch (err) {
      if (isStale() || controller.signal.aborted) return
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status?: number }).status)
          : undefined
      const detailRaw =
        err && typeof err === 'object' && 'detail' in err
          ? String((err as { detail?: string }).detail || '')
          : ''
      let detail = err instanceof Error ? err.message : '讯飞合成失败'
      try {
        const parsed = JSON.parse(detailRaw) as { error?: string; detail?: string }
        detail = parsed.error || parsed.detail || detail
      } catch {
        if (detailRaw) detail = detailRaw.slice(0, 160)
      }
      if (status === 503 || status === 502) {
        iflytekTtsCapable = false
      }
      // Power Apps / 手机浏览器上 Google speechSynthesis 基本不可用，回退只会掩盖真因。
      const host =
        typeof navigator !== 'undefined'
          ? /PowerApps|MSAppHost|powerplatformusercontent/i.test(navigator.userAgent)
          : false
      const coarse =
        typeof window !== 'undefined' &&
        Boolean(window.matchMedia?.('(pointer: coarse)')?.matches)
      if (!host && !coarse && status !== 502 && status !== 503) {
        stopFallback = speakViaBrowser(trimmed, options)
        return
      }
      fail(
        status === 502 || status === 503 ? 'synthesis-unavailable' : 'synthesis-failed',
        detail,
      )
    }
  })()

  return () => {
    cancelled = true
    if (token === speakToken) speakToken += 1
    controller.abort()
    hardStopSharedAudio()
    stopFallback?.()
    stopFallback = null
  }
}

/**
 * Speak text — prefers 讯飞在线合成 (MP3 via /api/speech/tts) when configured,
 * otherwise browser speechSynthesis. Always replaces any previous utterance.
 */
export function speakText(text: string, options: SpeakOptions = {}): () => void {
  disarmSpeechGate()
  const trimmed = text.trim()
  if (!trimmed) {
    options.onError?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent)
    return () => undefined
  }

  const stop =
    iflytekTtsCapable === false
      ? speakViaBrowser(trimmed, options)
      : speakViaIFlytek(trimmed, options)

  return bindActiveStop(stop)
}

/** Stop every active utterance (browser + 讯飞 shared Audio). */
export function cancelSpeech(opts?: { keepGate?: boolean }) {
  if (!opts?.keepGate) disarmSpeechGate()
  speakToken += 1
  const stop = activeStop
  activeStop = null
  try {
    stop?.()
  } catch {
    // ignore
  }
  hardStopSharedAudio()
  try {
    synth()?.cancel()
  } catch {
    // ignore
  }
}

export function canSpeak(): boolean {
  return Boolean(synth()) || iflytekTtsCapable !== false
}
