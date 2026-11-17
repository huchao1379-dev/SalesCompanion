import './DraftCard.css'
import type { DraftPayload, OpportunityDraftPayload } from '../agents/types'
import { canConfirm, canEditDraft, canRetrySync } from '../data/syncStatus'
import { AgentLabel } from './AgentLabel'
import { SourceChips } from './SourceChips'
import { SyncStatusBadge } from './SyncStatusBadge'

const VISIT_TYPES = [
  { value: 'Visit', label: '上门拜访' },
  { value: 'Call', label: '电话沟通' },
  { value: 'Demo', label: '产品演示' },
  { value: 'FollowUp', label: '跟进回访' },
] as const

const OPP_STAGES = [
  { value: 'Identify', label: '识别' },
  { value: 'Qualify', label: '资格确认' },
  { value: 'Propose', label: '方案报价' },
  { value: 'Negotiate', label: '谈判' },
  { value: 'Closed', label: '成交' },
] as const

const VISIT_TYPE_VALUES = VISIT_TYPES.map((t) => t.value)
const OPP_STAGE_VALUES = OPP_STAGES.map((s) => s.value)

const LOW_CONFIDENCE = 0.62

function toLocalInput(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string) {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function isBlank(value: unknown) {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (typeof value === 'number') return !Number.isFinite(value) || value <= 0
  return false
}

function FieldMark({ missing, lowConfidence }: { missing?: boolean; lowConfidence?: boolean }) {
  if (missing) {
    return (
      <span className="field-mark field-mark--missing" title="转写中未明确提取到该字段">
        待补充
      </span>
    )
  }
  if (lowConfidence) {
    return (
      <span className="field-mark field-mark--low" title="AI 置信度较低，请人工核对">
        需核对
      </span>
    )
  }
  return null
}

type Props = {
  draft: DraftPayload
  busy?: boolean
  /** Existing open opportunities for duplicate detection (opportunity drafts). */
  openOpportunityNames?: string[]
  onChange: (next: DraftPayload) => void
  onConfirm: (draft: DraftPayload) => void
  onDiscard: (draft: DraftPayload) => void
  onRetry?: (draft: DraftPayload) => void
}

function findDuplicateHint(draft: OpportunityDraftPayload, openNames: string[]) {
  const needle = `${draft.name} ${draft.productLine}`.toLowerCase()
  return openNames.find((name) => {
    const n = name.toLowerCase()
    return (
      n.includes(draft.productLine.toLowerCase()) ||
      draft.productLine.toLowerCase().includes(n) ||
      n.includes(draft.name.toLowerCase()) ||
      needle.includes(n)
    )
  })
}

export function DraftCard({
  draft,
  busy,
  openOpportunityNames = [],
  onChange,
  onConfirm,
  onDiscard,
  onRetry,
}: Props) {
  const editable = canEditDraft(draft.syncStatus) && !busy
  const lowConf = draft.confidence < LOW_CONFIDENCE
  const kindLabel = draft.kind === 'opportunity' ? '商机' : '拜访'
  const isMockSap = Boolean(draft.sapExternalId?.startsWith('MOCK-'))

  const duplicateName =
    draft.kind === 'opportunity' ? findDuplicateHint(draft, openOpportunityNames) : undefined

  return (
    <article className={`draft-card draft-card--${draft.kind}`}>
      {draft.syncStatus === 'Draft' ? (
        <div className="draft-card__ribbon">AI · {kindLabel}</div>
      ) : null}
      <header className="draft-card__header">
        <div className="draft-card__heading">
          <span className={`draft-card__kind ${draft.kind === 'opportunity' ? 'is-opp' : 'is-visit'}`}>
            {kindLabel}
          </span>
          <AgentLabel name={draft.agentName} />
        </div>
        <div className="draft-card__meta">
          <SyncStatusBadge status={draft.syncStatus} />
          <span className={`confidence${lowConf ? ' is-low' : ''}`}>
            置信度 {(draft.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </header>

      {draft.kind === 'opportunity' && duplicateName && !draft.reuseExisting ? (
        <div className="draft-card__dup" role="status">
          <strong>可能重复商机</strong>
          <p>
            客户已有开放商机「{duplicateName}」。建议勾选「追加既有商机」，避免自动新建。
          </p>
          <button
            type="button"
            className="chip-btn is-active"
            disabled={!editable}
            onClick={() =>
              onChange({
                ...draft,
                reuseExisting: true,
                existingOpportunityRef: draft.existingOpportunityRef || duplicateName,
              })
            }
          >
            改为追加既有商机
          </button>
        </div>
      ) : null}

      {draft.kind === 'activity' ? (
        <div className="draft-card__body">
          <label className={isBlank(draft.subject) || lowConf ? 'is-uncertain' : undefined}>
            <span className="draft-card__label-row">
              主题
              <FieldMark missing={isBlank(draft.subject)} lowConfidence={!isBlank(draft.subject) && lowConf} />
            </span>
            <input
              value={draft.subject}
              disabled={!editable}
              placeholder="请补充拜访主题"
              onChange={(e) => onChange({ ...draft, subject: e.target.value })}
            />
          </label>
          <label>
            拜访类型
            <select
              value={draft.visitType}
              disabled={!editable}
              onChange={(e) => onChange({ ...draft, visitType: e.target.value })}
            >
              {VISIT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
              {!VISIT_TYPE_VALUES.includes(draft.visitType as (typeof VISIT_TYPE_VALUES)[number]) ? (
                <option value={draft.visitType}>{draft.visitType}</option>
              ) : null}
            </select>
          </label>
          <label className={isBlank(draft.accountName) ? 'is-uncertain' : undefined}>
            <span className="draft-card__label-row">
              客户
              <FieldMark missing={isBlank(draft.accountName)} />
            </span>
            <input
              value={draft.accountName}
              disabled={!editable}
              placeholder="请补充客户名称"
              onChange={(e) => onChange({ ...draft, accountName: e.target.value })}
            />
          </label>
          <label className={isBlank(draft.contactName) || lowConf ? 'is-uncertain' : undefined}>
            <span className="draft-card__label-row">
              联系人
              <FieldMark
                missing={isBlank(draft.contactName)}
                lowConfidence={!isBlank(draft.contactName) && lowConf}
              />
            </span>
            <input
              value={draft.contactName}
              disabled={!editable}
              placeholder="未识别到联系人"
              onChange={(e) => onChange({ ...draft, contactName: e.target.value })}
            />
          </label>
          <label className={isBlank(draft.summary) ? 'is-uncertain' : undefined}>
            <span className="draft-card__label-row">
              摘要
              <FieldMark missing={isBlank(draft.summary)} />
            </span>
            <textarea
              rows={3}
              value={draft.summary}
              disabled={!editable}
              placeholder="请补充拜访摘要"
              onChange={(e) => onChange({ ...draft, summary: e.target.value })}
            />
          </label>
          <div className="draft-card__row">
            <label>
              开始
              <input
                type="datetime-local"
                value={toLocalInput(draft.scheduledStart)}
                disabled={!editable}
                onChange={(e) =>
                  onChange({ ...draft, scheduledStart: fromLocalInput(e.target.value) })
                }
              />
            </label>
            <label>
              结束
              <input
                type="datetime-local"
                value={toLocalInput(draft.scheduledEnd)}
                disabled={!editable}
                onChange={(e) =>
                  onChange({ ...draft, scheduledEnd: fromLocalInput(e.target.value) })
                }
              />
            </label>
          </div>
          <label className={isBlank(draft.followUpAt) ? 'is-uncertain' : undefined}>
            <span className="draft-card__label-row">
              下次跟进
              <FieldMark missing={isBlank(draft.followUpAt)} />
            </span>
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
          <label className={isBlank(draft.name) || lowConf ? 'is-uncertain' : undefined}>
            <span className="draft-card__label-row">
              商机名称
              <FieldMark missing={isBlank(draft.name)} lowConfidence={!isBlank(draft.name) && lowConf} />
            </span>
            <input
              value={draft.name}
              disabled={!editable}
              placeholder="请补充商机名称"
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
            />
          </label>
          <label className={isBlank(draft.accountName) ? 'is-uncertain' : undefined}>
            <span className="draft-card__label-row">
              客户
              <FieldMark missing={isBlank(draft.accountName)} />
            </span>
            <input
              value={draft.accountName}
              disabled={!editable}
              placeholder="请补充客户名称"
              onChange={(e) => onChange({ ...draft, accountName: e.target.value })}
            />
          </label>
          <label className={isBlank(draft.productLine) ? 'is-uncertain' : undefined}>
            <span className="draft-card__label-row">
              产品线
              <FieldMark missing={isBlank(draft.productLine)} />
            </span>
            <input
              value={draft.productLine}
              disabled={!editable}
              placeholder="未识别到产品"
              onChange={(e) => onChange({ ...draft, productLine: e.target.value })}
            />
          </label>
          <div className="draft-card__row">
            <label className={isBlank(draft.quantity) ? 'is-uncertain' : undefined}>
              <span className="draft-card__label-row">
                数量
                <FieldMark missing={isBlank(draft.quantity)} />
              </span>
              <input
                type="number"
                value={draft.quantity || ''}
                disabled={!editable}
                placeholder="—"
                onChange={(e) => onChange({ ...draft, quantity: Number(e.target.value) || 0 })}
              />
            </label>
            <label className={isBlank(draft.estimatedValue) ? 'is-uncertain' : undefined}>
              <span className="draft-card__label-row">
                预计金额 ({draft.currency})
                <FieldMark missing={isBlank(draft.estimatedValue)} />
              </span>
              <input
                type="number"
                value={draft.estimatedValue || ''}
                disabled={!editable}
                placeholder="—"
                onChange={(e) =>
                  onChange({ ...draft, estimatedValue: Number(e.target.value) || 0 })
                }
              />
            </label>
          </div>
          <div className="draft-card__row">
            <label>
              阶段
              <select
                value={draft.stage}
                disabled={!editable}
                onChange={(e) => onChange({ ...draft, stage: e.target.value })}
              >
                {OPP_STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
                {!OPP_STAGE_VALUES.includes(draft.stage as (typeof OPP_STAGE_VALUES)[number]) ? (
                  <option value={draft.stage}>{draft.stage}</option>
                ) : null}
              </select>
            </label>
            <label className={isBlank(draft.closeDate) ? 'is-uncertain' : undefined}>
              <span className="draft-card__label-row">
                预计成交
                <FieldMark missing={isBlank(draft.closeDate)} />
              </span>
              <input
                type="date"
                value={draft.closeDate}
                disabled={!editable}
                onChange={(e) => onChange({ ...draft, closeDate: e.target.value })}
              />
            </label>
          </div>
          <label className="draft-card__check">
            <input
              type="checkbox"
              checked={draft.reuseExisting}
              disabled={!editable}
              onChange={(e) => onChange({ ...draft, reuseExisting: e.target.checked })}
            />
            追加既有商机（不新建）
          </label>
          {draft.reuseExisting ? (
            <label>
              既有商机引用
              <input
                value={draft.existingOpportunityRef ?? ''}
                disabled={!editable}
                placeholder="填写既有商机名称或编号"
                onChange={(e) => onChange({ ...draft, existingOpportunityRef: e.target.value })}
              />
            </label>
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
        <p className={`draft-card__sap${isMockSap ? ' is-mock' : ''}`}>
          {isMockSap ? '本地模拟 ID' : 'SAP ID'}：{draft.sapExternalId}
        </p>
      ) : null}

      <footer className="draft-card__actions">
        {canConfirm(draft.syncStatus) ? (
          <>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => onConfirm(draft)}
            >
              确认并同步
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => onDiscard(draft)}
            >
              拒绝
            </button>
          </>
        ) : null}
        {canRetrySync(draft.syncStatus) && onRetry ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => onRetry(draft)}
          >
            重试同步
          </button>
        ) : null}
      </footer>
    </article>
  )
}
