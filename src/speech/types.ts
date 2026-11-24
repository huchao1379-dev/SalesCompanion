export type SpeechErrorKind = 'not-allowed' | 'no-speech' | 'network' | 'unsupported' | 'other'

export type SpeechProvider = 'iflytek' | 'webspeech'

export type StopOptions = {
  /**
   * Wait this long after the user releases before cutting the mic.
   * Trailing syllables are often still in flight when the finger lifts.
   */
  graceMs?: number
  /** Max time to wait for final results after stop(). */
  settleMs?: number
}

/** Unified mic recognition contract used by CopilotChat / ActivityCapture. */
export type SpeechRecognitionState = {
  supported: boolean
  /** Active backend: 讯飞 or browser Web Speech. */
  provider: SpeechProvider
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
