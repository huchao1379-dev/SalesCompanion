type Props = {
  listening: boolean
  disabled?: boolean
  onPressStart: () => void
  onPressEnd: () => void
  label?: string
}

export function MicButton({
  listening,
  disabled,
  onPressStart,
  onPressEnd,
  label = '按住说话',
}: Props) {
  return (
    <button
      type="button"
      className={`mic-button${listening ? ' mic-button--listening' : ''}`}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? '松开结束录音' : label}
      onPointerDown={(e) => {
        e.preventDefault()
        onPressStart()
      }}
      onPointerUp={(e) => {
        e.preventDefault()
        onPressEnd()
      }}
      onPointerLeave={() => {
        if (listening) onPressEnd()
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="mic-button__icon" aria-hidden>
        {listening ? '●' : '🎙'}
      </span>
      <span className="mic-button__label">{listening ? '松开关闭' : label}</span>
    </button>
  )
}
