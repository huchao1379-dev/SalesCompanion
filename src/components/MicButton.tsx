import './MicButton.css'
import { useEffect, useRef, useState } from 'react'
import { IconMic } from './DashIcons'

type Props = {
  listening: boolean
  disabled?: boolean
  /** Tap to start when idle; tap again to stop when listening. */
  onToggle: () => void
  elapsedSeconds?: number
  idleLabel?: string
}

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function MicButton({
  listening,
  disabled,
  onToggle,
  elapsedSeconds = 0,
  idleLabel = '点击开始录音',
}: Props) {
  const [localElapsed, setLocalElapsed] = useState(0)
  const startedRef = useRef<number | null>(null)

  useEffect(() => {
    if (!listening) {
      startedRef.current = null
      setLocalElapsed(0)
      return
    }
    startedRef.current = Date.now() - elapsedSeconds * 1000
    const id = window.setInterval(() => {
      if (startedRef.current == null) return
      setLocalElapsed(Math.floor((Date.now() - startedRef.current) / 1000))
    }, 200)
    return () => window.clearInterval(id)
  }, [listening, elapsedSeconds])

  const displayElapsed = listening ? Math.max(localElapsed, elapsedSeconds) : 0

  return (
    <button
      type="button"
      className={`mic-button${listening ? ' mic-button--listening' : ''}`}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? `停止录音，已录 ${formatElapsed(displayElapsed)}` : idleLabel}
      onClick={(e) => {
        e.preventDefault()
        onToggle()
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="mic-button__wave" aria-hidden>
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className={`mic-button__icon${listening ? ' is-live' : ''}`} aria-hidden>
        {listening ? <span className="mic-button__live-dot" /> : <IconMic />}
      </span>
      <span className="mic-button__label">
        {listening ? `录音中 ${formatElapsed(displayElapsed)}` : idleLabel}
      </span>
    </button>
  )
}
