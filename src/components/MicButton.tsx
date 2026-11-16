import { useEffect, useRef, useState } from 'react'

type Props = {
  listening: boolean
  disabled?: boolean
  onPressStart: () => void
  onPressEnd: () => void
  label?: string
}

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function MicButton({
  listening,
  disabled,
  onPressStart,
  onPressEnd,
  label = '按住说话',
}: Props) {
  const [elapsed, setElapsed] = useState(0)
  const startedRef = useRef<number | null>(null)

  useEffect(() => {
    if (!listening) {
      startedRef.current = null
      return
    }
    startedRef.current = Date.now()
    const id = window.setInterval(() => {
      if (startedRef.current == null) return
      setElapsed(Math.floor((Date.now() - startedRef.current) / 1000))
    }, 200)
    return () => window.clearInterval(id)
  }, [listening])

  const displayElapsed = listening ? elapsed : 0

  return (
    <button
      type="button"
      className={`mic-button${listening ? ' mic-button--listening' : ''}`}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? '松开结束录音' : label}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId)
        setElapsed(0)
        onPressStart()
      }}
      onPointerUp={(e) => {
        e.preventDefault()
        onPressEnd()
      }}
      onPointerCancel={() => {
        if (listening) onPressEnd()
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
      <span className="mic-button__icon" aria-hidden>
        {listening ? '●' : '🎙'}
      </span>
      <span className="mic-button__label">
        {listening ? `录音中 ${formatElapsed(displayElapsed)}` : label}
      </span>
    </button>
  )
}
