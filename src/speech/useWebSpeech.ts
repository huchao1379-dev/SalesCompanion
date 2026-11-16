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

export type WebSpeechState = {
  supported: boolean
  listening: boolean
  transcript: string
  interimTranscript: string
  error: string | null
  /** Start recognition; clears prior transcript. */
  start: (lang?: string) => void
  /** Stop and return the best available transcript (final + interim). */
  stop: () => string
  reset: () => void
  setTranscript: (value: string) => void
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as SpeechWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useWebSpeech(): WebSpeechState {
  const [supported] = useState(() => Boolean(getRecognitionCtor()))
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalRef = useRef('')
  const interimRef = useRef('')

  const reset = useCallback(() => {
    finalRef.current = ''
    interimRef.current = ''
    setTranscript('')
    setInterimTranscript('')
    setError(null)
  }, [])

  const stop = useCallback(() => {
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

  const start = useCallback((lang = 'zh-CN') => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setError('当前浏览器不支持 Web Speech API，请改用键盘输入')
      return
    }

    setError(null)
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
      if (event.error === 'aborted' || event.error === 'no-speech') {
        setListening(false)
        return
      }
      setError(
        event.error === 'not-allowed'
          ? '麦克风权限被拒绝，请改用键盘输入'
          : `语音识别失败：${event.error}`,
      )
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
    start,
    stop,
    reset,
    setTranscript,
  }
}
