import { api } from '../api/client'

type SpeakOptions = {
  lang?: string
  rate?: number
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: SpeechSynthesisErrorEvent) => void
}

const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null
let speechGateTimer: number | null = null
let audioUnlockCtx: AudioContext | null = null
let iflytekTtsCapable: boolean | null = null
let iflytekTtsProbe: Promise<boolean> | null = null
/** Single shared player — unlock + 讯飞 MP3 reuse the same element (mobile gesture). */
let sharedAudio: HTMLAudioElement | null = null
let sharedObjectUrl: string | null = null
/** Bumped whenever real playback / hard-stop starts — voids stale silent-unlock .then(). */
let sharedAudioEpoch = 0
/** Active utterance stopper (browser synth and/or 讯飞 HTMLAudioElement). */
let activeStop: (() => void) | null = null
/** Monotonic token so a cancelled async 讯飞 fetch never starts audio. */
let speakToken = 0

function hardStopSharedAudio() {
  sharedAudioEpoch += 1
  if (sharedObjectUrl) {
    try {
      URL.revokeObjectURL(sharedObjectUrl)
    } catch {
      // ignore
    }
    sharedObjectUrl = null
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
 * Unlock Web Audio + a shared HTMLAudioElement inside the user gesture so later
 * async 讯飞 MP3 playback is allowed on mobile.
 */
function unlockAudioContext() {
  if (typeof window === 'undefined') return
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    if (!audioUnlockCtx || audioUnlockCtx.state === 'closed') {
      audioUnlockCtx = new AC()
    }
    if (audioUnlockCtx.state === 'suspended') {
      void audioUnlockCtx.resume()
    }
  } catch {
    // ignore
  }

  try {
    const el = ensureSharedAudio()
    // Only prime when idle — don't interrupt an in-progress briefing clip.
    if (el.src && !el.src.startsWith('data:') && !el.paused) {
      return
    }
    const epoch = sharedAudioEpoch
    el.volume = 0.01
    el.src = SILENT_WAV
    el.currentTime = 0
    void el.play().then(() => {
      // A newer speak/stop may have taken over the shared element — do not pause it.
      if (epoch !== sharedAudioEpoch) return
      if (!el.src.startsWith('data:')) return
      try {
        el.pause()
        el.volume = 1
      } catch {
        // ignore
      }
    })
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

  const fail = (code: SpeechSynthesisErrorEvent['error'] = 'synthesis-failed') => {
    if (finished || isStale()) return
    finished = true
    hardStopSharedAudio()
    options.onError?.({ error: code } as SpeechSynthesisErrorEvent)
  }

  const succeedEnd = () => {
    if (finished || isStale()) return
    finished = true
    // Keep element; just clear handlers / blob so close doesn't leave a looping src.
    if (sharedAudio) {
      sharedAudio.onplay = null
      sharedAudio.onended = null
      sharedAudio.onerror = null
    }
    if (sharedObjectUrl) {
      try {
        URL.revokeObjectURL(sharedObjectUrl)
      } catch {
        // ignore
      }
      sharedObjectUrl = null
    }
    options.onEnd?.()
  }

  void (async () => {
    try {
      const result = await api.speechTts(
        { text: trimmed, rate: options.rate },
        { signal: controller.signal },
      )
      if (isStale()) return

      const binary = atob(result.audioBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: result.mimeType || 'audio/mpeg' })

      if (sharedObjectUrl) {
        try {
          URL.revokeObjectURL(sharedObjectUrl)
        } catch {
          // ignore
        }
        sharedObjectUrl = null
      }
      sharedObjectUrl = URL.createObjectURL(blob)

      const el = ensureSharedAudio()
      // Invalidate any pending silent-unlock pause so it cannot stop this clip.
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
      el.src = sharedObjectUrl
      el.onplay = () => {
        if (started || finished || isStale()) return
        started = true
        options.onStart?.()
      }
      el.onended = () => {
        succeedEnd()
      }
      el.onerror = () => {
        fail('synthesis-failed')
      }

      if (isStale()) {
        hardStopSharedAudio()
        return
      }

      try {
        await el.play()
      } catch {
        if (isStale()) return
        fail('not-allowed')
        return
      }

      if (isStale()) {
        hardStopSharedAudio()
        return
      }
      if (!started) {
        started = true
        options.onStart?.()
      }
    } catch (err) {
      if (isStale() || controller.signal.aborted) return
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status?: number }).status)
          : undefined
      if (status === 503 || status === 502) {
        iflytekTtsCapable = false
      }
      stopFallback = speakViaBrowser(trimmed, options)
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
