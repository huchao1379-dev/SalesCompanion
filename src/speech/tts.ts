type SpeakOptions = {
  lang?: string
  rate?: number
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: SpeechSynthesisErrorEvent) => void
}

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' ? window.speechSynthesis ?? null : null
}

function normalizeLang(lang: string) {
  return lang.replace('_', '-').toLowerCase()
}

/** Resume a paused speech engine; the actual utterance is started by the UI. */
export function unlockSpeech() {
  const s = synth()
  if (!s) return
  void ensureVoices()
  try {
    s.resume()
  } catch {
    // ignore
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

  // Do not bind Chinese text to an unrelated default (often English) voice;
  // leave the utterance language set to zh-CN so the browser can choose safely.
  return null
}

/**
 * Speak text with browser workarounds:
 * - speak synchronously inside the user gesture (never await voice discovery first);
 * - use sync voices when available, but fall back to utter.lang;
 * - resume() kick for Android Chrome;
 * - watchdog so a blocked utterance cannot leave the UI stuck on "playing".
 */
export function speakText(text: string, options: SpeakOptions = {}): () => void {
  const s = synth()
  const trimmed = text.trim()
  if (!s || !trimmed) {
    options.onError?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent)
    return () => undefined
  }

  const lang = options.lang ?? 'zh-CN'
  // Do not await here: awaiting voices can outlive the browser's user-activation
  // window and make speech silently fail.
  const voices = s.getVoices()
  const voice = pickVoice(voices, lang)

  try {
    s.cancel()
  } catch {
    // ignore
  }

  let utter: SpeechSynthesisUtterance
  try {
    utter = new SpeechSynthesisUtterance(trimmed)
    utter.lang = voice?.lang || lang
    utter.rate = options.rate ?? 1
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
    if (started || finished) return
    started = true
    options.onStart?.()
  }

  utter.onstart = () => {
    markStarted()
  }

  utter.onend = () => {
    if (finished) return
    finished = true
    clearTimers()
    options.onEnd?.()
  }

  utter.onerror = (event) => {
    if (finished) return
    finished = true
    clearTimers()
    // cancel/interrupted is expected when stopSpeak() runs or a new utterance starts.
    if (event.error === 'interrupted' || event.error === 'canceled') return
    options.onError?.(event)
  }

  try {
    s.speak(utter)
  } catch {
    options.onError?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent)
    return () => undefined
  }

  // Android Chrome frequently queues in a paused state until resume().
  try {
    s.resume()
  } catch {
    // ignore
  }

  // Some embedded browsers never dispatch `onstart` for blocked/unsupported
  // speech. Do not leave the UI silently idle or permanently pending.
  watchdog = window.setTimeout(() => {
    if (started || finished) return
    finished = true
    clearTimers()
    options.onError?.({ error: 'not-allowed' } as SpeechSynthesisErrorEvent)
  }, 8000)

  keepAlive = window.setInterval(() => {
    if (!s.speaking) {
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
  }, 5000)

  // Warm the voice list for the next page without blocking this utterance.
  if (voices.length === 0) void ensureVoices()

  return () => {
    clearTimers()
    try {
      s.cancel()
    } catch {
      // ignore
    }
  }
}

export function cancelSpeech() {
  synth()?.cancel()
}
