import { useEffect, useMemo, useState } from 'react'
import { IconBell, IconBook, IconCalendar, IconGear } from '../components/DashIcons'
import { ProgressRing } from '../components/ProgressRing'
import { listDrafts, refreshDraftsFromApi } from '../data/dataverse'
import { subscribeDrafts } from '../data/draftStore'
import { computeHomeMetrics, fetchHomeMetrics, type HomeMetrics } from '../data/metrics'

type Props = {
  dimmed?: boolean
  onOpenBrief: () => void
  onOpenCapture: () => void
  onOpenChat: () => void
  onOpenTasks: () => void
  onOpenAccount?: () => void
}

export type CalEventType = 'meeting' | 'visit' | 'call' | 'other' | 'email'

type CalEvent = {
  day: number
  type: CalEventType
  title: string
  time: string
}

const EVENT_META: Record<CalEventType, { label: string; className: string }> = {
  meeting: { label: 'Meeting', className: 'is-meeting' },
  visit: { label: 'Visit', className: 'is-visit' },
  call: { label: 'Call', className: 'is-call' },
  other: { label: 'Other', className: 'is-other' },
  email: { label: 'Email', className: 'is-email' },
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function formatClock(now: Date) {
  let h = now.getHours()
  const m = now.getMinutes()
  const s = now.getSeconds()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${pad(h)}:${pad(m)}:${pad(s)} ${ampm}`
}

function formatDateLabel(now: Date) {
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

/** Demo schedule seeded by year/month so weekday alignment stays real. */
function buildMonthEvents(now: Date): CalEvent[] {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const today = Math.min(now.getDate(), daysInMonth)
  const clamp = (d: number) => Math.min(Math.max(d, 1), daysInMonth)

  return [
    { day: clamp(3), type: 'visit', title: '仁济医院随访', time: '10:00' },
    { day: clamp(6), type: 'visit', title: 'Hospital Alpha 拜访', time: '14:30' },
    { day: clamp(8), type: 'meeting', title: '季度管道评审', time: '09:30' },
    { day: clamp(12), type: 'call', title: '采购窗口电话确认', time: '11:00' },
    { day: clamp(15), type: 'visit', title: '客户现场演示', time: '15:00' },
    { day: clamp(15), type: 'email', title: '发送报价跟进邮件', time: '16:40' },
    { day: clamp(17), type: 'visit', title: '科室回访', time: '09:00' },
    { day: clamp(17), type: 'email', title: '合同条款确认邮件', time: '18:00' },
    { day: clamp(21), type: 'visit', title: '新商机摸底', time: '13:30' },
    { day: clamp(21), type: 'call', title: '售后问题回电', time: '16:00' },
    { day: clamp(27), type: 'meeting', title: '周复盘会议', time: '10:00' },
    { day: clamp(27), type: 'other', title: '内部资料整理', time: '15:30' },
    { day: today, type: 'meeting', title: '晨会 · 今日重点同步', time: '09:00' },
    { day: today, type: 'visit', title: '上海仁济医院拜访', time: '11:30' },
    { day: today, type: 'call', title: '跟进 N17 标书细节', time: '15:00' },
    { day: today, type: 'email', title: '发送拜访纪要', time: '17:20' },
    { day: today, type: 'other', title: '更新 CRM 草稿状态', time: '18:00' },
  ]
}

function buildMonthGrid(now: Date, events: CalEvent[]) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startPad = first.getDay() // 0 = Sunday, matches S M T W T F S
  const byDay = new Map<number, CalEventType[]>()

  events.forEach((ev) => {
    const list = byDay.get(ev.day) ?? []
    if (!list.includes(ev.type)) list.push(ev.type)
    byDay.set(ev.day, list)
  })

  const cells: Array<{ day: number | null; today: boolean; types: CalEventType[] }> = []
  for (let i = 0; i < startPad; i += 1) cells.push({ day: null, today: false, types: [] })
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({
      day: d,
      today: d === now.getDate(),
      types: byDay.get(d) ?? [],
    })
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, today: false, types: [] })
  return cells
}

export function HomeDashboard({
  dimmed = false,
  onOpenBrief: _onOpenBrief,
  onOpenCapture,
  onOpenChat,
  onOpenTasks,
  onOpenAccount,
}: Props) {
  const [now, setNow] = useState(() => new Date())
  const [metrics, setMetrics] = useState<HomeMetrics>(() => computeHomeMetrics(listDrafts()))
  const [selectedDay, setSelectedDay] = useState(() => new Date().getDate())
  const [agendaOpen, setAgendaOpen] = useState(false)

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

  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const events = useMemo(() => buildMonthEvents(new Date(now)), [dayKey])
  const calendarCells = useMemo(() => buildMonthGrid(new Date(now), events), [dayKey, events])

  useEffect(() => {
    setSelectedDay(now.getDate())
    setAgendaOpen(false)
  }, [dayKey])

  const selectedAgenda = useMemo(
    () =>
      events
        .filter((e) => e.day === selectedDay)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [events, selectedDay],
  )

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

  const quarterlyPct = Math.max(35, Math.min(92, 55 + metrics.draftAdoptionPct / 3))
  const coveragePct = Math.max(40, Math.min(100, 60 + metrics.todayVisits * 8))
  const momentumPct = Math.max(28, Math.min(88, 40 + metrics.openDrafts * 6 + metrics.pendingSync * 4))
  const overdue = Math.max(metrics.openDrafts + metrics.pendingSync, metrics.riskOpportunities, 3)

  return (
    <section className={`dash${dimmed ? ' is-dimmed' : ''}`}>
      <header className="dash__top">
        <div className="dash__clock">
          <p className="dash__date">{formatDateLabel(now)}</p>
          <h1 className="dash__time">{formatClock(now)}</h1>
        </div>
        <div className="dash__actions" aria-label="快捷入口">
          <button type="button" className="icon-btn" aria-label="目录" onClick={onOpenChat}>
            <IconBook />
          </button>
          <button type="button" className="icon-btn icon-btn--badge" aria-label="通知" onClick={onOpenTasks}>
            <IconBell />
            {overdue > 0 ? <span className="icon-btn__dot" /> : null}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="设置"
            onClick={onOpenAccount ?? onOpenCapture}
          >
            <IconGear />
          </button>
        </div>
      </header>

      <div className="metric-rail" role="list">
        <article className="metric-card" role="listitem">
          <div className="metric-card__head">
            <ProgressRing value={quarterlyPct} />
            <span className="status-pill status-pill--active">Active</span>
          </div>
          <p className="metric-card__title">Quarterly Performance</p>
          <p className="metric-card__value">$500K</p>
          <p className="metric-card__meta">Target $750K</p>
          <p className="metric-card__meta">Won/Total 3/10</p>
        </article>

        <article className="metric-card" role="listitem">
          <div className="metric-card__head">
            <ProgressRing value={coveragePct} />
            <span className="status-pill status-pill--strong">Strong</span>
          </div>
          <p className="metric-card__title">Client Coverage</p>
          <p className="metric-card__value">
            {Math.min(5, Math.max(1, metrics.todayVisits || 5))}/5
          </p>
          <p className="metric-card__meta">Accounts touched</p>
          <p className="metric-card__meta">Visits {metrics.todayVisits}</p>
        </article>

        <article className="metric-card" role="listitem">
          <div className="metric-card__head">
            <ProgressRing value={momentumPct} />
            <span className="status-pill status-pill--hot">Hot</span>
          </div>
          <p className="metric-card__title">Weekly Momentum</p>
          <p className="metric-card__value metric-card__value--split">
            <span>65</span>
            <span className="trend trend--up" aria-hidden>
              ↑
            </span>
            <span>15</span>
            <span className="trend trend--down" aria-hidden>
              ↓
            </span>
          </p>
          <p className="metric-card__meta">Drafts {metrics.openDrafts}</p>
          <p className="metric-card__meta">Risk {metrics.riskOpportunities}</p>
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
                {cell.types.length > 0 ? (
                  <span className="cal-card__dots" aria-hidden>
                    {cell.types.slice(0, 3).map((t) => (
                      <i key={t} className={`cal-dot ${EVENT_META[t].className}`} />
                    ))}
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
              {selectedAgenda.length} tasks
              <span className="cal-agenda__chevron" aria-hidden>
                ›
              </span>
            </span>
          </button>

          {agendaOpen ? (
            selectedAgenda.length === 0 ? (
              <p className="cal-agenda__empty muted">该日暂无安排</p>
            ) : (
              <ul className="cal-agenda__list">
                {selectedAgenda.map((item) => (
                  <li key={`${item.day}-${item.time}-${item.title}`} className="cal-agenda__item">
                    <span className={`cal-agenda__type ${EVENT_META[item.type].className}`} aria-hidden />
                    <div className="cal-agenda__body">
                      <p className="cal-agenda__title">{item.title}</p>
                      <p className="cal-agenda__meta">
                        {item.time} · {EVENT_META[item.type].label}
                      </p>
                    </div>
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
