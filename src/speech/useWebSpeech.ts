import { useCallback, useEffect, useRef, useState } from 'react'

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
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

export type WebSpeechState = {
  supported: boolean
  listening: boolean
  transcript: string
  interimTranscript: string
  error: string | null
  errorKind: SpeechErrorKind | null
  /** Start recognition; clears prior transcript. */
  start: (lang?: string) => void
  /** Stop and return the best available transcript (final + interim). */
  stop: () => string
  /** Abort without keeping interim as intentional stop; clears listening. */
  cancel: () => void
  reset: () => void
  setTranscript: (value: string) => void
  clearError: () => void
}

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

export function useWebSpeech(): WebSpeechState {
  const [supported] = useState(() => Boolean(getRecognitionCtor()))
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<SpeechErrorKind | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalRef = useRef('')
  const interimRef = useRef('')
  const intentionalStopRef = useRef(false)

  const clearError = useCallback(() => {
    setError(null)
    setErrorKind(null)
  }, [])

  const reset = useCallback(() => {
    finalRef.current = ''
    interimRef.current = ''
    setTranscript('')
    setInterimTranscript('')
    setError(null)
    setErrorKind(null)
  }, [])

  const stop = useCallback(() => {
    intentionalStopRef.current = true
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
    }
    setListening(false)
    const combined = `${finalRef.current} ${interimRef.current}`.trim()
    if (combined) {
      finalRef.current = combined
      interimRef.current = ''
      setTranscript(combined)
      setInterimTranscript('')
    }
    return combined
  }, [])

  const cancel = useCallback(() => {
    intentionalStopRef.current = true
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
    setListening(false)
    setTranscript('')
    setInterimTranscript('')
  }, [])

  const start = useCallback((lang = 'zh-CN') => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setErrorKind('unsupported')
      setError('当前浏览器不支持 Web Speech API，请改用键盘输入')
      return
    }

    intentionalStopRef.current = false
    setError(null)
    setErrorKind(null)
    finalRef.current = ''
    interimRef.current = ''
    setTranscript('')
    setInterimTranscript('')

    const recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event) => {
      let interim = ''
      let finalChunk = finalRef.current
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result[0].transcript
        if (result.isFinal) {
          finalChunk = `${finalChunk}${text}`.trim()
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
        setListening(false)
        return
      }
      // Continuous mode often emits no-speech on pauses — not a hard failure.
      if (event.error === 'no-speech') {
        if (intentionalStopRef.current) setListening(false)
        return
      }
      const mapped = mapError(event.error)
      setErrorKind(mapped.kind)
      setError(mapped.message)
      setListening(false)
    }

    recognition.onend = () => {
      setListening(false)
      if (finalRef.current) {
        setTranscript(finalRef.current)
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      setErrorKind('other')
      setError('无法启动语音识别，请改用键盘输入')
      setListening(false)
    }
  }, [])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  return {
    supported,
    listening,
    transcript,
    interimTranscript,
    error,
    errorKind,
    start,
    stop,
    cancel,
    reset,
    setTranscript,
    clearError,
  }
}
