import './AccountInsight.css'
import { useEffect, useId, useMemo, useState } from 'react'
import { AgentLabel } from '../../components/AgentLabel'
import { ContactCard } from '../../components/ContactCard'
import {
  IconBuilding,
  IconChevronRight,
  IconEdit,
  IconEye,
  IconPlus,
  IconRefresh,
} from '../../components/DashIcons'
import { EmptyState } from '../../components/EmptyState'
import { ScreenHeader } from '../../components/ScreenHeader'
import { SourceChips } from '../../components/SourceChips'
import { SyncStatusBadge } from '../../components/SyncStatusBadge'
import {
  formatAsOf,
  formatProfileMoney,
  loadAccountProfile,
  mapSentimentLabel,
  type AccountProfileView,
  type AccountTabId,
  type ProfileInteraction,
} from '../../data/accountProfile'
import type { SyncStatus } from '../../agents/types'
import { STAGE_LABEL, formatMoney } from '../../data/pipeline'

type Props = {
  accountKey?: string
  onBack: () => void
  onCapture: () => void
  onOpenOpportunity?: (opportunityId?: string) => void
}

const TABS: Array<{ id: AccountTabId; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'contacts', label: '联系人' },
  { id: 'opportunities', label: '商机' },
  { id: 'equipment', label: '设备与服务' },
  { id: 'interactions', label: '互动记录' },
]

function normalizeSyncStatus(status?: string): SyncStatus | null {
  if (!status) return null
  const key = status.replace(/[_-\s]/g, '').toLowerCase()
  const map: Record<string, SyncStatus> = {
    draft: 'Draft',
    confirmed: 'Confirmed',
    syncing: 'Syncing',
    synced: 'Synced',
    syncfailed: 'SyncFailed',
    discarded: 'Discarded',
  }
  return map[key] ?? null
}

const INTERACTION_FILTERS: Array<{ id: 'all' | ProfileInteraction['type']; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'visit', label: '拜访' },
  { id: 'call', label: '电话' },
  { id: 'email', label: '邮件' },
  { id: 'meeting', label: '会议' },
  { id: 'opportunity', label: '商机变更' },
]

function CollapsibleText({ text, limit = 96 }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false)
  if (text.length <= limit) return <p>{text}</p>
  return (
    <div className="account-profile__collapse">
      <p>{open ? text : `${text.slice(0, limit)}…`}</p>
      <button type="button" className="account-profile__text-btn" onClick={() => setOpen((v) => !v)}>
        {open ? '收起' : '查看完整'}
      </button>
    </div>
  )
}

export function AccountInsight({
  accountKey,
  onBack,
  onCapture,
  onOpenOpportunity,
}: Props) {
  const tabsId = useId()
  const [view, setView] = useState<AccountProfileView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'not-found' | 'network' | 'forbidden' | null>(null)
  const [offline, setOffline] = useState(false)
  const [tab, setTab] = useState<AccountTabId>('overview')
  const [interactionFilter, setInteractionFilter] = useState<(typeof INTERACTION_FILTERS)[number]['id']>(
    'all',
  )
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [addContactConfirm, setAddContactConfirm] = useState(false)

  async function reload() {
    if (!accountKey) {
      setView(null)
      setError('not-found')
      setLoading(false)
      return
    }
    const res = await loadAccountProfile(accountKey)
    setOffline(res.offline)
    setView(res.view)
    setError(res.error)
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!accountKey) {
        if (!cancelled) {
          setView(null)
          setError('not-found')
          setLoading(false)
        }
        return
      }
      const res = await loadAccountProfile(accountKey)
      if (cancelled) return
      setOffline(res.offline)
      setView(res.view)
      setError(res.error)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [accountKey])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(t)
  }, [toast])

  const filteredInteractions = useMemo(() => {
    if (!view) return []
    if (interactionFilter === 'all') return view.interactions
    return view.interactions.filter((i) => i.type === interactionFilter)
  }, [view, interactionFilter])

  function showToast(msg: string) {
    setToast(msg)
  }

  function confirmAddContact() {
    setAddContactConfirm(false)
    // No write API yet — do not pretend success against CRM.
    showToast('添加联系人接口尚未开通，未写入 CRM')
  }

  if (loading && !view) {
    return (
      <section className="account-profile" aria-busy="true" aria-label="客户画像">
        <ScreenHeader className="screen-header--flush" eyebrow="客户画像" title="加载中…" onBack={onBack} />
        <div className="account-profile__state" role="status">
          <div className="account-profile__skeleton" aria-hidden />
          <div className="account-profile__skeleton" aria-hidden />
          <p className="muted">正在拉取客户关系概况…</p>
        </div>
      </section>
    )
  }

  if (error === 'forbidden') {
    return (
      <section className="account-profile" aria-label="客户画像">
        <ScreenHeader className="screen-header--flush" eyebrow="客户画像" title="无访问权限" onBack={onBack} />
        <EmptyState
          className="account-profile__empty"
          compact
          title="无访问权限"
          description="你没有查看该客户的权限。请联系管理员开通 CRM 访问。"
          actions={
            <button type="button" className="btn btn--ghost" onClick={onBack}>
              返回
            </button>
          }
        />
      </section>
    )
  }

  if (!view) {
    return (
      <section className="account-profile" aria-label="客户画像">
        <ScreenHeader
          className="screen-header--flush"
          eyebrow="客户画像"
          title="未找到客户"
          onBack={onBack}
          trailing={
            <button
              type="button"
              className="screen-header__btn"
              aria-label="重试"
              onClick={() => void reload()}
            >
              <IconRefresh />
            </button>
          }
        />
        <EmptyState
          className="account-profile__empty"
          compact
          title={error === 'network' ? '网络异常' : '未找到客户'}
          description={
            error === 'network' ? '网络异常且无可用 Mock，请检查连接后重试。' : '未找到客户画像。'
          }
          actions={
            <>
              <button type="button" className="btn btn--accent" onClick={() => void reload()}>
                重试
              </button>
              <button type="button" className="btn btn--ghost" onClick={onBack}>
                返回
              </button>
            </>
          }
        />
      </section>
    )
  }

  const h = view.header
  const rel = view.relationship
  const asOf = formatAsOf(view.asOf)

  return (
    <section className="account-profile" aria-label={`客户画像 · ${h.name}`} aria-busy={loading}>
      <ScreenHeader
        className="screen-header--flush"
        eyebrow="客户画像"
        title="客户详情"
        onBack={onBack}
        trailing={
          <button
            type="button"
            className="screen-header__btn"
            aria-label="刷新"
            onClick={() => void reload()}
          >
            <IconRefresh />
          </button>
        }
      />

      {view.dataOrigin === 'mock' || offline || error === 'network' ? (
        <p className="account-profile__banner account-profile__banner--mock" role="status">
          {offline ? '离线 · ' : error === 'network' ? '网络异常 · ' : ''}
          演示 Mock，非已同步 CRM
        </p>
      ) : null}

      {view.stale ? (
        <p className="account-profile__banner account-profile__banner--warn" role="status">
          数据可能已过期，请刷新后核对。
        </p>
      ) : null}

      <div className="account-profile__identity">
        <div className="account-profile__identity-icon" aria-hidden>
          <IconBuilding />
        </div>
        <div className="account-profile__identity-body">
          <h2 className="account-profile__name">{h.name}</h2>
          <ul className="account-profile__chips" aria-label="客户属性">
            <li>{h.accountType}</li>
            <li>{h.region}</li>
            <li>等级 {h.tier}</li>
            <li>{h.status}</li>
            <li>负责人 {h.ownerName}</li>
          </ul>
        </div>
      </div>

      <section className="account-profile__summary" aria-label="关系概况">
        <header className="account-profile__section-head">
          <h3>关系概况</h3>
          <span className="muted">截至 {asOf}</span>
        </header>
        <div className="account-profile__stats" role="list">
          <div className="account-profile__stat" role="listitem">
            <span className="account-profile__stat-label">最近联系</span>
            <strong>{rel.lastContactAt || '待补充'}</strong>
          </div>
          <div className="account-profile__stat" role="listitem">
            <span className="account-profile__stat-label">开放商机</span>
            <strong>{rel.openOppCount}</strong>
          </div>
          <div className="account-profile__stat" role="listitem">
            <span className="account-profile__stat-label">开放金额</span>
            <strong title={`币种 ${rel.currency}`}>
              {formatMoney(rel.openOppAmount, rel.currency)}
            </strong>
          </div>
          <div className="account-profile__stat" role="listitem">
            <span className="account-profile__stat-label">待跟进</span>
            <strong>{rel.pendingFollowUps}</strong>
          </div>
        </div>
      </section>

      <div className="account-profile__actions" role="group" aria-label="客户操作">
        <button type="button" className="btn btn--accent" onClick={onCapture}>
          记录拜访
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => onOpenOpportunity?.()}
        >
          <IconEye /> 查看商机
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setAddContactConfirm(true)}>
          <IconPlus /> 添加联系人
        </button>
      </div>

      <div
        className="account-profile__tabs"
        role="tablist"
        aria-label="客户画像分区"
        id={tabsId}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${tabsId}-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${tabsId}-panel-${t.id}`}
            className={`account-profile__tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className="account-profile__panel"
        role="tabpanel"
        id={`${tabsId}-panel-${tab}`}
        aria-labelledby={`${tabsId}-${tab}`}
      >
        {tab === 'overview' ? (
          <OverviewPanel
            view={view}
            feedbackFor={feedbackFor}
            onFeedback={(id) => {
              setFeedbackFor(id)
              showToast('已记录反馈（本地），未改写 CRM 正式数据')
            }}
            onEditAi={() => showToast('AI 摘要仅可反馈，不可自动改写 CRM')}
          />
        ) : null}

        {tab === 'contacts' ? (
          <ContactsPanel
            view={view}
            onAdd={() => setAddContactConfirm(true)}
          />
        ) : null}

        {tab === 'opportunities' ? (
          <OpportunitiesPanel
            view={view}
            onOpen={(id) => onOpenOpportunity?.(id)}
            onCapture={onCapture}
          />
        ) : null}

        {tab === 'equipment' ? <EquipmentPanel view={view} /> : null}

        {tab === 'interactions' ? (
          <InteractionsPanel
            rows={filteredInteractions}
            filter={interactionFilter}
            onFilter={setInteractionFilter}
            empty={view.interactions.length === 0}
            onCapture={onCapture}
          />
        ) : null}
      </div>

      {addContactConfirm ? (
        <div className="account-profile__confirm" role="dialog" aria-modal="true" aria-labelledby="add-contact-title">
          <div className="account-profile__confirm-card">
            <h3 id="add-contact-title">添加联系人</h3>
            <p className="muted">
              将打开联系人写入流程。当前环境尚未接通正式写入接口；确认后不会伪造同步成功。
            </p>
            <div className="account-profile__confirm-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setAddContactConfirm(false)}>
                取消
              </button>
              <button type="button" className="btn btn--accent" onClick={confirmAddContact}>
                确认继续
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <p className="account-profile__toast" role="status" aria-live="polite">
          {toast}
        </p>
      ) : null}
    </section>
  )
}

function OverviewPanel({
  view,
  feedbackFor,
  onFeedback,
  onEditAi,
}: {
  view: AccountProfileView
  feedbackFor: string | null
  onFeedback: (id: string) => void
  onEditAi: () => void
}) {
  const f = view.facts
  const observations = view.ai.bullets.filter((b) => b.kind === 'observation')
  const suggestions = view.ai.bullets.filter((b) => b.kind === 'suggestion')

  return (
    <div className="account-profile__stack">
      <section className="account-profile__block" aria-label="客户基本信息">
        <div className="account-profile__block-head">
          <h3>客户基本信息</h3>
          <span className="account-profile__fact-tag">CRM 已确认事实</span>
        </div>
        <dl className="account-profile__facts">
          <div>
            <dt>所属区域</dt>
            <dd>{f.region}</dd>
          </div>
          <div>
            <dt>地址</dt>
            <dd>
              {f.addressHidden
                ? '无权限查看'
                : f.address || '待补充'}
            </dd>
          </div>
          <div>
            <dt>客户等级</dt>
            <dd>{f.tier}</dd>
          </div>
          <div>
            <dt>负责人</dt>
            <dd>{f.ownerName}</dd>
          </div>
          <div>
            <dt>最近更新</dt>
            <dd>{f.updatedAt || '待补充'}</dd>
          </div>
          <div>
            <dt>MSA</dt>
            <dd>{f.hasMsa == null ? '待补充' : f.hasMsa ? '已签署' : '未签署'}</dd>
          </div>
        </dl>
      </section>

      <section className="account-profile__block account-profile__block--ai" aria-label="AI 客户摘要">
        <div className="account-profile__block-head">
          <AgentLabel name={view.ai.agentName} />
          <span className="account-profile__ai-badge">AI 摘要</span>
        </div>
        <p className="account-profile__ai-meta muted">
          非 CRM 正式字段 · 更新于 {formatAsOf(view.ai.updatedAt)}
        </p>

        <h4 className="account-profile__subhead">观察</h4>
        <ul className="account-profile__bullets">
          {observations.slice(0, 3).map((b) => (
            <li key={b.id}>
              <p>
                {b.text}
                {b.sufficiency === 'insufficient' ? (
                  <span className="account-profile__insuff">待核实</span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>

        <h4 className="account-profile__subhead">建议（未写入 CRM）</h4>
        <ul className="account-profile__bullets account-profile__bullets--suggest">
          {suggestions.length === 0 ? (
            <li>
              <p>
                信息不足，暂无可靠建议
                <span className="account-profile__insuff">待核实</span>
              </p>
            </li>
          ) : (
            suggestions.slice(0, 2).map((b) => (
              <li key={b.id}>
                <p>
                  {b.text}
                  {b.sufficiency === 'insufficient' ? (
                    <span className="account-profile__insuff">待核实</span>
                  ) : null}
                </p>
              </li>
            ))
          )}
        </ul>
        <div className="account-profile__ai-foot">
          <SourceChips sources={view.ai.sources} />
          <div className="account-profile__ai-actions">
            <button type="button" className="chip-btn" onClick={onEditAi}>
              <IconEdit /> 编辑/反馈
            </button>
            {observations[0] ? (
              <button
                type="button"
                className={`chip-btn${feedbackFor === observations[0].id ? ' is-active' : ''}`}
                onClick={() => onFeedback(observations[0].id)}
              >
                标记不准
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="account-profile__block" aria-label="近期重点">
        <h3>近期重点</h3>
        <ul className="account-profile__highlights">
          {view.highlights.map((item) => (
            <li key={item.id} className={`is-${item.tone}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="account-profile__block" aria-label="产品与合作概况">
        <h3>产品与合作概况</h3>
        {view.products.length === 0 ? (
          <div className="account-profile__empty-inline">
            <p>系统中暂无设备/产品线或采购记录</p>
          </div>
        ) : (
          <ul className="account-profile__products">
            {view.products.map((p) => (
              <li key={p.id}>
                <strong>{p.label}</strong>
                <span>{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ContactsPanel({
  view,
  onAdd,
}: {
  view: AccountProfileView
  onAdd: () => void
}) {
  if (view.contacts.length === 0) {
    return (
      <div className="account-profile__empty-inline">
        <p>暂无联系人。不会根据职位推断决策权或个人信息。</p>
        <button type="button" className="btn btn--accent" onClick={onAdd}>
          <IconPlus /> 添加联系人
        </button>
      </div>
    )
  }

  const primary = view.contacts.filter((c) => c.isPrimary)
  const others = view.contacts.filter((c) => !c.isPrimary)

  return (
    <div className="account-profile__stack">
      <section className="account-profile__block" aria-label="主要联系人">
        <div className="account-profile__block-head">
          <h3>主要联系人</h3>
          <button type="button" className="chip-btn" onClick={onAdd}>
            <IconPlus /> 添加
          </button>
        </div>
        <ul className="account-profile__contacts">
          {primary.map((c) => (
            <ContactRow key={c.id} contact={c} />
          ))}
        </ul>
      </section>
      {others.length > 0 ? (
        <section className="account-profile__block" aria-label="其他联系人">
          <h3>其他联系人</h3>
          <ul className="account-profile__contacts">
            {others.map((c) => (
              <ContactRow key={c.id} contact={c} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function ContactRow({ contact }: { contact: AccountProfileView['contacts'][number] }) {
  return (
    <li className="account-profile__contact-item">
      <ContactCard
        name={contact.name}
        title={contact.title}
        badge={contact.isPrimary ? '主联系人' : undefined}
        primary={contact.isPrimary}
        details={[
          `${contact.department} · 角色 ${contact.role}`,
          `最近联系 ${contact.lastContactAt || '待补充'}`,
        ]}
        footer={
          <p className="contact-card__footer">
            {contact.canViewChannels && contact.channelsVisible
              ? [contact.phone, contact.email].filter(Boolean).join(' · ') || '业务联系方式待补充'
              : '无权限查看联系方式'}
          </p>
        }
      />
    </li>
  )
}

function OpportunitiesPanel({
  view,
  onOpen,
  onCapture,
}: {
  view: AccountProfileView
  onOpen: (id: string) => void
  onCapture: () => void
}) {
  if (view.opportunities.length === 0) {
    return (
      <div className="account-profile__empty-inline">
        <p>暂无商机。可通过拜访录入生成草稿后确认。</p>
        <button type="button" className="btn btn--accent" onClick={onCapture}>
          记录拜访
        </button>
      </div>
    )
  }

  return (
    <ul className="account-profile__opps" aria-label="商机列表">
      {view.opportunities.map((o) => (
        <li key={o.id}>
          <button type="button" className="account-profile__opp" onClick={() => onOpen(o.id)}>
            <div className="account-profile__opp-head">
              <strong>{o.name}</strong>
              <IconChevronRight />
            </div>
            <div className="account-profile__opp-tags">
              <span className="account-profile__pill">{o.stageLabel || STAGE_LABEL[o.stage] || o.stage}</span>
              <span
                className={`account-profile__pill account-profile__pill--${
                  o.kind === 'draft' ? 'draft' : o.syncLabel === '同步失败' ? 'fail' : 'ok'
                }`}
              >
                {o.kind === 'draft' ? '草稿' : o.syncLabel}
              </span>
              {normalizeSyncStatus(o.syncStatus) ? (
                <SyncStatusBadge status={normalizeSyncStatus(o.syncStatus)!} />
              ) : null}
            </div>
            <dl className="account-profile__opp-facts">
              <div>
                <dt>预估金额</dt>
                <dd>{formatProfileMoney(o.amount, o.currency)}</dd>
              </div>
              <div>
                <dt>预计成交</dt>
                <dd>{o.closeDate}</dd>
              </div>
              <div>
                <dt>负责人</dt>
                <dd>{o.ownerName}</dd>
              </div>
              <div>
                <dt>下一步</dt>
                <dd>{o.nextAction}</dd>
              </div>
              <div>
                <dt>赢单概率</dt>
                <dd>
                  {o.winForecast ? (
                    <>
                      {(o.winForecast.probability * 100).toFixed(0)}% ·{' '}
                      {o.winForecast.source === 'crm' ? 'CRM 预测' : 'AI 估算'} · 更新{' '}
                      {formatAsOf(o.winForecast.updatedAt)}
                    </>
                  ) : (
                    '暂无可靠预测（未使用拜访情绪或 AI 置信度冒充）'
                  )}
                </dd>
              </div>
            </dl>
          </button>
        </li>
      ))}
    </ul>
  )
}

function EquipmentPanel({ view }: { view: AccountProfileView }) {
  if (!view.permissions.canViewService) {
    return (
      <div className="account-profile__empty-inline">
        <p>无权限查看设备与服务数据。</p>
      </div>
    )
  }

  if (view.equipment.length === 0) {
    return (
      <div className="account-profile__empty-inline">
        <p>暂无已安装设备或服务记录。数据缺失时不会暗示库存/装机完整。</p>
      </div>
    )
  }

  return (
    <ul className="account-profile__equipment" aria-label="设备与服务">
      {view.equipment.map((e) => (
        <li key={e.id}>
          <strong>{e.productLine}</strong>
          <p>
            状态 {e.status}
            {!e.dataComplete ? <span className="account-profile__insuff">服务数据未完整同步</span> : null}
          </p>
          <p className="muted">最近服务/节点 {e.lastServiceAt || '待补充'}</p>
          <p className="muted">未结事项：{e.openItems}</p>
          <p className="muted">来源 {e.sourceLabel}</p>
        </li>
      ))}
    </ul>
  )
}

function InteractionsPanel({
  rows,
  filter,
  onFilter,
  empty,
  onCapture,
}: {
  rows: ProfileInteraction[]
  filter: (typeof INTERACTION_FILTERS)[number]['id']
  onFilter: (id: (typeof INTERACTION_FILTERS)[number]['id']) => void
  empty: boolean
  onCapture: () => void
}) {
  return (
    <div className="account-profile__stack">
      <div className="account-profile__filters" role="toolbar" aria-label="互动类型筛选">
        {INTERACTION_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`account-profile__chip${filter === f.id ? ' is-active' : ''}`}
            aria-pressed={filter === f.id}
            onClick={() => onFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {empty ? (
        <div className="account-profile__empty-inline">
          <p>暂无互动记录。</p>
          <button type="button" className="btn btn--accent" onClick={onCapture}>
            记录拜访
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="account-profile__empty-inline">
          <p>该类型下暂无记录。</p>
        </div>
      ) : (
        <ol className="account-profile__timeline">
          {rows.map((row) => (
            <li key={row.id}>
              <time dateTime={row.at}>{row.at.slice(0, 16).replace('T', ' ')}</time>
              <div>
                <div className="account-profile__timeline-head">
                  <span className="account-profile__pill">{row.typeLabel}</span>
                  {row.sentiment ? (
                    <span className={`opp-sentiment opp-sentiment--${row.sentiment}`}>
                      {mapSentimentLabel(row.sentiment)}
                    </span>
                  ) : (
                    <span className="account-profile__pill account-profile__pill--muted">结果待补充</span>
                  )}
                </div>
                <p className="muted">参与人 {row.contactName}</p>
                <CollapsibleText text={row.summary} />
                <p className="muted">结果 {row.result} · 跟进 {row.followUp}</p>
                <p className="muted">来源 {row.sourceLabel}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
