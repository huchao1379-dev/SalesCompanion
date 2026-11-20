import type { ReactNode } from 'react'
import './LocationPanels.css'
import {
  IconBuilding,
  IconCalendar,
  IconChartBars,
  IconCheck,
  IconClock,
  IconPhone,
} from './DashIcons'
import { EVENT_META, type CalEventType } from '../data/agenda'

/** Shared section shell: title + body. Used by all three location pages. */
export function LocationPanel({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={['loc-panel', className].filter(Boolean).join(' ')}>
      <h3 className="loc-panel__title">{title}</h3>
      {children}
    </section>
  )
}

/** Grey / solid surface card used inside panels. */
export function LocationSurface({
  children,
  inset = false,
  className,
}: {
  children: ReactNode
  inset?: boolean
  className?: string
}) {
  return (
    <div
      className={['loc-surface', inset ? 'loc-surface--inset' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}

export function LocationSubhead({
  icon,
  title,
}: {
  icon: ReactNode
  title: string
}) {
  return (
    <h4 className="loc-subhead">
      <span className="loc-subhead__icon" aria-hidden>
        {icon}
      </span>
      {title}
    </h4>
  )
}

export type VisitSummaryItem = {
  id: string
  title: string
  type: CalEventType
  dateLabel: string
  status: string
  summary: string
}

export function VisitSummaryPanel({ items }: { items: VisitSummaryItem[] }) {
  return (
    <LocationPanel title="Visit Summary">
      <div className="loc-panel__stack">
        {items.map((visit) => (
          <article key={visit.id} className="loc-visit-card">
            <div className="loc-visit-card__top">
              <span
                className={`loc-visit-card__icon ${EVENT_META[visit.type].className}`}
                aria-hidden
              >
                {visit.type === 'call' ? <IconPhone /> : <IconCalendar />}
              </span>
              <div className="loc-visit-card__copy">
                <div className="loc-visit-card__title-row">
                  <strong>{visit.title}</strong>
                  <span className="activity-tag is-draft">{visit.status}</span>
                </div>
                <p>
                  {visit.dateLabel} · {EVENT_META[visit.type].label.toLowerCase()}
                </p>
              </div>
            </div>
            <div className="loc-visit-card__summary">{visit.summary}</div>
          </article>
        ))}
      </div>
    </LocationPanel>
  )
}

export type OpportunityProgressItem = {
  id: string
  name: string
  progressPct: number
  amountLabel: string
  stageLabel: string
  closeLabel: string
  lastAction: string
}

export function OpportunityProgressPanel({ items }: { items: OpportunityProgressItem[] }) {
  return (
    <LocationPanel title="Opportunity Progress">
      <div className="loc-panel__stack">
        {items.length === 0 ? (
          <LocationSurface>
            <p className="loc-copy">暂无该客户相关的开放商机。</p>
          </LocationSurface>
        ) : (
          items.map((opp) => (
            <article key={opp.id} className="loc-opp-card">
              <h4 className="loc-opp-card__title">
                {opp.name} <span>— {opp.progressPct}%</span>
              </h4>
              <p className="loc-opp-card__amount">{opp.amountLabel}</p>
              <div className="loc-opp-card__meta">
                <span>{opp.stageLabel}</span>
                <span>{opp.closeLabel}</span>
              </div>
              <div
                className="loc-opp-card__bar"
                role="progressbar"
                aria-valuenow={opp.progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${opp.name} 进度 ${opp.progressPct}%`}
              >
                <i style={{ width: `${Math.max(0, Math.min(100, opp.progressPct))}%` }} />
              </div>
              <p className="loc-opp-card__action">
                <strong>Last action:</strong> {opp.lastAction}
              </p>
            </article>
          ))
        )}
      </div>
    </LocationPanel>
  )
}

export type ActionTimelineItem = {
  id: string
  text: string
  dateLabel: string
  done?: boolean
}

export function ActionsProcurementPanel({
  actions,
  procurementEmptyLabel = 'No procurement data',
}: {
  actions: ActionTimelineItem[]
  procurementEmptyLabel?: string
}) {
  return (
    <LocationPanel title="Actions & Procurement">
      <div className="loc-panel__stack">
        <LocationSurface>
          <LocationSubhead icon={<IconClock />} title="Follow-up Actions" />
          <div className="loc-panel__stack">
            {actions.map((action) => (
              <article key={action.id} className="loc-action-card">
                <span className="loc-action-card__icon" aria-hidden>
                  {action.done ? <IconCheck /> : <IconClock />}
                </span>
                <div className="loc-action-card__body">
                  <p className="loc-action-card__text">
                    <strong>结果:</strong> {action.text}
                  </p>
                  <p className="loc-action-card__date">{action.dateLabel}</p>
                </div>
              </article>
            ))}
          </div>
        </LocationSurface>

        <LocationSurface>
          <LocationSubhead icon={<IconChartBars />} title="6-Month Procurement Trends" />
          <p className="loc-empty-bar" role="status">
            {procurementEmptyLabel}
          </p>
        </LocationSurface>
      </div>
    </LocationPanel>
  )
}

/** Compact account pulse block — reusable meta surface if needed elsewhere. */
export function AccountPulseCard({
  orgName,
  phone,
  summary,
}: {
  orgName: string
  phone: string
  summary: string
}) {
  return (
    <LocationSurface>
      <p className="loc-meta-row">
        <IconBuilding /> {orgName}
      </p>
      <p className="loc-meta-row">
        <IconPhone /> {phone}
      </p>
      <p className="loc-copy">{summary}</p>
    </LocationSurface>
  )
}
