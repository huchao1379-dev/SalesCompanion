type SpeakOptions = {
  lang?: string
  rate?: number
  onEnd?: () => void
  onError?: (error: SpeechSynthesisErrorEvent) => void
}

let unlockQueued = false
let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' ? window.speechSynthesis ?? null : null
}

function normalizeLang(lang: string) {
  return lang.replace('_', '-').toLowerCase()
}

/** Warm the engine inside a user gesture so Android Chrome allows later speak(). */
export function unlockSpeech() {
  const s = synth()
  if (!s) return
  void ensureVoices()
  if (unlockQueued) {
    try {
      s.resume()
    } catch {
      // ignore
    }
    return
  }
  unlockQueued = true
  try {
    const warm = new SpeechSynthesisUtterance(' ')
    warm.volume = 0
    warm.rate = 2
    s.speak(warm)
    // Defer cancel so the gesture still registers a speak() on Android Chrome.
    window.setTimeout(() => {
      try {
        s.cancel()
      } catch {
        // ignore
      }
    }, 0)
  } catch {
    unlockQueued = false
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

  return voices.find((v) => v.default) ?? voices[0] ?? null
}

/**
 * Speak text with Android Chrome workarounds:
 * - wait for voices
 * - gap after cancel (Chromium drops the next utterance otherwise)
 * - resume() kick (engine often starts paused on Android)
 */
export async function speakText(text: string, options: SpeakOptions = {}): Promise<() => void> {
  const s = synth()
  const trimmed = text.trim()
  if (!s || !trimmed) {
    options.onError?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent)
    return () => undefined
  }

  const lang = options.lang ?? 'zh-CN'
  const voices = await ensureVoices()
  const voice = pickVoice(voices, lang)

  s.cancel()

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 60)
  })

  const utter = new SpeechSynthesisUtterance(trimmed)
  utter.lang = voice?.lang || lang
  utter.rate = options.rate ?? 1
  if (voice) utter.voice = voice

  let keepAlive: number | null = null
  const clearKeepAlive = () => {
    if (keepAlive != null) {
      window.clearInterval(keepAlive)
      keepAlive = null
    }
  }

  utter.onend = () => {
    clearKeepAlive()
    options.onEnd?.()
  }

  utter.onerror = (event) => {
    clearKeepAlive()
    // cancel/interrupted is expected when stopSpeak() runs
    if (event.error === 'interrupted' || event.error === 'canceled') return
    options.onError?.(event)
  }

  s.speak(utter)
  // Android Chrome frequently queues in a paused state until resume().
  try {
    s.resume()
  } catch {
    // ignore
  }

  keepAlive = window.setInterval(() => {
    if (!s.speaking) {
      clearKeepAlive()
      return
    }
    try {
      s.resume()
    } catch {
      // ignore
    }
  }, 5000)

  return () => {
    clearKeepAlive()
    s.cancel()
  }
}

export function cancelSpeech() {
  synth()?.cancel()
}
