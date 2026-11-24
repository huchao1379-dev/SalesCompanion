import { useCallback, useEffect, useRef, useState } from 'react'

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives?: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  onaudiostart?: (() => void) | null
  onspeechstart?: (() => void) | null
  onstart?: (() => void) | null
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}

export type SpeechErrorKind = 'not-allowed' | 'no-speech' | 'network' | 'unsupported' | 'other'

export type StopOptions = {
  /**
   * Wait this long after the user releases before cutting the mic.
   * Trailing syllables are often still in flight when the finger lifts.
   */
  graceMs?: number
  /** Max time to wait for final onresult/onend after stop(). */
  settleMs?: number
}

export type WebSpeechState = {
  supported: boolean
  /** Recognition session is open (may still be warming up). */
  listening: boolean
  /** Mic/audio pipeline is live — safe to speak. */
  ready: boolean
  paused: boolean
  transcript: string
  interimTranscript: string
  error: string | null
  errorKind: SpeechErrorKind | null
  /** Start recognition; clears prior transcript. */
  start: (lang?: string) => void
  /** Resume after pause without clearing the accumulated transcript. */
  resume: (lang?: string) => void
  /** Temporarily stop recognition while keeping the transcript. */
  pause: (opts?: StopOptions) => Promise<string>
  /** Stop and return the best available transcript after engine settles. */
  stop: (opts?: StopOptions) => Promise<string>
  /** Abort without keeping interim as intentional stop; clears listening. */
  cancel: () => void
  reset: () => void
  setTranscript: (value: string) => void
  clearError: () => void
}

const DEFAULT_GRACE_MS = 280
const DEFAULT_SETTLE_MS = 900

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as SpeechWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function mapError(code: string): { kind: SpeechErrorKind; message: string } {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return { kind: 'not-allowed', message: '麦克风权限被拒绝，请在系统设置中允许后重试，或改用键盘输入' }
  }
  if (code === 'no-speech') {
    return { kind: 'no-speech', message: '未检测到有效语音，请靠近麦克风重试或改用键盘' }
  }
  if (code === 'network') {
    return { kind: 'network', message: '语音识别需要网络连接（浏览器云端识别）。请检查网络后重试' }
  }
  if (code === 'audio-capture') {
    return { kind: 'other', message: '无法访问麦克风，请检查设备后重试或改用键盘' }
  }
  return { kind: 'other', message: `语音识别失败：${code}` }
}

function joinTranscript(base: string, chunk: string) {
  const a = base.trimEnd()
  const b = chunk.trim()
  if (!b) return a
  if (!a) return b
  // Keep browser-provided spacing for Latin; Chinese usually has none.
  const needsSpace = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b)
  return needsSpace ? `${a} ${b}` : `${a}${b}`
}

export function useWebSpeech(): WebSpeechState {
  const [supported] = useState(() => Boolean(getRecognitionCtor()))
  const [listening, setListening] = useState(false)
  const [ready, setReady] = useState(false)
  const [paused, setPaused] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<SpeechErrorKind | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalRef = useRef('')
  const interimRef = useRef('')
  const intentionalStopRef = useRef(false)
  /** Keep mic session alive across mobile Chrome pause/end cycles. */
  const wantListeningRef = useRef(false)
  const langRef = useRef('zh-CN')
  const restartTimerRef = useRef<number | null>(null)
  const graceTimerRef = useRef<number | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  const readyFallbackTimerRef = useRef<number | null>(null)
  const settleResolverRef = useRef<((text: string) => void) | null>(null)
  const listeningRef = useRef(false)

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current != null) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
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

  const clearReadyFallbackTimer = useCallback(() => {
    if (readyFallbackTimerRef.current != null) {
      window.clearTimeout(readyFallbackTimerRef.current)
      readyFallbackTimerRef.current = null
    }
  }, [])

  const setListeningState = useCallback((value: boolean) => {
    listeningRef.current = value
    setListening(value)
  }, [])

  const clearError = useCallback(() => {
    setError(null)
    setErrorKind(null)
  }, [])

  const reset = useCallback(() => {
    finalRef.current = ''
    interimRef.current = ''
    setTranscript('')
    setInterimTranscript('')
    setPaused(false)
    setReady(false)
    setError(null)
    setErrorKind(null)
  }, [])

  const mergeInterimIntoFinal = useCallback(() => {
    if (!interimRef.current) return
    finalRef.current = joinTranscript(finalRef.current, interimRef.current)
    interimRef.current = ''
    setTranscript(finalRef.current)
    setInterimTranscript('')
  }, [])

  const resolveSettle = useCallback(() => {
    clearSettleTimer()
    mergeInterimIntoFinal()
    const text = finalRef.current.trim()
    const resolve = settleResolverRef.current
    settleResolverRef.current = null
    resolve?.(text)
    return text
  }, [clearSettleTimer, mergeInterimIntoFinal])

  const finishSession = useCallback(
    (opts?: { pause?: boolean }) => {
      intentionalStopRef.current = true
      wantListeningRef.current = false
      clearRestartTimer()
      clearGraceTimer()
      clearReadyFallbackTimer()
      setReady(false)
      setListeningState(false)
      setPaused(Boolean(opts?.pause))
      return resolveSettle()
    },
    [clearGraceTimer, clearReadyFallbackTimer, clearRestartTimer, resolveSettle, setListeningState],
  )

  const requestStop = useCallback(
    (opts?: StopOptions & { pause?: boolean }) => {
      const graceMs = opts?.graceMs ?? DEFAULT_GRACE_MS
      const settleMs = opts?.settleMs ?? DEFAULT_SETTLE_MS
      const asPause = Boolean(opts?.pause)

      // Already idle — return whatever we have.
      if (!recognitionRef.current && !wantListeningRef.current && !listeningRef.current) {
        mergeInterimIntoFinal()
        setPaused(asPause)
        return Promise.resolve(finalRef.current.trim())
      }

      // Coalesce concurrent stop/pause into one settle.
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
        wantListeningRef.current = false
        clearRestartTimer()
        clearReadyFallbackTimer()
        setReady(false)

        const cut = () => {
          graceTimerRef.current = null
          const rec = recognitionRef.current
          clearSettleTimer()
          settleTimerRef.current = window.setTimeout(() => {
            finishSession({ pause: asPause })
          }, settleMs)

          if (!rec) {
            finishSession({ pause: asPause })
            return
          }
          try {
            rec.stop()
          } catch {
            finishSession({ pause: asPause })
          }
        }

        clearGraceTimer()
        if (graceMs <= 0) {
          cut()
        } else {
          // Keep capturing briefly so trailing words survive finger-up.
          graceTimerRef.current = window.setTimeout(cut, graceMs)
        }
      })
    },
    [
      clearGraceTimer,
      clearReadyFallbackTimer,
      clearRestartTimer,
      clearSettleTimer,
      finishSession,
      mergeInterimIntoFinal,
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
    clearRestartTimer()
    clearGraceTimer()
    clearSettleTimer()
    clearReadyFallbackTimer()
    settleResolverRef.current = null
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.abort()
      } catch {
        /* already stopped */
      }
    }
    recognitionRef.current = null
    finalRef.current = ''
    interimRef.current = ''
    setListeningState(false)
    setReady(false)
    setPaused(false)
    setTranscript('')
    setInterimTranscript('')
  }, [
    clearGraceTimer,
    clearReadyFallbackTimer,
    clearRestartTimer,
    clearSettleTimer,
    setListeningState,
  ])

  const bindRecognition = useCallback(
    (recognition: SpeechRecognitionLike) => {
      recognition.onstart = () => {
        if (!wantListeningRef.current || intentionalStopRef.current) return
        setListeningState(true)
      }

      recognition.onaudiostart = () => {
        if (!wantListeningRef.current || intentionalStopRef.current) return
        clearReadyFallbackTimer()
        setReady(true)
        setListeningState(true)
      }

      recognition.onspeechstart = () => {
        if (!wantListeningRef.current || intentionalStopRef.current) return
        clearReadyFallbackTimer()
        setReady(true)
      }

      recognition.onresult = (event) => {
        let interim = ''
        let finalChunk = finalRef.current
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i]
          const text = result[0]?.transcript ?? ''
          if (!text) continue
          if (result.isFinal) {
            finalChunk = joinTranscript(finalChunk, text)
          } else {
            interim += text
          }
        }
        finalRef.current = finalChunk
        interimRef.current = interim
        setTranscript(finalChunk)
        setInterimTranscript(interim)
      }

      recognition.onerror = (event) => {
        if (event.error === 'aborted') {
          if (!wantListeningRef.current) {
            setListeningState(false)
            setReady(false)
          }
          return
        }
        // Continuous mode often emits no-speech on pauses — keep listening / restart.
        if (event.error === 'no-speech') {
          if (!wantListeningRef.current || intentionalStopRef.current) {
            setListeningState(false)
            setReady(false)
            if (settleResolverRef.current) finishSession()
          }
          return
        }
        wantListeningRef.current = false
        clearRestartTimer()
        const mapped = mapError(event.error)
        setErrorKind(mapped.kind)
        setError(mapped.message)
        setListeningState(false)
        setReady(false)
        if (settleResolverRef.current) finishSession()
      }

      recognition.onend = () => {
        // Flush last interim so a mid-sentence pause does not drop words.
        if (interimRef.current) {
          finalRef.current = joinTranscript(finalRef.current, interimRef.current)
          interimRef.current = ''
          setTranscript(finalRef.current)
          setInterimTranscript('')
        }

        if (!wantListeningRef.current || intentionalStopRef.current) {
          setListeningState(false)
          setReady(false)
          // Engine often delivers the last final result just before/with onend.
          if (settleResolverRef.current) finishSession()
          return
        }

        setReady(false)

        // Mobile Chrome ends continuous sessions on silence; restart to keep capturing.
        clearRestartTimer()
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null
          if (!wantListeningRef.current || intentionalStopRef.current) {
            setListeningState(false)
            return
          }
          const Ctor = getRecognitionCtor()
          if (!Ctor) {
            setListeningState(false)
            return
          }
          try {
            // Prefer restarting the same instance; some engines require a new one.
            recognition.start()
            setListeningState(true)
          } catch {
            try {
              const next = new Ctor()
              next.lang = langRef.current
              next.continuous = true
              next.interimResults = true
              next.maxAlternatives = 1
              bindRecognition(next)
              recognitionRef.current = next
              next.start()
              setListeningState(true)
            } catch {
              wantListeningRef.current = false
              setListeningState(false)
              setReady(false)
              setErrorKind('other')
              setError('语音识别中断，请再说一次或改用键盘')
            }
          }
        }, 120)
      }
    },
    [clearReadyFallbackTimer, clearRestartTimer, finishSession, setListeningState],
  )

  const beginListening = useCallback(
    (lang: string, clearTranscript: boolean) => {
      const Ctor = getRecognitionCtor()
      if (!Ctor) {
        setErrorKind('unsupported')
        setError('当前浏览器不支持 Web Speech API，请改用键盘输入')
        return
      }

      clearRestartTimer()
      clearGraceTimer()
      clearSettleTimer()
      clearReadyFallbackTimer()
      settleResolverRef.current = null
      intentionalStopRef.current = false
      wantListeningRef.current = true
      langRef.current = lang
      setError(null)
      setErrorKind(null)
      setPaused(false)
      setReady(false)

      if (clearTranscript) {
        finalRef.current = ''
        interimRef.current = ''
        setTranscript('')
        setInterimTranscript('')
      } else {
        interimRef.current = ''
        setInterimTranscript('')
      }

      // Tear down any prior instance before starting a fresh session.
      const prev = recognitionRef.current
      if (prev) {
        try {
          prev.onend = null
          prev.onerror = null
          prev.onresult = null
          prev.onstart = null
          prev.onaudiostart = null
          prev.onspeechstart = null
          prev.abort()
        } catch {
          /* ignore */
        }
      }

      const recognition = new Ctor()
      recognition.lang = lang
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      bindRecognition(recognition)
      recognitionRef.current = recognition

      try {
        recognition.start()
        setListeningState(true)
        // Fallback ready if engine never fires onaudiostart (some WebViews).
        readyFallbackTimerRef.current = window.setTimeout(() => {
          readyFallbackTimerRef.current = null
          if (wantListeningRef.current && !intentionalStopRef.current) {
            setReady(true)
          }
        }, 450)
      } catch {
        wantListeningRef.current = false
        setErrorKind('other')
        setError('无法启动语音识别，请改用键盘输入')
        setListeningState(false)
        setReady(false)
      }
    },
    [
      bindRecognition,
      clearGraceTimer,
      clearReadyFallbackTimer,
      clearRestartTimer,
      clearSettleTimer,
      setListeningState,
    ],
  )

  const start = useCallback(
    (lang = 'zh-CN') => {
      beginListening(lang, true)
    },
    [beginListening],
  )

  const resume = useCallback(
    (lang = 'zh-CN') => {
      beginListening(lang, false)
    },
    [beginListening],
  )

  useEffect(() => {
    return () => {
      wantListeningRef.current = false
      intentionalStopRef.current = true
      clearRestartTimer()
      clearGraceTimer()
      clearSettleTimer()
      clearReadyFallbackTimer()
      settleResolverRef.current = null
      recognitionRef.current?.abort()
    }
  }, [clearGraceTimer, clearReadyFallbackTimer, clearRestartTimer, clearSettleTimer])

  return {
    supported,
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
    setTranscript,
    clearError,
  }
}
