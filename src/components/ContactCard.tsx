import type { ReactNode } from 'react'
import { IconUser } from './DashIcons'
import './ContactCard.css'

export type ContactCardProps = {
  name: string
  title?: string
  badge?: string
  primary?: boolean
  details?: string[]
  footer?: ReactNode
  compact?: boolean
  className?: string
}

/**
 * Reusable contact card for chat account pulse, account profile and future
 * account/contact surfaces. Keeps name/title/badge/meta hierarchy consistent.
 */
export function ContactCard({
  name,
  title,
  badge,
  primary = false,
  details = [],
  footer,
  compact = false,
  className,
}: ContactCardProps) {
  return (
    <div
      className={[
        'contact-card',
        compact ? 'is-compact' : '',
        primary ? 'is-primary' : '',
        className || '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="contact-card__avatar" aria-hidden>
        <IconUser />
      </span>
      <div className="contact-card__body">
        <div className="contact-card__head">
          <strong className="contact-card__name">{name || '待补充联系人'}</strong>
          {badge ? <span className="contact-card__badge">{badge}</span> : null}
        </div>
        {title ? <p className="contact-card__title">{title}</p> : null}
        {details.filter(Boolean).map((detail) => (
          <p key={detail} className="contact-card__meta">
            {detail}
          </p>
        ))}
        {footer}
      </div>
    </div>
  )
}
