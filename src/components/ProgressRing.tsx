type Props = {
  value: number
  size?: number
  stroke?: number
  className?: string
}

export function ProgressRing({ value, size = 72, stroke = 7, className = '' }: Props) {
  const pct = Math.max(0, Math.min(100, value))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c

  return (
    <svg
      className={`progress-ring ${className}`.trim()}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <circle
        className="progress-ring__track"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
      />
      <circle
        className="progress-ring__value"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="progress-ring__label"
      >
        {Math.round(pct)}%
      </text>
    </svg>
  )
}
