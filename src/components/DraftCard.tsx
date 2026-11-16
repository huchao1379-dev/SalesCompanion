import type { DraftPayload } from '../agents/types'
import { canConfirm, canEditDraft, canRetrySync } from '../data/syncStatus'
import { AgentLabel } from './AgentLabel'
import { SourceChips } from './SourceChips'
import { SyncStatusBadge } from './SyncStatusBadge'

type Props = {
  draft: DraftPayload
  busy?: boolean
  onChange: (next: DraftPayload) => void
  onConfirm: (draft: DraftPayload) => void
  onDiscard: (draft: DraftPayload) => void
  onRetry?: (draft: DraftPayload) => void
}

export function DraftCard({ draft, busy, onChange, onConfirm, onDiscard, onRetry }: Props) {
  const editable = canEditDraft(draft.syncStatus) && !busy

  return (
    <article className="draft-card">
      {draft.syncStatus === 'Draft' ? <div className="draft-card__ribbon">AI 草稿</div> : null}
      <header className="draft-card__header">
        <AgentLabel name={draft.agentName} />
        <div className="draft-card__meta">
          <SyncStatusBadge status={draft.syncStatus} />
          <span className="confidence">置信度 {(draft.confidence * 100).toFixed(0)}%</span>
        </div>
      </header>

      {draft.kind === 'activity' ? (
        <div className="draft-card__body">
          <label>
            主题
            <input
              value={draft.subject}
              disabled={!editable}
              onChange={(e) => onChange({ ...draft, subject: e.target.value })}
            />
          </label>
          <label>
            客户
            <input
              value={draft.accountName}
              disabled={!editable}
              onChange={(e) => onChange({ ...draft, accountName: e.target.value })}
            />
          </label>
          <label>
            联系人
            <input
              value={draft.contactName}
              disabled={!editable}
              onChange={(e) => onChange({ ...draft, contactName: e.target.value })}
            />
          </label>
          <label>
            摘要
            <textarea
              rows={3}
              value={draft.summary}
              disabled={!editable}
              onChange={(e) => onChange({ ...draft, summary: e.target.value })}
            />
          </label>
          <label>
            下次跟进
            <input
              type="date"
              value={draft.followUpAt}
              disabled={!editable}
              onChange={(e) => onChange({ ...draft, followUpAt: e.target.value })}
            />
          </label>
        </div>
      ) : (
        <div className="draft-card__body">
          <label>
            商机名称
            <input
              value={draft.name}
              disabled={!editable}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            产品线
            <input
              value={draft.productLine}
              disabled={!editable}
              onChange={(e) => onChange({ ...draft, productLine: e.target.value })}
            />
          </label>
          <div className="draft-card__row">
            <label>
              数量
              <input
                type="number"
                value={draft.quantity}
                disabled={!editable}
                onChange={(e) => onChange({ ...draft, quantity: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              预计金额 ({draft.currency})
              <input
                type="number"
                value={draft.estimatedValue}
                disabled={!editable}
                onChange={(e) =>
                  onChange({ ...draft, estimatedValue: Number(e.target.value) || 0 })
                }
              />
            </label>
          </div>
          <label>
            阶段
            <input
              value={draft.stage}
              disabled={!editable}
              onChange={(e) => onChange({ ...draft, stage: e.target.value })}
            />
          </label>
          {draft.reuseExisting ? (
            <p className="draft-card__hint">追加既有商机：{draft.existingOpportunityRef}</p>
          ) : null}
          {draft.supervisorHints.length > 0 ? (
            <ul className="draft-card__hints">
              {draft.supervisorHints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <SourceChips sources={draft.sources} />

      {draft.syncError ? <p className="draft-card__error">{draft.syncError}</p> : null}
      {draft.sapExternalId ? (
        <p className="draft-card__sap">SAP ID：{draft.sapExternalId}</p>
      ) : null}

      <footer className="draft-card__actions">
        {canConfirm(draft.syncStatus) ? (
          <>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onConfirm(draft)}>
              确认落库
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onDiscard(draft)}>
              拒绝
            </button>
          </>
        ) : null}
        {canRetrySync(draft.syncStatus) && onRetry ? (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onRetry(draft)}>
            重试同步
          </button>
        ) : null}
      </footer>
    </article>
  )
}
