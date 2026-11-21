import './OpportunityDetail.css'
import '../../components/InsightPanel.css'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { OpportunityDraftPayload } from '../../agents/types'
import { AddInsightTaskSheet } from '../../components/AddInsightTaskSheet'
import {
  IconBuilding,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconEdit,
  IconMore,
  IconPhone,
  IconPlus,
  IconRefresh,
  IconSpark,
  IconUser,
} from '../../components/DashIcons'
import { DraftCard } from '../../components/DraftCard'
import { IconButton } from '../../components/IconButton'
import { ScreenHeader } from '../../components/ScreenHeader'
import { confirmAndSyncDetailed, discardDraft, upsertDraft } from '../../data/dataverse'
import {
  DETAIL_STAGES,
  advanceStageLocally,
  formatDateTime,
  loadOpportunityDetail,
  markOutcomeLocally,
  sentimentLabel,
  type OpportunityDetail,
  type SaveStatus,
} from '../../data/opportunityDetail'
import {
  fetchOpportunityInsight,
  formatCrmAsOf,
  formatInsightUpdatedAt,
  PRIORITY_LABEL,
  relatedVisitsForOpportunity,
  type InsightAction,
  type InsightSignalTone,
  type OpportunityInsightView,
} from '../../data/opportunityInsight'
import { STAGE_LABEL, formatMoney } from '../../data/pipeline'
import { isOnline } from '../../data/offlineQueue'

type Props = {
  opportunityId: string
  seedDrafts?: Array<OpportunityDraftPayload>
  onBack: () => void
  onOpenCapture: (accountKey?: string) => void
  onOpenAccount?: (accountKey: string) => void
  onAskCopilot?: (prompt: string) => void
}

const ACTIONS_PREVIEW = 3
const PENDING_PREVIEW = 4

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
  onAskCopilot,
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
  const [busy, setBusy] = useState(false)
  const [insightOpen, setInsightOpen] = useState(false)
  const [insight, setInsight] = useState<OpportunityInsightView | null>(null)
  const [insightLoading, setInsightLoading] = useState(false)
  const [insightError, setInsightError] = useState<string | null>(null)
  const [actionsExpanded, setActionsExpanded] = useState(false)
  const [copiedActionId, setCopiedActionId] = useState<string | null>(null)
  const [taskAction, setTaskAction] = useState<InsightAction | null>(null)
  const [addedTaskIds, setAddedTaskIds] = useState<Set<string>>(() => new Set())
  const insightRefreshCount = useRef(0)
  const insightLoadingRef = useRef(false)
  const contactsRef = useRef<HTMLUListElement | null>(null)
  const insightPanelId = useId()

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

  useEffect(() => {
    setInsight(null)
    setInsightOpen(false)
    setInsightError(null)
    setActionsExpanded(false)
    setCopiedActionId(null)
    setTaskAction(null)
    setAddedTaskIds(new Set())
    insightRefreshCount.current = 0
  }, [opportunityId])

  const recentVisits = useMemo(
    () => (detail ? relatedVisitsForOpportunity(detail) : []),
    [detail],
  )

  const loadInsight = useCallback(
    async (opts?: { forceOpen?: boolean }) => {
      if (!detail || insightLoadingRef.current) return
      insightLoadingRef.current = true
      insightRefreshCount.current += 1
      const nonce = `${Date.now().toString(36)}_${insightRefreshCount.current}`
      setInsightLoading(true)
      setInsightError(null)
      if (opts?.forceOpen) setInsightOpen(true)
      try {
        const result = await fetchOpportunityInsight(detail, {
          recentVisits,
          refreshNonce: nonce,
        })
        setInsight(result)
        setInsightOpen(true)
        setActionsExpanded(false)
      } catch {
        setInsightError('洞察刷新失败，请重试')
      } finally {
        insightLoadingRef.current = false
        setInsightLoading(false)
      }
    },
    [detail, recentVisits],
  )

  async function handleInsightToggle() {
    if (insightOpen) {
      setInsightOpen(false)
      return
    }
    if (insight) {
      setInsightOpen(true)
      return
    }
    await loadInsight({ forceOpen: true })
  }

  async function handleInsightRefresh(e?: ReactMouseEvent) {
    e?.stopPropagation()
    if (insightLoading) return
    await loadInsight({ forceOpen: true })
  }

  function scrollToContacts() {
    contactsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setInfoOpen(true)
  }

  async function copyInsightAction(action: InsightAction) {
    const lines = [
      action.title,
      action.description,
      action.contactName || action.ownerName
        ? `负责人：${action.contactName || action.ownerName}`
        : '',
      action.dueLabel ? `建议完成：${action.dueLabel}` : '',
      action.source ? `依据：${formatActionSource(action.source)}` : '',
    ].filter(Boolean)
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopiedActionId(action.id)
      window.setTimeout(() => {
        setCopiedActionId((cur) => (cur === action.id ? null : cur))
      }, 1600)
    } catch {
      /* clipboard may be unavailable */
    }
  }

  function askCopilotAbout(action: InsightAction) {
    if (!detail) return
    const prompt = `关于商机「${detail.name}」（${detail.accountName}），请协助：${action.title}。${
      action.description ? `目标：${action.description}` : ''
    }`
    onAskCopilot?.(prompt.trim())
  }

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
        <ScreenHeader
          className="screen-header--flush"
          eyebrow="加载中"
          title="商机详情"
          onBack={onBack}
        />
        <div className="opp-detail__skeleton" />
        <div className="opp-detail__skeleton" />
      </section>
    )
  }

  if (!detail) {
    return (
      <section className="opp-detail">
        <ScreenHeader className="screen-header--flush" title="商机详情" onBack={onBack} />
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

  const insightUpdatedLabel = insight ? formatInsightUpdatedAt(insight.updatedAt) : ''
  const insightCrmAsOf = insight ? formatCrmAsOf(insight.evidence.crmUpdatedAt) : ''
  const visibleInsightActions = insight
    ? actionsExpanded
      ? insight.actions
      : insight.actions.slice(0, ACTIONS_PREVIEW)
    : []
  const hiddenInsightActionCount = insight
    ? Math.max(0, insight.actions.length - ACTIONS_PREVIEW)
    : 0
  const visibleInsightPending = insight?.pendingChecks.slice(0, PENDING_PREVIEW) ?? []

  return (
    <section className="opp-detail" aria-label="商机详情">
      <ScreenHeader
        className="screen-header--flush"
        eyebrow={detail.accountName}
        title={displayName || detail.name}
        onBack={onBack}
        backLabel="返回商机列表"
        trailing={
          <div className="opp-detail__more-wrap">
            <button
              type="button"
              className="screen-header__btn"
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
        }
      />

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
          <ul className="opp-detail__contacts" ref={contactsRef}>
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

      <article
        className={`activity-detail__ai opp-detail__ai${
          insightOpen && (insight || insightLoading) ? ' is-expanded' : ''
        }${insightLoading ? ' is-loading' : ''}`}
      >
        <div className="activity-detail__ai-toolbar">
          <button
            type="button"
            className="activity-detail__ai-trigger"
            aria-expanded={insightOpen}
            aria-controls={insightPanelId}
            aria-label={insightOpen ? '收起 AI 洞察' : '展开 AI 洞察'}
            title={insightOpen ? '收起 AI 洞察' : '展开 AI 洞察'}
            onClick={() => void handleInsightToggle()}
          >
            <span className="activity-detail__ai-icon" aria-hidden>
              <IconSpark />
            </span>
            <span className="activity-detail__ai-copy">
              <span className="activity-detail__ai-title-row">
                <strong>AI 洞察</strong>
                <span className="activity-detail__ai-badge">AI 建议</span>
              </span>
              <span className="activity-detail__ai-hint">
                基于商机阶段、缺口字段和近期拜访生成
              </span>
              {insight && insightUpdatedLabel ? (
                <span className="activity-detail__ai-time">{insightUpdatedLabel}</span>
              ) : null}
            </span>
          </button>
          <div className="activity-detail__ai-actions">
            <IconButton
              variant="soft"
              size="sm"
              squared
              aria-label="刷新洞察"
              title="刷新洞察：重新读取最新数据并分析"
              disabled={insightLoading}
              onClick={(e) => void handleInsightRefresh(e)}
            >
              <IconRefresh className={insightLoading ? 'is-spinning' : undefined} />
            </IconButton>
            <IconButton
              variant="soft"
              size="sm"
              squared
              aria-label={insightOpen ? '收起洞察' : '展开洞察'}
              title={insightOpen ? '收起洞察' : '展开洞察'}
              onClick={() => void handleInsightToggle()}
            >
              {insightOpen ? <IconChevronUp /> : <IconChevronDown />}
            </IconButton>
          </div>
        </div>

        <div
          id={insightPanelId}
          className="activity-detail__ai-panel"
          hidden={!insightOpen}
          aria-busy={insightLoading}
        >
          {insightLoading && !insight ? (
            <p className="activity-detail__ai-status">正在结合阶段缺口与近期拜访生成洞察…</p>
          ) : null}

          {insightError ? (
            <div className="activity-detail__ai-error-row" role="alert">
              <p className="activity-detail__ai-error">{insightError}</p>
              <button
                type="button"
                className="activity-detail__ai-retry"
                onClick={() => void handleInsightRefresh()}
                disabled={insightLoading}
              >
                重试
              </button>
            </div>
          ) : null}

          {insight ? (
            <div className="activity-detail__ai-body">
              {insightLoading ? (
                <p className="activity-detail__ai-status">正在刷新分析…</p>
              ) : null}

              <section className="activity-insight__section" aria-labelledby={`${insightPanelId}-summary`}>
                <h4 id={`${insightPanelId}-summary`} className="activity-insight__heading">
                  商机结论
                </h4>
                <p className="activity-insight__summary">{insight.summary}</p>
              </section>

              {insight.signals.length > 0 ? (
                <section className="activity-insight__section" aria-label="关键信号">
                  <ul className="activity-insight__signals">
                    {insight.signals.map((signal) => (
                      <li
                        key={signal.id}
                        className={`activity-insight__signal is-${signalToneClass(signal.tone)}`}
                      >
                        <span className="activity-insight__signal-label">{signal.label}</span>
                        <span className="activity-insight__signal-value">{signal.value}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {visibleInsightPending.length > 0 ? (
                <section className="activity-insight__section" aria-labelledby={`${insightPanelId}-pending`}>
                  <h4 id={`${insightPanelId}-pending`} className="activity-insight__heading">
                    待核实
                  </h4>
                  <ul className="activity-insight__pending">
                    {visibleInsightPending.map((check) => (
                      <li key={check.id}>{check.text}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {insight.actions.length > 0 ? (
                <section className="activity-insight__section" aria-labelledby={`${insightPanelId}-actions`}>
                  <h4 id={`${insightPanelId}-actions`} className="activity-insight__heading">
                    下一步行动
                  </h4>
                  <ul className="activity-insight__actions">
                    {visibleInsightActions.map((action) => (
                      <li key={action.id} className="activity-insight__action">
                        <div className="activity-insight__action-main">
                          <div className="activity-insight__action-top">
                            <strong className="activity-insight__action-title">{action.title}</strong>
                            <span className={`activity-insight__priority is-${action.priority}`}>
                              {PRIORITY_LABEL[action.priority]}
                            </span>
                          </div>
                          {action.description ? (
                            <p className="activity-insight__action-desc">{action.description}</p>
                          ) : null}
                          <p className="activity-insight__action-meta">
                            {action.contactName || action.ownerName
                              ? `负责人：${action.contactName || action.ownerName}`
                              : null}
                            {(action.contactName || action.ownerName) && action.dueLabel ? ' · ' : null}
                            {action.dueLabel ? action.dueLabel : null}
                          </p>
                          {action.source ? (
                            <p className="activity-insight__action-source">
                              依据：{formatActionSource(action.source)}
                            </p>
                          ) : null}
                        </div>
                        <div className="activity-insight__action-ops">
                          <button
                            type="button"
                            className="activity-insight__op"
                            onClick={() => void copyInsightAction(action)}
                          >
                            {copiedActionId === action.id ? '已复制' : '复制建议'}
                          </button>
                          {(action.contactName || detail.contacts[0]) && (
                            <button
                              type="button"
                              className="activity-insight__op"
                              onClick={scrollToContacts}
                            >
                              查看联系人
                            </button>
                          )}
                          <button
                            type="button"
                            className={`activity-insight__op is-accent${
                              addedTaskIds.has(action.id) ? ' is-done' : ''
                            }`}
                            onClick={() => setTaskAction(action)}
                            title="选择日期并添加到任务"
                            aria-label={
                              addedTaskIds.has(action.id)
                                ? '已添加，可再次选择日期添加'
                                : '添加到任务'
                            }
                          >
                            {addedTaskIds.has(action.id) ? '已添加' : '添加到任务'}
                          </button>
                          {onAskCopilot ? (
                            <button
                              type="button"
                              className="activity-insight__op"
                              onClick={() => askCopilotAbout(action)}
                            >
                              询问 Copilot
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {hiddenInsightActionCount > 0 ? (
                    <button
                      type="button"
                      className="activity-insight__more"
                      onClick={() => setActionsExpanded((v) => !v)}
                      aria-expanded={actionsExpanded}
                    >
                      {actionsExpanded ? '收起' : `查看全部（${insight.actions.length}）`}
                    </button>
                  ) : null}
                </section>
              ) : null}

              <p className="activity-insight__evidence">
                依据：本商机
                {` · 待补字段 ${insight.evidence.missingFieldCount}`}
                {` · 近期拜访 ${insight.evidence.recentVisitCount}`}
                {insightCrmAsOf ? ` · ${insightCrmAsOf}` : ''}
                <span className="activity-insight__disclaimer">
                  {' '}
                  · 以上含 AI 建议，非正式 CRM 事实，请人工核实；不会自动改写正式商机字段
                </span>
              </p>
            </div>
          ) : null}
        </div>
      </article>

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

      <AddInsightTaskSheet
        open={Boolean(taskAction)}
        action={taskAction}
        activityId={detail.id}
        activityTitle={detail.name}
        orgName={detail.accountName}
        onClose={() => setTaskAction(null)}
        onAdded={({ actionId }) => {
          setAddedTaskIds((prev) => {
            const next = new Set(prev)
            next.add(actionId)
            return next
          })
        }}
      />
    </section>
  )
}

function signalToneClass(tone: InsightSignalTone) {
  if (tone === 'positive') return 'positive'
  if (tone === 'pending') return 'pending'
  if (tone === 'risk') return 'risk'
  if (tone === 'ai') return 'ai'
  return 'neutral'
}

function formatActionSource(source: string) {
  const map: Record<string, string> = {
    activity_notes: '活动备注',
    activity: '活动记录',
    opportunity: '本商机',
    visit: '近期拜访',
    crm: 'CRM 记录',
    missing_crm_field: '缺失 CRM 字段',
  }
  return map[source] || source
}
