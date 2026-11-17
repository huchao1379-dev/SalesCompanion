import { useEffect, useMemo, useState } from 'react'
import type { OpportunityDraftPayload } from '../agents/types'
import {
  IconBack,
  IconBuilding,
  IconCheck,
  IconChevronRight,
  IconEdit,
  IconMore,
  IconPhone,
  IconPlus,
  IconRefresh,
  IconSpark,
  IconUser,
} from '../components/DashIcons'
import { DraftCard } from '../components/DraftCard'
import { confirmAndSyncDetailed, discardDraft, upsertDraft } from '../data/dataverse'
import {
  DETAIL_STAGES,
  advanceStageLocally,
  formatDateTime,
  loadOpportunityDetail,
  markOutcomeLocally,
  sentimentLabel,
  type OpportunityDetail,
  type SaveStatus,
} from '../data/opportunityDetail'
import { STAGE_LABEL, formatMoney } from '../data/pipeline'
import { isOnline } from '../data/offlineQueue'

type Props = {
  opportunityId: string
  seedDrafts?: Array<OpportunityDraftPayload>
  onBack: () => void
  onOpenCapture: (accountKey?: string) => void
  onOpenAccount?: (accountKey: string) => void
}

const SAVE_LABEL: Record<SaveStatus, string> = {
  idle: '',
  saving: '保存中…',
  saved: '已保存（本地）',
  syncing: '同步中…',
  synced: '已同步',
  'sync-failed': '同步失败',
}

export function OpportunityDetailScreen({
  opportunityId,
  seedDrafts = [],
  onBack,
  onOpenCapture,
  onOpenAccount,
}: Props) {
  const [detail, setDetail] = useState<OpportunityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [originNote, setOriginNote] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [statusDetail, setStatusDetail] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<null | 'advance' | 'won' | 'lost' | 'sync' | 'visit'>(null)
  const [timelineOpen, setTimelineOpen] = useState(true)
  const [infoOpen, setInfoOpen] = useState(true)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const res = await loadOpportunityDetail(opportunityId, seedDrafts)
      setOriginNote(res.note)
      if (!res.detail) {
        setDetail(null)
        setError(res.note)
      } else {
        setDetail(res.detail)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityId])

  const stageIdx = useMemo(() => {
    if (!detail) return 0
    const i = DETAIL_STAGES.findIndex((s) => s.key === detail.stage)
    return i >= 0 ? i : 0
  }, [detail])

  const primaryCta = useMemo(() => {
    if (!detail) return { label: '记录拜访', action: 'visit' as const }
    if (detail.kind === 'draft' && detail.syncLabel === '待确认') {
      return { label: '确认并同步', action: 'sync' as const }
    }
    if (detail.syncLabel === '同步失败') {
      return { label: '重试同步', action: 'sync' as const }
    }
    if (detail.stage !== 'Closed' && detail.missingForNextStage.length === 0) {
      return { label: '推进阶段', action: 'advance' as const }
    }
    return { label: '记录拜访', action: 'visit' as const }
  }, [detail])

  function runConfirmedAction() {
    if (!detail || !confirmAction) return
    const action = confirmAction
    setConfirmAction(null)
    if (action === 'visit') return
    if (action === 'advance') {
      setSaveStatus('saving')
      const res = advanceStageLocally(detail)
      setDetail(res.detail)
      setSaveStatus('saved')
      setStatusDetail(res.message)
      return
    }
    if (action === 'won' || action === 'lost') {
      setSaveStatus('saving')
      const res = markOutcomeLocally(detail, action)
      setDetail(res.detail)
      setSaveStatus('saved')
      setStatusDetail(res.message)
      return
    }
    if (action === 'sync') {
      void handleSync()
    }
  }

  async function handleSync() {
    if (!detail?.draft) {
      setStatusDetail('仅草稿商机支持确认同步；正式管线暂无 SAP 回写接口')
      return
    }
    setBusy(true)
    setSaveStatus('syncing')
    setStatusDetail('正在同步（使用既有 idempotencyKey，避免重复创建）…')
    try {
      const { draft, viaApi } = await confirmAndSyncDetailed(detail.draft)
      if (draft.syncStatus === 'SyncFailed') {
        setSaveStatus('sync-failed')
        setStatusDetail(draft.syncError || '同步失败')
      } else if (draft.syncStatus === 'Synced') {
        setSaveStatus('synced')
        setStatusDetail(
          viaApi
            ? `已同步 · ${draft.sapExternalId || ''}`
            : `本地模拟同步 · ${draft.sapExternalId}（后端未连通，非真实 SAP 成功）`,
        )
      } else {
        setSaveStatus('syncing')
        setStatusDetail(`状态：${draft.syncStatus}`)
      }
      await reload()
    } catch (err) {
      setSaveStatus('sync-failed')
      setStatusDetail(err instanceof Error ? err.message : '同步请求失败')
    } finally {
      setBusy(false)
    }
  }

  function requestPrimary() {
    if (primaryCta.action === 'visit') {
      onOpenCapture(detail?.accountRef)
      return
    }
    setConfirmAction(primaryCta.action)
  }

  if (loading) {
    return (
      <section className="opp-detail" aria-busy="true">
        <header className="opp-detail__top">
          <button type="button" className="opp-detail__icon-btn" aria-label="返回" onClick={onBack}>
            <IconBack />
          </button>
          <div className="opp-detail__heading">
            <p className="opp-detail__account">加载中</p>
            <h1>商机详情</h1>
          </div>
          <span className="opp-detail__icon-btn is-ghost" aria-hidden />
        </header>
        <div className="opp-detail__skeleton" />
        <div className="opp-detail__skeleton" />
      </section>
    )
  }

  if (!detail) {
    return (
      <section className="opp-detail">
        <header className="opp-detail__top">
          <button type="button" className="opp-detail__icon-btn" aria-label="返回" onClick={onBack}>
            <IconBack />
          </button>
          <div className="opp-detail__heading">
            <h1>商机详情</h1>
          </div>
          <span className="opp-detail__icon-btn is-ghost" aria-hidden />
        </header>
        <div className="opp-detail__empty">
          <h2>无法加载商机</h2>
          <p>{error || '记录不存在或离线缓存中没有该商机。'}</p>
          <div className="opp-detail__empty-actions">
            <button type="button" className="btn btn--accent" onClick={() => void reload()}>
              <IconRefresh /> 重试
            </button>
            <button type="button" className="btn btn--ghost" onClick={onBack}>
              返回列表
            </button>
          </div>
        </div>
      </section>
    )
  }

  const displayName = detail.name.includes(detail.accountName)
    ? detail.name.replace(`${detail.accountName} · `, '').replace(`${detail.accountName}·`, '').trim()
    : detail.name

  return (
    <section className="opp-detail" aria-label="商机详情">
      <header className="opp-detail__top">
        <button type="button" className="opp-detail__icon-btn" aria-label="返回商机列表" onClick={onBack}>
          <IconBack />
        </button>
        <div className="opp-detail__heading">
          <p className="opp-detail__account">{detail.accountName}</p>
          <h1>{displayName || detail.name}</h1>
        </div>
        <div className="opp-detail__more-wrap">
          <button
            type="button"
            className="opp-detail__icon-btn"
            aria-label="更多操作"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <IconMore />
          </button>
          {menuOpen ? (
            <div className="opp-detail__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  setEditOpen(true)
                }}
                disabled={!detail.canEditFields}
              >
                编辑字段
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  setStatusDetail('生成报价尚未接入报价服务接口')
                }}
              >
                生成报价（未接入）
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  setConfirmAction('won')
                }}
              >
                标记赢单
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  setConfirmAction('lost')
                }}
              >
                标记输单
              </button>
              {detail.draft ? (
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => {
                    setMenuOpen(false)
                    void (async () => {
                      setBusy(true)
                      await discardDraft(detail.draft!)
                      setBusy(false)
                      onBack()
                    })()
                  }}
                >
                  拒绝草稿
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className="opp-detail__status" aria-label="商机状态">
        <div className="opp-detail__status-row">
          <span className="opp-detail__pill">{STAGE_LABEL[detail.stage] ?? detail.stage}</span>
          <span
            className={`opp-detail__pill opp-detail__pill--${
              detail.syncLabel === '待确认'
                ? 'draft'
                : detail.syncLabel === '同步失败'
                  ? 'fail'
                  : 'ok'
            }`}
          >
            {detail.kind === 'draft' ? `草稿 · ${detail.syncLabel}` : detail.syncLabel}
          </span>
        </div>
        <div className="opp-detail__status-row opp-detail__status-row--meta">
          <span className="opp-detail__meta-item">
            负责人 {detail.ownerName === '未指定' ? '未指定' : detail.ownerName}
          </span>
          <span className="opp-detail__meta-dot" aria-hidden>
            ·
          </span>
          <span className="opp-detail__meta-item">更新 {formatDateTime(detail.updatedAt)}</span>
        </div>
      </div>

      {!isOnline() ? (
        <p className="opp-detail__banner opp-detail__banner--warn" role="status">
          当前离线：可查看缓存与编辑草稿；同步需恢复网络。
        </p>
      ) : null}
      {originNote.includes('Mock') || detail.dataOrigin === 'mock' ? (
        <p className="opp-detail__banner opp-detail__banner--warn" role="status">
          {originNote || '数据含本地 Mock / 种子，非实时 SAP。'}
        </p>
      ) : null}
      {detail.permissionNote ? (
        <p className="opp-detail__banner" role="note">
          {detail.permissionNote}
        </p>
      ) : null}
      {saveStatus !== 'idle' || statusDetail ? (
        <p
          className={`opp-detail__banner opp-detail__banner--${
            saveStatus === 'sync-failed' ? 'danger' : saveStatus === 'synced' || saveStatus === 'saved' ? 'ok' : 'busy'
          }`}
          role="status"
          aria-live="polite"
        >
          {SAVE_LABEL[saveStatus]}
          {statusDetail ? ` ${statusDetail}` : ''}
          {saveStatus === 'sync-failed' && detail.draft ? (
            <button type="button" className="linkish" onClick={() => setConfirmAction('sync')}>
              重试
            </button>
          ) : null}
        </p>
      ) : null}

      <section className="opp-detail__section opp-detail__metrics" aria-label="关键指标">
        <div className="opp-detail__metric">
          <span className="opp-detail__metric-label">商机金额</span>
          <strong>{formatMoney(detail.amount, detail.currency)}</strong>
          <em>
            {detail.currency} ·{' '}
            {detail.amountState === 'pending-confirm'
              ? '待确认预估'
              : detail.amountState === 'confirmed'
                ? '已确认/已同步'
                : '预估 · 非合同额'}
          </em>
        </div>
        <div className="opp-detail__metric">
          <span className="opp-detail__metric-label">预计成交</span>
          <strong>{detail.closeDate || '待补充'}</strong>
        </div>
        <div className="opp-detail__metric opp-detail__metric--wide">
          <span className="opp-detail__metric-label">赢单概率</span>
          {detail.winForecast ? (
            <>
              <strong>{(detail.winForecast.probability * 100).toFixed(0)}%</strong>
              <em>
                {detail.winForecast.source === 'crm' ? 'CRM 预测' : 'AI 估算'} · 更新{' '}
                {formatDateTime(detail.updatedAt)}
              </em>
              {detail.winWhy.length > 0 ? (
                <ul className="opp-detail__why">
                  {detail.winWhy.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <>
              <strong className="is-muted">暂无可靠预测</strong>
              <em>未使用 AI 提取置信度冒充赢单概率；CRM 预测字段当前为空。</em>
            </>
          )}
        </div>
      </section>

      <section className="opp-detail__section" aria-label="销售阶段">
        <div className="opp-detail__section-head">
          <h2>销售阶段</h2>
        </div>
        <ol className="opp-stage-rail" aria-label="阶段进度">
          {DETAIL_STAGES.map((s, i) => (
            <li
              key={s.key}
              className={[
                i < stageIdx ? 'is-done' : '',
                i === stageIdx ? 'is-current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="opp-stage-rail__dot" aria-hidden>
                {i < stageIdx ? <IconCheck /> : i + 1}
              </span>
              <span className="opp-stage-rail__label">{s.label}</span>
            </li>
          ))}
        </ol>
        {detail.stage !== 'Closed' ? (
          <p className="opp-detail__missing">
            {detail.missingForNextStage.length > 0 ? (
              <>
                进入「{DETAIL_STAGES[Math.min(stageIdx + 1, DETAIL_STAGES.length - 1)].label}
                」还缺：{detail.missingForNextStage.join('、')}
              </>
            ) : (
              '推进下一阶段所需关键信息已齐备（仍需人工确认写入）。'
            )}
          </p>
        ) : null}
      </section>

      <section className="opp-detail__section" aria-label="关键联系人">
        <div className="opp-detail__section-head">
          <h2>关键联系人</h2>
        </div>
        {detail.contacts.length === 0 ? (
          <div className="opp-detail__empty-inline">
            <p>待补充</p>
            <button
              type="button"
              className="chip-btn is-active"
              onClick={() => {
                if (detail.canEditFields) setEditOpen(true)
                else setStatusDetail('正式管线暂无联系人写入接口，请通过新建拜访补充互动')
              }}
            >
              <IconPlus /> 添加联系人
            </button>
          </div>
        ) : (
          <ul className="opp-detail__contacts">
            {detail.contacts.map((c) => (
              <li key={c.id}>
                <span className="opp-detail__contact-icon" aria-hidden>
                  <IconUser />
                </span>
                <div>
                  <strong>
                    {c.name}
                    {detail.kind === 'draft' ? '（待确认）' : ''}
                  </strong>
                  <p>
                    {c.title || '职务待补充'} · {c.role}
                  </p>
                  <p className="muted">
                    {c.phone || c.email ? [c.phone, c.email].filter(Boolean).join(' · ') : '联系方式待补充'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="opp-detail__section" aria-label="客户互动">
        <div className="opp-detail__section-head">
          <h2>客户互动</h2>
          {detail.accountRef && onOpenAccount ? (
            <button
              type="button"
              className="opp-detail__account-link"
              onClick={() => onOpenAccount(detail.accountRef!)}
            >
              <span>客户画像</span>
              <IconChevronRight />
            </button>
          ) : null}
        </div>
        {detail.lastVisit ? (
          <div className="opp-detail__visit">
            <div className="opp-detail__visit-head">
              <span className={`opp-sentiment opp-sentiment--${detail.lastVisit.sentiment}`}>
                {sentimentLabel(detail.lastVisit.sentiment)}
              </span>
              <strong>{detail.lastVisit.date}</strong>
            </div>
            <p>{detail.lastVisit.summary}</p>
            <p className="muted">拜访结果标签仅描述互动观感，不是商机成功率。</p>
            <div className="opp-detail__visit-actions">
              <button type="button" className="chip-btn" onClick={() => setTimelineOpen(true)}>
                查看时间线
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => onOpenCapture(detail.accountRef)}
              >
                记录新拜访
              </button>
            </div>
          </div>
        ) : (
          <div className="opp-detail__empty-inline">
            <p>暂无关联拜访</p>
            <button type="button" className="chip-btn is-active" onClick={() => onOpenCapture(detail.accountRef)}>
              <IconPlus /> 新建拜访
            </button>
          </div>
        )}
      </section>

      <section className="opp-detail__section">
        <button
          type="button"
          className="opp-detail__fold"
          aria-expanded={infoOpen}
          onClick={() => setInfoOpen((v) => !v)}
        >
          <h2>商机信息</h2>
          <span>{infoOpen ? '收起' : '展开'}</span>
        </button>
        {infoOpen ? (
          <dl className="opp-detail__fields">
            <div>
              <dt>产品/服务</dt>
              <dd>{detail.productLine || '待补充'}</dd>
            </div>
            <div>
              <dt>数量</dt>
              <dd>{detail.quantity > 0 ? detail.quantity : '待补充'}</dd>
            </div>
            <div>
              <dt>金额 / 币种</dt>
              <dd>
                {formatMoney(detail.amount, detail.currency)} · {detail.currency}
              </dd>
            </div>
            <div>
              <dt>预算状态</dt>
              <dd>{detail.budgetStatus}</dd>
            </div>
            <div>
              <dt>预计成交</dt>
              <dd>{detail.closeDate || '待补充'}</dd>
            </div>
            <div>
              <dt>竞争情况</dt>
              <dd>{detail.competition}</dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{detail.sourceLabel}</dd>
            </div>
            <div>
              <dt>关联拜访</dt>
              <dd>{detail.linkedVisitLabel}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      <section className="opp-detail__section">
        <button
          type="button"
          className="opp-detail__fold"
          aria-expanded={insightsOpen}
          onClick={() => setInsightsOpen((v) => !v)}
        >
          <h2>AI 洞察</h2>
          <span>{insightsOpen ? '收起' : '展开'}</span>
        </button>
        {insightsOpen ? (
          detail.aiInsights.length === 0 ? (
            <p className="muted">暂无 AI 洞察。</p>
          ) : (
            <ul className="opp-detail__insights">
              {detail.aiInsights.map((ins) => (
                <li key={ins.id}>
                  <div className="opp-detail__insight-head">
                    <IconSpark />
                    <strong>{ins.sourceLabel}</strong>
                    {ins.needsReview ? (
                      <span className="opp-detail__pill opp-detail__pill--draft">待人工核实</span>
                    ) : null}
                  </div>
                  <p>{ins.suggestion}</p>
                  <p className="muted">
                    依据：{ins.basis} · 更新 {formatDateTime(ins.updatedAt)}
                    {ins.confidence < 0.7 ? ` · 提取置信 ${(ins.confidence * 100).toFixed(0)}%（≠赢单概率）` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )
        ) : null}
        <p className="muted opp-detail__ai-note">AI 建议不会自动改写正式商机字段。</p>
      </section>

      <section className="opp-detail__section">
        <button
          type="button"
          className="opp-detail__fold"
          aria-expanded={timelineOpen}
          onClick={() => setTimelineOpen((v) => !v)}
        >
          <h2>活动时间线</h2>
          <span>{timelineOpen ? '收起' : '展开'}</span>
        </button>
        {timelineOpen ? (
          detail.timeline.length === 0 ? (
            <p className="muted">暂无活动记录。</p>
          ) : (
            <ol className="opp-detail__timeline">
              {detail.timeline.map((ev) => (
                <li key={ev.id}>
                  <span className={`opp-detail__tl-dot opp-detail__tl-dot--${ev.type}`} aria-hidden />
                  <div>
                    <strong>{ev.title}</strong>
                    <p>{ev.summary}</p>
                    <p className="muted">
                      {formatDateTime(ev.at)} · {ev.actor} · {ev.source}
                      {ev.origin !== 'api' ? ` · ${ev.origin === 'mock' ? 'Mock' : '本地'}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )
        ) : null}
      </section>

      {editOpen && detail.draft && detail.canEditFields ? (
        <section className="opp-detail__section" aria-label="编辑草稿">
          <div className="opp-detail__section-head">
            <h2>编辑草稿</h2>
            <button type="button" className="linkish" onClick={() => setEditOpen(false)}>
              完成
            </button>
          </div>
          <DraftCard
            draft={detail.draft}
            busy={busy}
            onChange={(next) => {
              if (next.kind !== 'opportunity') return
              setSaveStatus('saving')
              upsertDraft({ ...next, updatedAt: new Date().toISOString() })
              setSaveStatus('saved')
              setStatusDetail('草稿已本地保存')
              void reload()
            }}
            onConfirm={() => setConfirmAction('sync')}
            onDiscard={(d) => {
              void (async () => {
                await discardDraft(d)
                onBack()
              })()
            }}
            onRetry={() => setConfirmAction('sync')}
          />
        </section>
      ) : null}

      <div className="opp-detail__spacer" aria-hidden />

      <footer className="opp-detail__dock" aria-label="商机操作">
        <div className="opp-detail__secondary">
          <button
            type="button"
            className="opp-detail__sec-btn"
            disabled={!detail.canEditFields}
            onClick={() => setEditOpen(true)}
          >
            <IconEdit /> 编辑
          </button>
          <button
            type="button"
            className="opp-detail__sec-btn"
            onClick={() => setStatusDetail('生成报价服务尚未接入')}
          >
            <IconBuilding /> 报价
          </button>
          <button type="button" className="opp-detail__sec-btn" onClick={() => setConfirmAction('won')}>
            <IconCheck /> 赢单
          </button>
          <button type="button" className="opp-detail__sec-btn" onClick={() => setConfirmAction('lost')}>
            输单
          </button>
        </div>
        <button
          type="button"
          className="btn btn--accent opp-detail__primary"
          disabled={busy}
          onClick={requestPrimary}
        >
          {primaryCta.action === 'visit' ? <IconPhone /> : <IconCheck />}
          {primaryCta.label}
        </button>
      </footer>

      {confirmAction ? (
        <div className="opp-detail__confirm" role="dialog" aria-modal="true" aria-labelledby="opp-confirm-title">
          <div className="opp-detail__confirm-card">
            <h3 id="opp-confirm-title">确认操作</h3>
            <p>
              {confirmAction === 'advance' &&
                '推进阶段将写入草稿或仅记录本地时间线。正式 SAP 阶段回写接口尚未接入，不会伪造成功。'}
              {confirmAction === 'sync' &&
                '确认后将调用现有 confirmDraft 同步。若后端不可用，会标记为本地 MOCK 同步，不会假装 SAP 成功。重试使用同一 idempotencyKey。'}
              {confirmAction === 'won' && '标记赢单目前仅本地记录，无 SAP 赢单接口。'}
              {confirmAction === 'lost' && '标记输单目前仅本地记录，无 SAP 输单接口。'}
            </p>
            <div className="opp-detail__confirm-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmAction(null)}>
                取消
              </button>
              <button type="button" className="btn btn--accent" onClick={runConfirmedAction}>
                确认继续
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
