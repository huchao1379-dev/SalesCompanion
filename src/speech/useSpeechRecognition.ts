/**
 * Unified speech entry — prefers 讯飞 when server reports it, else Web Speech.
 * Override with VITE_SPEECH_PROVIDER=iflytek|webspeech|auto
 *
 * Optimistic default is 讯飞 so mobile Copilot never briefly opens Android's
 * system “选择识别语音内容” Web Speech chrome before /health returns.
 */
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SpeechProvider, SpeechRecognitionState } from './types'
import { useIFlytekSpeech } from './useIFlytekSpeech'
import { useWebSpeech } from './useWebSpeech'

function envSpeechPreference(): 'auto' | SpeechProvider {
  const raw = (import.meta.env.VITE_SPEECH_PROVIDER as string | undefined)?.trim().toLowerCase()
  if (raw === 'iflytek' || raw === 'webspeech' || raw === 'auto') return raw
  return 'auto'
}

function pickProvider(
  preference: 'auto' | SpeechProvider,
  serverProvider: SpeechProvider | null,
  iflytekConfigured: boolean | null,
): SpeechProvider {
  if (preference === 'webspeech') return 'webspeech'
  if (preference === 'iflytek') return 'iflytek'
  if (serverProvider === 'iflytek' || iflytekConfigured) return 'iflytek'
  if (serverProvider === 'webspeech') return 'webspeech'
  // Keep 讯飞 until health proves it is unavailable — avoids Android system ASR UI.
  if (iflytekConfigured === null) return 'iflytek'
  return 'webspeech'
}

/**
 * Both hooks are mounted; inactive backend is never started by the UI.
 * (Hooks cannot be conditional; cancel/reset keep the unused engine idle.)
 */
export function useSpeechRecognition(): SpeechRecognitionState {
  const preference = envSpeechPreference()
  // Optimistic 讯飞: 新建拜访 / Copilot share this hook; Android Web Speech
  // surfaces a system banner (“选择识别语音内容”) that we must not flash.
  const [provider, setProvider] = useState<SpeechProvider>(() =>
    preference === 'webspeech' ? 'webspeech' : 'iflytek',
  )
  const web = useWebSpeech()
  const iflytek = useIFlytekSpeech()

  useEffect(() => {
    let cancelled = false
    void api
      .health()
      .then((health) => {
        if (cancelled) return
        setProvider(
          pickProvider(
            preference,
            health.speechProvider ?? null,
            health.iflytek ?? health.capabilities?.speechIFlytek ?? null,
          ),
        )
      })
      .catch(() => {
        if (cancelled) return
        // API down: keep env preference; iflytek needs ticket so fall back unless forced.
        setProvider(preference === 'webspeech' ? 'webspeech' : preference === 'auto' ? 'iflytek' : preference)
      })
    return () => {
      cancelled = true
    }
  }, [preference])

  return provider === 'iflytek' ? iflytek : web
}
