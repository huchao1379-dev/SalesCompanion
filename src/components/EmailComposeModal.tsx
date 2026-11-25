import './EmailComposeModal.css'
import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EmailDraftFields } from '../agents/types'
import { IconClose, IconSpark } from './DashIcons'
import { IconButton } from './IconButton'

type Props = {
  open: boolean
  draft: EmailDraftFields | null
  busy?: boolean
  error?: string | null
  onClose: () => void
  onSend: (draft: EmailDraftFields) => void
}

export function EmailComposeModal({
  open,
  draft,
  busy = false,
  error = null,
  onClose,
  onSend,
}: Props) {
  const titleId = useId()
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  useEffect(() => {
    if (!open || !draft) return
    setTo(draft.to)
    setSubject(draft.subject)
    setBody(draft.body)
  }, [open, draft])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open || !draft || typeof document === 'undefined') return null

  const toTrimmed = to.trim()
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toTrimmed)
  const canSend =
    Boolean(toTrimmed && emailOk && subject.trim() && body.trim()) && !busy

  return createPortal(
    <div className="email-compose-root" role="presentation">
      <button
        type="button"
        className="email-compose__scrim"
        aria-label="关闭邮件草稿"
        disabled={busy}
        onClick={() => {
          if (!busy) onClose()
        }}
      />
      <div
        className={`email-compose${busy ? ' is-busy' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="email-compose__head">
          <div className="email-compose__title-row">
            <span className="email-compose__icon" aria-hidden>
              <IconSpark />
            </span>
            <h2 id={titleId}>编辑并发送邮件</h2>
          </div>
          <IconButton
            variant="soft"
            size="sm"
            squared
            aria-label="关闭"
            title="关闭"
            disabled={busy}
            onClick={onClose}
          >
            <IconClose />
          </IconButton>
        </header>

        <div className="email-compose__body">
          <label className="email-compose__field">
            <span>收件人</span>
            <input
              type="text"
              inputMode="email"
              autoComplete="email"
              placeholder="邮箱地址"
              value={to}
              disabled={busy}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="email-compose__field">
            <span>主题</span>
            <input
              type="text"
              placeholder="邮件主题"
              value={subject}
              disabled={busy}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label className="email-compose__field email-compose__field--body">
            <span>内容</span>
            <textarea
              rows={10}
              placeholder="邮件正文"
              value={body}
              disabled={busy}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          {error ? (
            <p className="email-compose__error" role="alert">
              {error}
            </p>
          ) : toTrimmed && !emailOk ? (
            <p className="email-compose__hint is-warn">
              收件人请填写完整邮箱地址后再发送。
            </p>
          ) : (
            <p className="email-compose__hint">确认后发送邮件。</p>
          )}
        </div>

        <footer className="email-compose__footer">
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--accent"
            disabled={!canSend}
            onClick={() =>
              onSend({
                to: to.trim(),
                subject: subject.trim(),
                body: body.trim(),
              })
            }
          >
            {busy ? '发送中…' : '确认发送'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
