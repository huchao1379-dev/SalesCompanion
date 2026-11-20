import type { ReactNode } from 'react'
import { IconBack } from './DashIcons'
import { IconButton } from './IconButton'
import './ScreenHeader.css'

type Props = {
  eyebrow?: string
  title: string
  onBack?: () => void
  backLabel?: string
  trailing?: ReactNode
  /** Extra class on the header (e.g. page-specific tweaks). */
  className?: string
}

export function ScreenHeader({
  eyebrow,
  title,
  onBack,
  backLabel = '返回',
  trailing,
  className,
}: Props) {
  const flush = Boolean(className?.includes('screen-header--flush'))
  return (
    <header className={['screen-header', className].filter(Boolean).join(' ')}>
      {onBack ? (
        <IconButton
          className="screen-header__btn"
          squared={flush}
          aria-label={backLabel}
          onClick={onBack}
        >
          <IconBack />
        </IconButton>
      ) : (
        <span className="screen-header__btn is-ghost" aria-hidden />
      )}
      <div className="screen-header__title">
        {eyebrow ? <p className="screen-header__eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
      </div>
      {trailing ?? <span className="screen-header__btn is-ghost" aria-hidden />}
    </header>
  )
}
