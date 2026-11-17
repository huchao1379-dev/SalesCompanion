import './OpportunityDraft.css'
import { useEffect, useMemo, useState } from 'react'
import type { DraftPayload, OpportunityDraftPayload } from '../../agents/types'
import {
  IconCheck,
  IconPlus,
  IconSpark,
} from '../../components/DashIcons'
import { DraftCard } from '../../components/DraftCard'
import { ScreenHeader } from '../../components/ScreenHeader'
import { confirmAndSyncDetailed, discardDraft, upsertDraft } from '../../data/dataverse'
import { subscribeDrafts } from '../../data/draftStore'
import {
  STAGE_LABEL,
  SENTIMENT_LABEL,
  RISK_LABEL,
  computePipelineStats,
  formatMoney,
  loadPipelineSnapshot,
  type PipelineItem,
  type PipelineRisk,
  type PipelineSnapshot,
} from '../../data/pipeline'

type Props = {
  seedDrafts?: DraftPayload[]
  onBack?: () => void
  onOpenCapture?: () => void
  onOpenDetail?: (opportunityId: string) => void
}

type Filters = {
  query: string
  stage: string
  owner: string
  account: string
  closeWindow: 'all' | '30' | '90' | 'overdue'
  risk: 'all' | PipelineRisk
  kind: 'all' | 'pipeline' | 'draft' | 'failed'
}

const INITIAL_FILTERS: Filters = {
  query: '',
  stage: 'all',
  owner: 'all',
  account: 'all',
  closeWindow: 'all',
  risk: 'all',
  kind: 'all',
}

function asOppDrafts(seed: DraftPayload[]): OpportunityDraftPayload[] {
  return seed.filter((d): d is OpportunityDraftPayload => d.kind === 'opportunity')
}

function matchesCloseWindow(closeDate: string, window: Filters['closeWindow']) {
  if (window === 'all') return true
  if (!closeDate) return window === 'overdue'
  const due = new Date(closeDate).getTime()
  if (Number.isNaN(due)) return false
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  if (window === 'overdue') return due < now
  if (window === '30') return due >= now && due <= now + 30 * day
  if (window === '90') return due >= now && due <= now + 90 * day
  return true
}

function filterItems(items: PipelineItem[], filters: Filters) {
  const q = filters.query.trim().toLowerCase()
  return items.filter((item) => {
    if (filters.kind === 'pipeline' && item.kind !== 'pipeline') return false
    if (filters.kind === 'draft' && item.kind !== 'draft') return false
    if (filters.kind === 'failed' && item.syncLabel !== '同步失败') return false
    if (filters.stage !== 'all' && item.stage !== filters.stage) return false
    if (filters.owner !== 'all' && item.ownerName !== filters.owner) return false
    if (filters.account !== 'all' && item.accountName !== filters.account) return false
    if (filters.risk !== 'all' && item.risk !== filters.risk) return false
    if (!matchesCloseWindow(item.closeDate, filters.closeWindow)) return false
    if (!q) return true
    const hay = [
      item.name,
      item.accountName,
      item.contactName,
      item.productLine,
      item.ownerName,
      item.nextAction?.label || '',
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

export function OpportunityDraftScreen({
  seedDrafts = [],
  onBack,
  onOpenCapture,
  onOpenDetail,
}: Props) {
  const [snapshot, setSnapshot] = useState<PipelineSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [simulateFail, setSimulateFail] = useState(false)
  const [showDevTools, setShowDevTools] = useState(false)
  const [statusNote, setStatusNote] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    try {
      const next = await loadPipelineSnapshot(asOppDrafts(seedDrafts))
      setSnapshot(next)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    return subscribeDrafts(() => {
      void reload()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seedDrafts identity handled via reload on mount/subscribe
  }, [seedDrafts])

  const items = snapshot?.items ?? []
  const stats = useMemo(() => computePipelineStats(items), [items])
  const filtered = useMemo(() => filterItems(items, filters), [items, filters])

  const stageOptions = useMemo(() => {
    const set = new Set(items.map((i) => i.stage).filter(Boolean))
    return [...set]
  }, [items])

  const ownerOptions = useMemo(() => {
    const set = new Set(items.map((i) => i.ownerName).filter((n) => n && n !== '未指定'))
    return [...set]
  }, [items])

  const accountOptions = useMemo(() => {
    const set = new Set(items.map((i) => i.accountName).filter(Boolean))
    return [...set]
  }, [items])

  const hasActiveFilters =
    filters.query.trim() !== '' ||
    filters.stage !== 'all' ||
    filters.owner !== 'all' ||
    filters.account !== 'all' ||
    filters.closeWindow !== 'all' ||
    filters.risk !== 'all' ||
    filters.kind !== 'all'

  const emptyAll = !loading && items.length === 0
  const emptyFiltered = !loading && items.length > 0 && filtered.length === 0

  function updateDraft(next: DraftPayload) {
    if (next.kind !== 'opportunity') return
    upsertDraft({ ...next, updatedAt: new Date().toISOString() })
  }

  async function handleConfirm(draft: DraftPayload) {
    setBusy(true)
    setStatusNote('正在同步商机…')
    try {
      const { draft: synced, viaApi } = await confirmAndSyncDetailed(draft, {
        fail: simulateFail,
      })
      setStatusNote(
        synced.syncStatus === 'SyncFailed'
          ? synced.syncError || '同步失败'
          : viaApi
            ? '已同步至业务系统'
            : `本地模拟同步完成（${synced.sapExternalId}）`,
      )
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function handleDiscard(draft: DraftPayload) {
    setBusy(true)
    try {
      await discardDraft(draft)
      setExpandedId(null)
      setStatusNote('已拒绝该草稿')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  function createBlankDraft() {
    const key = `opp_manual_${Date.now().toString(36)}`
    const draft: OpportunityDraftPayload = {
      kind: 'opportunity',
      name: '',
      accountName: '',
      productLine: '',
      quantity: 0,
      estimatedValue: 0,
      currency: 'CNY',
      stage: 'Identify',
      closeDate: '',
      confidence: 0.4,
      reuseExisting: false,
      supervisorHints: ['手动创建的草稿，请补全字段后确认同步'],
      syncStatus: 'Draft',
      sources: [{ kind: 'other', label: '手动创建' }],
      agentName: '手动录入',
      idempotencyKey: key,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    upsertDraft(draft)
    setFilters((f) => ({ ...f, kind: 'draft' }))
    setExpandedId(key)
    setStatusNote('已创建空白商机草稿，请补充后确认')
    onOpenDetail?.(key)
  }

  return (
    <section className="opp-screen" aria-busy={loading}>
      <ScreenHeader
        eyebrow="管线"
        title="商机"
        onBack={onBack}
        trailing={
          <button
            type="button"
            className="screen-header__btn is-accent"
            aria-label="创建商机"
            onClick={createBlankDraft}
          >
            <IconPlus />
          </button>
        }
      />

      <article className="opp-screen__summary" aria-label="管线摘要">
        <div className="opp-screen__summary-grid" role="list">
          <div role="listitem">
            <strong>{loading ? '—' : stats.total}</strong>
            <span>商机总数</span>
          </div>
          <div role="listitem" className={stats.pendingDrafts > 0 ? 'is-warn' : undefined}>
            <strong>{loading ? '—' : stats.pendingDrafts}</strong>
            <span>待确认草稿</span>
          </div>
          <div role="listitem" className="is-ok">
            <strong>{loading ? '—' : stats.inProgress}</strong>
            <span>进行中</span>
          </div>
          <div role="listitem" className={stats.failed > 0 ? 'is-danger' : undefined}>
            <strong>{loading ? '—' : stats.failed}</strong>
            <span>同步失败</span>
          </div>
        </div>

        <div className="opp-screen__money" role="group" aria-label="管线金额">
          <div>
            <span className="opp-screen__money-label">未加权管线金额</span>
            <strong>
              {loading || stats.total === 0 ? '—' : formatMoney(stats.unweighted, stats.currency)}
            </strong>
          </div>
          <div>
            <span className="opp-screen__money-label">加权预测金额</span>
            <strong>
              {loading
                ? '—'
                : stats.weighted == null
                  ? '—'
                  : formatMoney(stats.weighted, stats.currency)}
            </strong>
            <em>
              {stats.weighted == null
                ? '暂无可靠 CRM/AI 赢单预测，未计算加权'
                : `基于 ${stats.forecastCoverage} 条有预测的商机`}
            </em>
          </div>
        </div>
      </article>

      {snapshot && snapshot.dataOrigin !== 'api' ? (
        <p className="opp-screen__origin" role="status">
          {snapshot.note}
        </p>
      ) : null}

      {statusNote ? (
        <p className="opp-screen__status" role="status">
          {statusNote}
        </p>
      ) : null}

      <div className="opp-screen__tools">
        <label className="opp-screen__search">
          <span className="visually-hidden">搜索商机</span>
          <input
            type="search"
            enterKeyHint="search"
            placeholder="搜索客户、商机、联系人…"
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          />
        </label>

        <div className="opp-screen__chips" role="toolbar" aria-label="常用筛选">
          {(
            [
              { key: 'all', label: '全部' },
              { key: 'draft', label: '待确认' },
              { key: 'pipeline', label: '正式管线' },
              { key: 'failed', label: '同步失败' },
            ] as const
          ).map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`opp-screen__chip${filters.kind === chip.key ? ' is-active' : ''}`}
              aria-pressed={filters.kind === chip.key}
              onClick={() => setFilters((f) => ({ ...f, kind: chip.key }))}
            >
              {chip.label}
            </button>
          ))}

          <label className="opp-screen__chip-select">
            <span className="visually-hidden">阶段</span>
            <select
              value={filters.stage}
              aria-label="按阶段筛选"
              onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}
            >
              <option value="all">阶段</option>
              {stageOptions.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s] ?? s}
                </option>
              ))}
            </select>
          </label>

          <label className="opp-screen__chip-select">
            <span className="visually-hidden">客户</span>
            <select
              value={filters.account}
              aria-label="按客户筛选"
              onChange={(e) => setFilters((f) => ({ ...f, account: e.target.value }))}
            >
              <option value="all">客户</option>
              {accountOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>

          <label className="opp-screen__chip-select">
            <span className="visually-hidden">负责人</span>
            <select
              value={filters.owner}
              aria-label="按负责人筛选"
              onChange={(e) => setFilters((f) => ({ ...f, owner: e.target.value }))}
            >
              <option value="all">负责人</option>
              {ownerOptions.length === 0 ? (
                <option value="未指定" disabled>
                  暂无负责人数据
                </option>
              ) : (
                ownerOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="opp-screen__chip-select">
            <span className="visually-hidden">预计成交</span>
            <select
              value={filters.closeWindow}
              aria-label="按预计成交日期筛选"
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  closeWindow: e.target.value as Filters['closeWindow'],
                }))
              }
            >
              <option value="all">成交日</option>
              <option value="30">30 天内</option>
              <option value="90">90 天内</option>
              <option value="overdue">已逾期</option>
            </select>
          </label>

          <label className="opp-screen__chip-select">
            <span className="visually-hidden">风险状态</span>
            <select
              value={filters.risk}
              aria-label="按风险状态筛选"
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  risk: e.target.value as Filters['risk'],
                }))
              }
            >
              <option value="all">风险</option>
              {(Object.keys(RISK_LABEL) as PipelineRisk[]).map((r) => (
                <option key={r} value={r}>
                  {RISK_LABEL[r]}
                </option>
              ))}
            </select>
          </label>

          {hasActiveFilters ? (
            <button
              type="button"
              className="opp-screen__chip"
              onClick={() => setFilters(INITIAL_FILTERS)}
            >
              清除
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="opp-screen__state" role="status">
          <div className="opp-screen__skeleton" aria-hidden />
          <div className="opp-screen__skeleton" aria-hidden />
          <p className="muted">正在加载商机管线…</p>
        </div>
      ) : null}

      {emptyAll ? (
        <div className="opp-screen__empty">
          <div className="opp-screen__empty-icon" aria-hidden>
            <IconSpark />
          </div>
          <h3>还没有商机</h3>
          <p>
            可从「新建拜访」口述客户意向，由 AI 生成待确认草稿；或点击右上角手动创建商机。
          </p>
          <div className="opp-screen__empty-actions">
            {onOpenCapture ? (
              <button type="button" className="btn btn--accent" onClick={onOpenCapture}>
                <IconPlus /> 新建拜访
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost" onClick={createBlankDraft}>
              创建商机
            </button>
          </div>
        </div>
      ) : null}

      {emptyFiltered ? (
        <div className="opp-screen__empty opp-screen__empty--compact">
          <h3>{filters.query ? '搜索无结果' : '筛选无结果'}</h3>
          <p className="muted">试试调整关键词或筛选条件。</p>
          <button type="button" className="btn btn--ghost" onClick={() => setFilters(INITIAL_FILTERS)}>
            清除筛选
          </button>
        </div>
      ) : null}

      {!loading && filtered.length > 0 ? (
        <div className="opp-screen__list" role="list" aria-label="商机列表">
          <div className="opp-screen__list-head">
            <h3>商机列表</h3>
            <span className="muted">
              {filtered.length} / {items.length}
            </span>
          </div>

          {filtered.map((item) => {
            const expanded = expandedId === item.id
            return (
              <article
                key={item.id}
                className={`opp-row opp-row--${item.kind}${item.risk !== 'none' ? ' is-risk' : ''}`}
                role="listitem"
              >
                <button
                  type="button"
                  className="opp-row__main"
                  aria-expanded={expanded}
                  onClick={() => {
                    if (onOpenDetail) {
                      onOpenDetail(item.id)
                      return
                    }
                    setExpandedId(expanded ? null : item.id)
                  }}
                >
                  <div className="opp-row__titles">
                    <p className="opp-row__account">{item.accountName}</p>
                    <h4 className="opp-row__name">{item.name}</h4>
                  </div>

                  <div className="opp-row__meta">
                    <span className="opp-row__stage">{STAGE_LABEL[item.stage] ?? item.stage}</span>
                    <span
                      className={`opp-row__sync opp-row__sync--${
                        item.syncLabel === '待确认'
                          ? 'draft'
                          : item.syncLabel === '同步失败'
                            ? 'fail'
                            : item.syncLabel === '已同步' || item.syncLabel === '进行中'
                              ? 'ok'
                              : 'busy'
                      }`}
                    >
                      {item.syncLabel}
                    </span>
                    {item.kind === 'draft' ? <span className="opp-row__ai">AI 草稿</span> : null}
                  </div>

                  <div className="opp-row__amount">
                    <strong>{formatMoney(item.amount, item.currency)}</strong>
                    <span>{item.currency}</span>
                  </div>

                  <div className="opp-row__line">
                    <span className="opp-row__label">联系人</span>
                    <span className="opp-row__value">
                      {item.contactName}
                      {item.contactTitle ? ` · ${item.contactTitle}` : ''}
                      {item.kind === 'draft' ? '（待确认）' : ''}
                    </span>
                  </div>

                  <div className="opp-row__line">
                    <span className="opp-row__label">最近拜访</span>
                    {item.lastVisit ? (
                      <span className="opp-row__value">
                        <em className={`opp-sentiment opp-sentiment--${item.lastVisit.sentiment}`}>
                          {SENTIMENT_LABEL[item.lastVisit.sentiment]}
                        </em>
                        {item.lastVisit.date} · {item.lastVisit.summary}
                      </span>
                    ) : (
                      <span className="opp-row__value muted">暂无拜访记录</span>
                    )}
                  </div>

                  <div className="opp-row__line">
                    <span className="opp-row__label">下一步</span>
                    <span className="opp-row__value">
                      {item.nextAction?.label || '—'}
                      {item.nextAction?.dueAt ? ` · 到期 ${item.nextAction.dueAt}` : ''}
                    </span>
                  </div>

                  <div className="opp-row__line">
                    <span className="opp-row__label">赢单预测</span>
                    <span className="opp-row__value">
                      {item.winForecast ? (
                        <>
                          {(item.winForecast.probability * 100).toFixed(0)}%
                          <em className="opp-forecast-src">
                            {item.winForecast.source === 'crm' ? 'CRM 预测' : 'AI 估算'}
                          </em>
                        </>
                      ) : (
                        <span className="muted">暂无可靠预测</span>
                      )}
                    </span>
                  </div>

                  {item.pendingFields.length > 0 ? (
                    <div className="opp-row__pending">
                      待确认：{item.pendingFields.join('、')}
                    </div>
                  ) : null}

                  {item.risk !== 'none' ? (
                    <div className="opp-row__risk">{RISK_LABEL[item.risk]}</div>
                  ) : null}
                </button>

                {expanded && item.kind === 'draft' && item.draft ? (
                  <div className="opp-row__editor">
                    <DraftCard
                      draft={item.draft}
                      busy={busy}
                      openOpportunityNames={items
                        .filter((i) => i.kind === 'pipeline')
                        .map((i) => i.name)}
                      onChange={updateDraft}
                      onConfirm={(draft) => {
                        void handleConfirm(draft)
                      }}
                      onDiscard={(draft) => {
                        void handleDiscard(draft)
                      }}
                      onRetry={(draft) => {
                        void handleConfirm({ ...draft, syncStatus: 'Draft' })
                      }}
                    />
                  </div>
                ) : null}

                {expanded && item.kind === 'pipeline' ? (
                  <div className="opp-row__detail">
                    <p>
                      <strong>产品</strong> {item.productLine || '—'}
                      {item.quantity ? ` · 数量 ${item.quantity}` : ''}
                    </p>
                    <p>
                      <strong>负责人</strong> {item.ownerName}
                    </p>
                    <p>
                      <strong>预计成交</strong> {item.closeDate || '未填写'}
                    </p>
                    <p className="muted">
                      正式管线记录来自 {item.dataOrigin === 'mock' ? '本地 Mock' : '服务端种子库'}
                      ，确认前不会伪造 SAP 写入成功。
                    </p>
                    {onOpenCapture ? (
                      <button type="button" className="btn btn--ghost" onClick={onOpenCapture}>
                        为此客户新建拜访
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}

      {stats.pendingDrafts > 0 && onOpenCapture ? (
        <article className="opp-screen__hint">
          <span className="opp-screen__hint-icon" aria-hidden>
            <IconCheck />
          </span>
          <div>
            <strong>有 {stats.pendingDrafts} 条 AI 草稿待确认</strong>
            <p>展开条目可编辑金额、阶段与联系人；确认前不直写 SAP。</p>
          </div>
        </article>
      ) : null}

      <details
        className="opp-screen__dev"
        open={showDevTools}
        onToggle={(e) => setShowDevTools((e.target as HTMLDetailsElement).open)}
      >
        <summary>开发选项</summary>
        <label className="opp-screen__fail-toggle">
          <input
            type="checkbox"
            checked={simulateFail}
            onChange={(e) => setSimulateFail(e.target.checked)}
          />
          模拟 SAP 同步失败（草稿确认路径）
        </label>
        <button type="button" className="linkish" style={{ marginTop: '0.5rem' }} onClick={() => void reload()}>
          重新加载管线
        </button>
      </details>
    </section>
  )
}
