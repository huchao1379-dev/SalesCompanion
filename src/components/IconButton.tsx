import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'default' | 'soft' | 'accent' | 'success' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

type Props = {
  children: ReactNode
  variant?: Variant
  size?: Size
  /** Rounded square instead of circle (chat / flush headers). */
  squared?: boolean
  badge?: number | string
  dot?: boolean
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

/**
 * Shared circular/square icon control used by home, sheets, headers and chat.
 * Keeps iOS/Android touch targets consistent via --touch-min.
 */
export function IconButton({
  children,
  variant = 'default',
  size = 'md',
  squared = false,
  badge,
  dot = false,
  className,
  type = 'button',
  ...rest
}: Props) {
  const classes = [
    'ui-icon-btn',
    `ui-icon-btn--${variant}`,
    `ui-icon-btn--${size}`,
    squared ? 'is-squared' : '',
    badge != null && badge !== '' ? 'has-badge' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} {...rest}>
      {children}
      {dot ? <span className="ui-icon-btn__dot" aria-hidden /> : null}
      {badge != null && badge !== '' ? (
        <span className="ui-icon-btn__count">{badge}</span>
      ) : null}
    </button>
  )
}
