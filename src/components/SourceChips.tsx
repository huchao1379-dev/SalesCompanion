import './SourceChips.css'
import type { SourceRef } from '../agents/types'

type Props = {
  sources: SourceRef[]
  /** When true, render an explicit empty state instead of nothing. */
  showEmpty?: boolean
}

export function SourceChips({ sources, showEmpty = false }: Props) {
  const real = sources.filter((s) => s.ref !== 'none' && s.label !== '无来源')
  if (!real.length) {
    if (!showEmpty && !sources.some((s) => s.label === '无来源')) return null
    return (
      <div className="source-chips source-chips--empty" aria-label="信息来源">
        <span className="source-chip source-chip--other is-empty">无来源</span>
      </div>
    )
  }
  return (
    <div className="source-chips" aria-label="信息来源">
      {real.map((s) => (
        <span
          key={`${s.kind}-${s.label}-${s.ref ?? ''}-${s.id ?? ''}`}
          className={`source-chip source-chip--${s.kind}`}
          title={[s.entity, s.id || s.ref].filter(Boolean).join(' · ')}
        >
          {s.label}
        </span>
      ))}
    </div>
  )
}
