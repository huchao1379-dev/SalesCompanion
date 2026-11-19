import './SourceChips.css'
import type { SourceRef } from '../agents/types'

type Props = {
  sources: SourceRef[]
}

export function SourceChips({ sources }: Props) {
  if (!sources.length) return null
  return (
    <div className="source-chips" aria-label="信息来源">
      {sources.map((s) => (
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
