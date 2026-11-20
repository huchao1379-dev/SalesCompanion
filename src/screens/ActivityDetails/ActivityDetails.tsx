import './ActivityDetails.css'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { AddInsightTaskSheet } from '../../components/AddInsightTaskSheet'
import { LocationSheet } from '../../components/LocationSheet'
import { ScreenHeader } from '../../components/ScreenHeader'
import { IconButton } from '../../components/IconButton'
import {
  IconBuilding,
  IconCalendar,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconNotes,
  IconPhone,
  IconPin,
  IconRefresh,
  IconSpark,
  IconTrash,
  IconUser,
} from '../../components/DashIcons'
import { buildMonthEvents, EVENT_META, type AgendaItem } from '../../data/agenda'
import {
  fetchActivityInsight,
  formatCrmAsOf,
  formatInsightUpdatedAt,
  PRIORITY_LABEL,
  relatedVisitsForActivity,
  type ActivityInsightView,
  type InsightAction,
  type InsightSignalTone,
} from '../../data/activityInsight'

type Props = {
  item: AgendaItem
  dateLabel: string
  onBack: () => void
  onAskCopilot?: (prompt: string) => void
}

const ACTIONS_PREVIEW = 3
const PENDING_PREVIEW = 3

export function ActivityDetails({ item, dateLabel, onBack, onAskCopilot }: Props) {
  const [locationOpen, setLocationOpen] = useState(false)
  const [insightOpen, setInsightOpen] = useState(false)
  const [insight, setInsight] = useState<ActivityInsightView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionsExpanded, setActionsExpanded] = useState(false)
  const [copiedActionId, setCopiedActionId] = useState<string | null>(null)
  const [taskAction, setTaskAction] = useState<InsightAction | null>(null)
  const [addedTaskIds, setAddedTaskIds] = useState<Set<string>>(() => new Set())
  const refreshCount = useRef(0)
  const loadingRef = useRef(false)
  const contactsRef = useRef<HTMLUListElement | null>(null)
  const panelId = useId()
  const typeLabel = EVENT_META[item.type].label

  const recentVisits = useMemo(() => {
    const events = buildMonthEvents(new Date())
    return relatedVisitsForActivity(item, events)
  }, [item])

  const loadInsight = useCallback(
    async (opts?: { forceOpen?: boolean }) => {
      if (loadingRef.current) return
      loadingRef.current = true
      refreshCount.current += 1
      const nonce = `${Date.now().toString(36)}_${refreshCount.current}`
      setLoading(true)
      setError(null)
      if (opts?.forceOpen) setInsightOpen(true)
      try {
        const result = await fetchActivityInsight(item, {
          recentVisits,
          refreshNonce: nonce,
        })
        setInsight(result)
        setInsightOpen(true)
        setActionsExpanded(false)
      } catch {
        setError('洞察刷新失败，请重试')
      } finally {
        loadingRef.current = false
        setLoading(false)
      }
    },
    [item, recentVisits],
  )

  useEffect(() => {
    setInsight(null)
    setInsightOpen(false)
    setError(null)
    setActionsExpanded(false)
    setCopiedActionId(null)
    setTaskAction(null)
    setAddedTaskIds(new Set())
    refreshCount.current = 0
  }, [item.id])

  async function handleToggleExpand() {
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

  async function handleRefresh(e?: ReactMouseEvent) {
    e?.stopPropagation()
    if (loading) return
    await loadInsight({ forceOpen: true })
  }

  function scrollToContacts() {
    contactsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  async function copyAction(action: InsightAction) {
    const lines = [
      action.title,
      action.description,
      action.contactName || action.ownerName
        ? `负责人：${action.contactName || action.ownerName}`
        : '',
      action.dueLabel ? `建议完成：${action.dueLabel}` : '',
      action.source ? `依据：${formatActionSource(action.source)}` : '',
    ].filter(Boolean)
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopiedActionId(action.id)
      window.setTimeout(() => {
        setCopiedActionId((cur) => (cur === action.id ? null : cur))
      }, 1600)
    } catch {
      /* clipboard may be unavailable */
    }
  }

  function askCopilotAbout(action: InsightAction) {
    const prompt = `关于活动「${item.title}」（${item.orgName}），请协助：${action.title}。${
      action.description ? `目标：${action.description}` : ''
    }`
    onAskCopilot?.(prompt.trim())
  }

  const updatedLabel = insight ? formatInsightUpdatedAt(insight.updatedAt) : ''
  const crmAsOf = insight ? formatCrmAsOf(insight.evidence.crmUpdatedAt) : ''
  const visibleActions = insight
    ? actionsExpanded
      ? insight.actions
      : insight.actions.slice(0, ACTIONS_PREVIEW)
    : []
  const hiddenActionCount = insight
    ? Math.max(0, insight.actions.length - ACTIONS_PREVIEW)
    : 0
  const visiblePending = insight?.pendingChecks.slice(0, PENDING_PREVIEW) ?? []

  return (
    <section className={`activity-detail${locationOpen ? ' is-dimmed' : ''}`}>
      <ScreenHeader
        className="screen-header--flush activity-detail__header"
        title="活动详情"
        onBack={onBack}
        trailing={
          <IconButton variant="danger" squared aria-label="删除">
            <IconTrash />
          </IconButton>
        }
      />

      <article className="activity-detail__hero">
        <div className="activity-detail__hero-main">
          <span className={`activity-detail__badge-icon ${EVENT_META[item.type].className}`} aria-hidden>
            <IconCalendar />
          </span>
          <div className="activity-detail__hero-copy">
            <h2>{item.title}</h2>
            <div className="activity-detail__tags">
              <span className="activity-tag is-draft">{item.status}</span>
              <span className="activity-tag">{typeLabel}</span>
            </div>
          </div>
        </div>

        <div className="activity-detail__when">
          <span className="activity-detail__when-icon" aria-hidden>
            <IconCalendar />
          </span>
          <div>
            <p className="activity-detail__when-date">{dateLabel}</p>
            <p className="activity-detail__when-time">{item.time}</p>
          </div>
        </div>
      </article>

      <article
        className={`activity-detail__ai${insightOpen && (insight || loading) ? ' is-expanded' : ''}${
          loading ? ' is-loading' : ''
        }`}
      >
        <div className="activity-detail__ai-toolbar">
          <button
            type="button"
            className="activity-detail__ai-trigger"
            aria-expanded={insightOpen}
            aria-controls={panelId}
            aria-label={insightOpen ? '收起 AI 洞察' : '展开 AI 洞察'}
            title={insightOpen ? '收起 AI 洞察' : '展开 AI 洞察'}
            onClick={() => void handleToggleExpand()}
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
                基于本次活动、关联商机和近期拜访生成
              </span>
              {insight && updatedLabel ? (
                <span className="activity-detail__ai-time">{updatedLabel}</span>
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
              disabled={loading}
              onClick={(e) => void handleRefresh(e)}
            >
              <IconRefresh className={loading ? 'is-spinning' : undefined} />
            </IconButton>
            <IconButton
              variant="soft"
              size="sm"
              squared
              aria-label={insightOpen ? '收起洞察' : '展开洞察'}
              title={insightOpen ? '收起洞察' : '展开洞察'}
              onClick={() => void handleToggleExpand()}
            >
              {insightOpen ? <IconChevronUp /> : <IconChevronDown />}
            </IconButton>
          </div>
        </div>

        <div
          id={panelId}
          className="activity-detail__ai-panel"
          hidden={!insightOpen}
          aria-busy={loading}
        >
          {loading && !insight ? (
            <p className="activity-detail__ai-status">正在结合商机与近期拜访生成洞察…</p>
          ) : null}

          {error ? (
            <div className="activity-detail__ai-error-row" role="alert">
              <p className="activity-detail__ai-error">{error}</p>
              <button
                type="button"
                className="activity-detail__ai-retry"
                onClick={() => void handleRefresh()}
                disabled={loading}
              >
                重试
              </button>
            </div>
          ) : null}

          {insight ? (
            <div className="activity-detail__ai-body">
              {loading ? (
                <p className="activity-detail__ai-status">正在刷新分析…</p>
              ) : null}

              <section className="activity-insight__section" aria-labelledby={`${panelId}-summary`}>
                <h4 id={`${panelId}-summary`} className="activity-insight__heading">
                  活动结论
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

              {visiblePending.length > 0 ? (
                <section className="activity-insight__section" aria-labelledby={`${panelId}-pending`}>
                  <h4 id={`${panelId}-pending`} className="activity-insight__heading">
                    待核实
                  </h4>
                  <ul className="activity-insight__pending">
                    {visiblePending.map((check) => (
                      <li key={check.id}>{check.text}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {insight.actions.length > 0 ? (
                <section className="activity-insight__section" aria-labelledby={`${panelId}-actions`}>
                  <h4 id={`${panelId}-actions`} className="activity-insight__heading">
                    下一步行动
                  </h4>
                  <ul className="activity-insight__actions">
                    {visibleActions.map((action) => (
                      <li key={action.id} className="activity-insight__action">
                        <div className="activity-insight__action-main">
                          <div className="activity-insight__action-top">
                            <strong className="activity-insight__action-title">{action.title}</strong>
                            <span
                              className={`activity-insight__priority is-${action.priority}`}
                            >
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
                            {(action.contactName || action.ownerName) && action.dueLabel
                              ? ' · '
                              : null}
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
                            onClick={() => void copyAction(action)}
                          >
                            {copiedActionId === action.id ? '已复制' : '复制建议'}
                          </button>
                          {(action.contactName || item.contacts[0]) && (
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
                  {hiddenActionCount > 0 ? (
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
                依据：本次活动
                {` · 关联商机 ${insight.evidence.opportunityCount}`}
                {` · 近期拜访 ${insight.evidence.recentVisitCount}`}
                {crmAsOf ? ` · ${crmAsOf}` : ''}
                <span className="activity-insight__disclaimer">
                  {' '}
                  · 以上含 AI 建议，非正式 CRM 事实，请人工核实
                </span>
              </p>
            </div>
          ) : null}
        </div>
      </article>

      <section className="activity-detail__card">
        <h3 className="activity-detail__section-label">相关上下文</h3>

        <button type="button" className="activity-org" onClick={() => setLocationOpen(true)}>
          <span className="activity-org__icon" aria-hidden>
            <IconBuilding />
          </span>
          <span className="activity-org__body">
            <span className="activity-org__title-row">
              <strong>{item.orgName}</strong>
              <span className="activity-org__chevron" aria-hidden>
                <IconChevronRight />
              </span>
            </span>
            <span className="activity-org__meta">{item.orgIndustry}</span>
            <span className="activity-org__meta">
              <IconPhone /> {item.orgPhone}
            </span>
            <span className="activity-org__meta">
              <IconPin /> {item.location}
            </span>
          </span>
        </button>

        <h4 className="activity-detail__section-label activity-detail__section-label--sub">
          联系人 ({item.contacts.length})
        </h4>
        <ul className="activity-contacts" ref={contactsRef}>
          {item.contacts.map((c) => (
            <li key={c.name}>
              <span className="activity-contacts__avatar" aria-hidden>
                <IconUser />
              </span>
              <span className="activity-contacts__body">
                <strong>{c.name}</strong>
                <span>{c.role}</span>
              </span>
              <a
                className="activity-contacts__phone"
                href={`tel:${c.phone.replace(/\s/g, '')}`}
                aria-label={`呼叫 ${c.name}`}
              >
                <IconPhone />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="activity-detail__card">
        <h3 className="activity-detail__section-label">详情</h3>
        <div className="activity-notes">
          <p className="activity-notes__label">
            <IconNotes /> 备注
          </p>
          <p className="activity-notes__text">{item.notes}</p>
        </div>
      </section>

      <LocationSheet open={locationOpen} item={item} onClose={() => setLocationOpen(false)} />

      <AddInsightTaskSheet
        open={Boolean(taskAction)}
        action={taskAction}
        activityId={item.id}
        activityTitle={item.title}
        orgName={item.orgName}
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
    activity_notes: '本次活动备注',
    activity: '本次活动',
    opportunity: '关联商机',
    visit: '近期拜访',
    crm: 'CRM 记录',
    missing_crm_field: '缺失 CRM 字段',
  }
  return map[source] || source
}
