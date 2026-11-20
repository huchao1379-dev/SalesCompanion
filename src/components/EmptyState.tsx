import type { ReactNode } from 'react'

type Props = {
  title: string
  description?: string
  icon?: ReactNode
  actions?: ReactNode
  className?: string
  compact?: boolean
}

/** Reusable empty / error / permission placeholder for screen bodies. */
export function EmptyState({
  title,
  description,
  icon,
  actions,
  className,
  compact = false,
}: Props) {
  return (
    <div
      className={['ui-empty', compact ? 'is-compact' : '', className].filter(Boolean).join(' ')}
      role="status"
    >
      {icon ? (
        <div className="ui-empty__icon" aria-hidden>
          {icon}
        </div>
      ) : null}
      <h2 className="ui-empty__title">{title}</h2>
      {description ? <p className="ui-empty__desc">{description}</p> : null}
      {actions ? <div className="ui-empty__actions">{actions}</div> : null}
    </div>
  )
}
