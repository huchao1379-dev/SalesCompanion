import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  IconBell,
  IconBook,
  IconCalendar,
  IconChevronRight,
  IconMoon,
  IconPhone,
  IconPin,
  IconSun,
} from '../../components/DashIcons'
import { IconButton } from '../../components/IconButton'
import { ProgressRing } from '../../components/ProgressRing'
import {
  buildMonthEvents,
  EVENT_META,
  type AgendaItem,
  type CalEventType,
} from '../../data/agenda'
import { listDrafts, refreshDraftsFromApi } from '../../data/dataverse'
import { subscribeDrafts } from '../../data/draftStore'
import {
  formatDateKey,
  formatTimeRange,
  listInsightTasksForDate,
  listInsightTaskDaysInMonth,
  subscribeInsightTasks,
  toggleInsightTaskDone,
  type InsightTask,
} from '../../data/insightTasks'
import { PRIORITY_LABEL } from '../../data/activityInsight'
import { computeHomeMetrics, fetchHomeMetrics, type HomeMetrics } from '../../data/metrics'
import { useTheme } from '../../theme/ThemeContext'
import './HomeDashboard.css'

/** Mock unread message count for the header badge (no navigation yet). */
const MOCK_MESSAGE_COUNT = 3

type Props = {
  dimmed?: boolean
  onOpenBrief: () => void
  onOpenCapture: () => void
  onOpenChat: () => void
  onOpenTasks: () => void
  onOpenOpportunity?: () => void
  onOpenAccount?: () => void
  onOpenActivity: (item: AgendaItem) => void
}

function formatClock(now: Date) {
  // Always 24-hour (e.g. 13:27:05), never 01:27:05 PM.
  return now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatDateLabel(now: Date) {
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function agendaIcon(type: CalEventType): ReactNode {
  if (type === 'call') return <IconPhone />
  return <IconPin />
}

function buildMonthGrid(now: Date, events: AgendaItem[], taskDays: Set<number>) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startPad = first.getDay()
  const byDay = new Map<number, CalEventType[]>()

  events.forEach((ev) => {
    const list = byDay.get(ev.day) ?? []
    if (!list.includes(ev.type)) list.push(ev.type)
    byDay.set(ev.day, list)
  })

  const cells: Array<{
    day: number | null
    today: boolean
    types: CalEventType[]
    hasTask: boolean
  }> = []
  for (let i = 0; i < startPad; i += 1) {
    cells.push({ day: null, today: false, types: [], hasTask: false })
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({
      day: d,
      today: d === now.getDate(),
      types: byDay.get(d) ?? [],
      hasTask: taskDays.has(d),
    })
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: null, today: false, types: [], hasTask: false })
  }
  return cells
}

export function HomeDashboard({
  dimmed = false,
  onOpenBrief,
  onOpenActivity,
}: Props) {
  const { theme, toggleTheme } = useTheme()
  const [now, setNow] = useState(() => new Date())
  const [metrics, setMetrics] = useState<HomeMetrics>(() => computeHomeMetrics(listDrafts()))
  const [selectedDay, setSelectedDay] = useState(() => new Date().getDate())
  const [agendaOpen, setAgendaOpen] = useState(false)
  const [insightTasksTick, setInsightTasksTick] = useState(0)
  const messageCount = MOCK_MESSAGE_COUNT
  const messageBadge = messageCount > 99 ? '99+' : String(messageCount)

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    void (async () => {
      await refreshDraftsFromApi()
      setMetrics(await fetchHomeMetrics())
    })()
    return subscribeDrafts((drafts) => {
      setMetrics(computeHomeMetrics(drafts))
    })
  }, [])

  useEffect(() => {
    return subscribeInsightTasks(() => {
      setInsightTasksTick((n) => n + 1)
    })
  }, [])

  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const events = useMemo(() => buildMonthEvents(new Date(now)), [dayKey])
  const taskDays = useMemo(
    () => listInsightTaskDaysInMonth(now.getFullYear(), now.getMonth()),
    [dayKey, insightTasksTick],
  )
  const calendarCells = useMemo(
    () => buildMonthGrid(new Date(now), events, taskDays),
    [dayKey, events, taskDays],
  )

  /* eslint-disable react-hooks/set-state-in-effect -- keep the calendar selection aligned when the day rolls over. */
  useEffect(() => {
    setSelectedDay(now.getDate())
    setAgendaOpen(false)
  }, [dayKey])
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectedAgenda = useMemo(
    () =>
      events
        .filter((e) => e.day === selectedDay)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [events, selectedDay],
  )

  const selectedDateKey = useMemo(() => {
    const d = new Date(now.getFullYear(), now.getMonth(), selectedDay)
    return formatDateKey(d)
  }, [now, selectedDay])

  const selectedInsightTasks = useMemo(
    () => listInsightTasksForDate(selectedDateKey),
    [selectedDateKey, insightTasksTick],
  )

  const agendaCount = selectedAgenda.length + selectedInsightTasks.length

  const isSelectedToday = selectedDay === now.getDate()
  const agendaTitle = isSelectedToday
    ? "Today's Agenda"
    : `${now.toLocaleDateString('en-US', { month: 'short' })} ${selectedDay} Agenda`

  const legend = useMemo(() => {
    const counts: Record<CalEventType, number> = {
      meeting: 0,
      visit: 0,
      call: 0,
      other: 0,
      email: 0,
    }
    events.forEach((e) => {
      counts[e.type] += 1
    })
    return (Object.keys(EVENT_META) as CalEventType[]).map((type) => ({
      type,
      count: counts[type],
      ...EVENT_META[type],
    }))
  }, [events])

  const quarterlyWon = 500
  const quarterlyTarget = 750
  const quarterlyPct = Math.round((quarterlyWon / quarterlyTarget) * 100)

  const coverageTouched = Math.min(5, Math.max(0, metrics.todayVisits || 5))
  const coverageTotal = 5
  const coveragePct = Math.round((coverageTouched / coverageTotal) * 100)

  const momentumUp = 65
  const momentumDown = 15
  const momentumPct = Math.round((momentumUp / momentumDown) * 100)
  const overdue = Math.max(metrics.openDrafts + metrics.pendingSync, metrics.riskOpportunities, 3)

  return (
    <section className={`dash${dimmed ? ' is-dimmed' : ''}`}>
      <header className="dash__top">
        <div className="dash__clock">
          <p className="dash__date">{formatDateLabel(now)}</p>
          <h1 className="dash__time">{formatClock(now)}</h1>
        </div>
        <div className="dash__actions" aria-label="快捷入口">
          <IconButton aria-label="今日播报" onClick={onOpenBrief}>
            <IconBook />
          </IconButton>
          <IconButton
            aria-label={`消息 ${messageBadge} 条`}
            badge={messageCount > 0 ? messageBadge : undefined}
          >
            <IconBell />
          </IconButton>
          <IconButton
            aria-label={theme === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </IconButton>
        </div>
      </header>

      <div className="metric-rail" role="list">
        <article className="metric-card" role="listitem">
          <div className="metric-card__head">
            <ProgressRing value={quarterlyPct} size={52} stroke={6} />
            <span className="status-pill status-pill--active">Active</span>
          </div>
          <p className="metric-card__title">Quarterly Performance</p>
          <p className="metric-card__value">${quarterlyWon}K</p>
          <p className="metric-card__meta metric-card__meta--row">
            <span>Target</span>
            <span>${quarterlyTarget}K</span>
          </p>
          <p className="metric-card__meta metric-card__meta--row">
            <span>Won/Total</span>
            <span>3/10</span>
          </p>
        </article>

        <article className="metric-card" role="listitem">
          <div className="metric-card__head">
            <ProgressRing value={coveragePct} size={52} stroke={6} />
            <span className="status-pill status-pill--strong">Strong</span>
          </div>
          <p className="metric-card__title">Client Coverage</p>
          <p className="metric-card__value">
            {coverageTouched}/{coverageTotal}
          </p>
        </article>

        <article className="metric-card" role="listitem">
          <div className="metric-card__head">
            <ProgressRing value={momentumPct} size={52} stroke={6} />
            <span className="status-pill status-pill--hot">Hot</span>
          </div>
          <p className="metric-card__title">Weekly Momentum</p>
          <p className="metric-card__value">
            {momentumUp}/{momentumDown}
          </p>
        </article>
      </div>

      <section className="cal-card">
        <header className="cal-card__head">
          <div className="cal-card__title">
            <span className="cal-card__icon" aria-hidden>
              <IconCalendar />
            </span>
            <div>
              <p className="cal-card__eyebrow">Monthly Calendar</p>
              <strong>{monthLabel}</strong>
            </div>
          </div>
          <span className="status-pill status-pill--warn">{overdue} overdue</span>
        </header>

        <div className="cal-card__week" aria-hidden>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <span key={`${d}-${i}`}>{d}</span>
          ))}
        </div>

        <div className="cal-card__grid">
          {calendarCells.map((cell, i) =>
            cell.day == null ? (
              <span key={i} className="cal-card__day is-empty" />
            ) : (
              <button
                key={i}
                type="button"
                className={[
                  'cal-card__day',
                  cell.today ? 'is-today' : '',
                  selectedDay === cell.day ? 'is-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={selectedDay === cell.day}
                aria-label={`${monthLabel} ${cell.day}`}
                onClick={() => {
                  setSelectedDay(cell.day as number)
                  setAgendaOpen(false)
                }}
              >
                <span className="cal-card__day-num">{cell.day}</span>
                {cell.types.length > 0 || cell.hasTask ? (
                  <span className="cal-card__dots" aria-hidden>
                    {cell.types.slice(0, cell.hasTask ? 2 : 3).map((t) => (
                      <i key={t} className={`cal-dot ${EVENT_META[t].className}`} />
                    ))}
                    {cell.hasTask ? <i className="cal-dot is-insight-task" /> : null}
                  </span>
                ) : (
                  <span className="cal-card__dots cal-card__dots--spacer" aria-hidden />
                )}
              </button>
            ),
          )}
        </div>

        <ul className="cal-legend" aria-label="日程类型图例">
          {legend.map((item) => (
            <li key={item.type}>
              <i className={`cal-dot ${item.className}`} aria-hidden />
              <span>
                {item.label} ({item.count})
              </span>
            </li>
          ))}
        </ul>

        <div className={`cal-agenda${agendaOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            className="cal-agenda__head"
            aria-expanded={agendaOpen}
            onClick={() => setAgendaOpen((v) => !v)}
          >
            <span className="cal-agenda__head-left">
              <IconCalendar />
              <strong>{agendaTitle}</strong>
            </span>
            <span className="cal-agenda__head-right">
              {agendaCount} tasks
              <span className="cal-agenda__chevron" aria-hidden>
                ›
              </span>
            </span>
          </button>

          {agendaOpen ? (
            agendaCount === 0 ? (
              <p className="cal-agenda__empty muted">该日暂无安排</p>
            ) : (
              <ul className="cal-agenda__list">
                {selectedAgenda.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="cal-agenda__item"
                      onClick={() => onOpenActivity(item)}
                    >
                      <span className={`cal-agenda__icon ${EVENT_META[item.type].className}`} aria-hidden>
                        {agendaIcon(item.type)}
                      </span>
                      <span className="cal-agenda__body">
                        <span className="cal-agenda__title">{item.title}</span>
                        <span className="cal-agenda__meta">
                          <IconPin />
                          {item.location}
                        </span>
                      </span>
                      <span className="cal-agenda__go" aria-hidden>
                        <IconChevronRight />
                      </span>
                    </button>
                  </li>
                ))}
                {selectedInsightTasks.map((task) => (
                  <li key={task.id}>
                    <InsightTaskAgendaRow
                      task={task}
                      onToggle={() => toggleInsightTaskDone(task.id)}
                    />
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </section>
    </section>
  )
}

function InsightTaskAgendaRow({
  task,
  onToggle,
}: {
  task: InsightTask
  onToggle: () => void
}) {
  const timeLabel = formatTimeRange(task.startTime || '09:00', task.endTime || '10:00')
  return (
    <button
      type="button"
      className={`cal-agenda__item cal-agenda__item--task${task.done ? ' is-done' : ''}`}
      onClick={onToggle}
      aria-pressed={task.done}
      aria-label={task.done ? `取消完成：${task.title}` : `标记完成：${task.title}`}
    >
      <span className="cal-agenda__icon is-insight-task" aria-hidden>
        <IconBook />
      </span>
      <span className="cal-agenda__body">
        <span className="cal-agenda__title">{task.title}</span>
        <span className="cal-agenda__meta">
          {timeLabel}
          {` · ${PRIORITY_LABEL[task.priority]}`}
          {task.orgName ? ` · ${task.orgName}` : ''}
          {task.description ? ` · ${task.description}` : ''}
        </span>
      </span>
      <span className="cal-agenda__task-state" aria-hidden>
        {task.done ? '已完成' : '待办'}
      </span>
    </button>
  )
}
