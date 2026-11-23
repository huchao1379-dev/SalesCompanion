import './AiSummaryModal.css'
import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { AiSummaryContent } from './AiSummaryContent'
import { IconClose, IconSpark } from './DashIcons'
import { IconButton } from './IconButton'

type TabKey = 'summary' | 'original'

type Props = {
  open: boolean
  original: string
  summary: string
  busy?: boolean
  onClose: () => void
  /** Replace the speech/transcript input with the (edited) summary. */
  onSave: (summary: string) => void
}

export function AiSummaryModal({ open, original, summary, busy = false, onClose, onSave }: Props) {
  const titleId = useId()
  const bodyId = useId()
  const [tab, setTab] = useState<TabKey>('summary')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(summary)

  useEffect(() => {
    if (!open) return
    setTab('summary')
    setEditing(false)
    setDraft(summary)
  }, [open, summary])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open || typeof document === 'undefined') return null

  const displayOriginal = original.trim() || '（暂无原文）'
  const canSave = Boolean(draft.trim()) && !busy

  return createPortal(
    <div className="ai-summary-modal-root" role="presentation">
      <button
        type="button"
        className="ai-summary-modal__scrim"
        aria-label="关闭 AI 总结"
        disabled={busy}
        onClick={() => {
          if (!busy) onClose()
        }}
      />
      <div
        className={`ai-summary-modal${editing ? ' is-editing' : ''}${busy ? ' is-busy' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <header className="ai-summary-modal__head">
          <div className="ai-summary-modal__title-row">
            <span className="ai-summary-modal__icon" aria-hidden>
              <IconSpark />
            </span>
            <h2 id={titleId}>AI总结内容</h2>
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

        <div className="ai-summary-modal__tabs" role="tablist" aria-label="总结视图">
          <button
            type="button"
            role="tab"
            id={`${bodyId}-tab-original`}
            aria-selected={tab === 'original'}
            aria-controls={`${bodyId}-panel-original`}
            className={`ai-summary-modal__tab${tab === 'original' ? ' is-active' : ''}`}
            disabled={busy}
            onClick={() => {
              setTab('original')
              setEditing(false)
            }}
          >
            原文
          </button>
          <button
            type="button"
            role="tab"
            id={`${bodyId}-tab-summary`}
            aria-selected={tab === 'summary'}
            aria-controls={`${bodyId}-panel-summary`}
            className={`ai-summary-modal__tab${tab === 'summary' ? ' is-active' : ''}`}
            disabled={busy}
            onClick={() => setTab('summary')}
          >
            AI总结内容
          </button>
        </div>

        <div id={bodyId} className="ai-summary-modal__body">
          {busy ? (
            <div className="ai-summary-modal__loading" role="status" aria-live="polite">
              <span className="ai-summary-modal__spinner" aria-hidden />
              <p>正在根据您的口述生成总结…</p>
            </div>
          ) : tab === 'original' ? (
            <div
              role="tabpanel"
              id={`${bodyId}-panel-original`}
              aria-labelledby={`${bodyId}-tab-original`}
              className="ai-summary-modal__panel"
            >
              <p className="ai-summary-modal__text">{displayOriginal}</p>
            </div>
          ) : (
            <div
              role="tabpanel"
              id={`${bodyId}-panel-summary`}
              aria-labelledby={`${bodyId}-tab-summary`}
              className="ai-summary-modal__panel"
            >
              {editing ? (
                <textarea
                  className="ai-summary-modal__editor"
                  aria-label="编辑 AI 总结"
                  value={draft}
                  rows={8}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                />
              ) : draft.trim() ? (
                <AiSummaryContent text={draft} />
              ) : (
                <p className="ai-summary-modal__text">
                  暂未生成可用总结，请返回补充口述后重试。
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="ai-summary-modal__footer">
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || tab !== 'summary'}
            onClick={() => {
              setTab('summary')
              setEditing((v) => !v)
            }}
          >
            {editing ? '完成编辑' : '编辑'}
          </button>
          <button
            type="button"
            className="btn btn--accent"
            disabled={!canSave}
            onClick={() => onSave(draft.trim())}
          >
            保存
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
