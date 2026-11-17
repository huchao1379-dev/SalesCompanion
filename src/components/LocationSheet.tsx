import './LocationSheet.css'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconBuilding,
  IconCalendar,
  IconChevronRight,
  IconClose,
  IconPhone,
} from './DashIcons'
import { SheetScrim } from './SheetScrim'
import { EVENT_META, type AgendaItem, type CalEventType } from '../data/agenda'

export type LocationVisit = {
  id: string
  title: string
  type: CalEventType
  dateLabel: string
  status: string
  summary: string
}

type Props = {
  open: boolean
  item: AgendaItem
  relatedVisits?: LocationVisit[]
  onClose: () => void
}

const PLACE_PAGES = ['Visit Summary', 'Account Pulse', 'Next Actions'] as const

function defaultRelatedVisits(item: AgendaItem): LocationVisit[] {
  return [
    {
      id: `${item.id}-call`,
      title: 'NHS Trust - Mobile Nursing System Upgrade Call',
      type: 'call',
      dateLabel: 'May 28',
      status: 'draft',
      summary: '结果: Confirmed details about the mobile nursing system upgrade',
    },
    {
      id: item.id,
      title: item.title,
      type: item.type,
      dateLabel: 'May 28',
      status: item.status.toLowerCase(),
      summary: item.notes,
    },
  ]
}

export function LocationSheet({ open, item, relatedVisits, onClose }: Props) {
  const [page, setPage] = useState(0)
  const visits = useMemo(() => relatedVisits ?? defaultRelatedVisits(item), [item, relatedVisits])

  useEffect(() => {
    if (open) setPage(0)
  }, [open, item.id])

  if (!open) return null

  const pageTitle = PLACE_PAGES[page] ?? PLACE_PAGES[0]
  const host = typeof document !== 'undefined' ? document.querySelector('.app-shell') : null

  const sheet = (
    <div className="sheet-root location-sheet-root" role="presentation">
      <SheetScrim label="关闭地点信息" onClose={onClose} />
      <section className="location-sheet" role="dialog" aria-modal="true" aria-label="地点相关信息">
        <header className="location-sheet__head">
          <span className="location-sheet__org-icon" aria-hidden>
            <IconBuilding />
          </span>
          <div className="location-sheet__org-copy">
            <h2>{item.orgName}</h2>
            <p>{item.orgIndustry}</p>
          </div>
          <button type="button" className="location-sheet__close" aria-label="关闭" onClick={onClose}>
            <IconClose />
          </button>
        </header>

        <div className="location-sheet__pager">
          <div className="location-sheet__pager-track">
            <button
              type="button"
              className="location-sheet__nav"
              aria-label="上一页"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ‹
            </button>
            <div className="location-sheet__dots" role="tablist" aria-label="地点信息分页">
              {PLACE_PAGES.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={i === page}
                  className={i === page ? 'location-sheet__dot is-active' : 'location-sheet__dot'}
                  onClick={() => setPage(i)}
                />
              ))}
            </div>
            <button
              type="button"
              className="location-sheet__nav"
              aria-label="下一页"
              disabled={page >= PLACE_PAGES.length - 1}
              onClick={() => setPage((p) => Math.min(PLACE_PAGES.length - 1, p + 1))}
            >
              ›
            </button>
          </div>
        </div>

        <div className="location-sheet__body">
          <h3>{pageTitle}</h3>

          {page === 0 ? (
            <ul className="location-visit-list">
              {visits.map((visit) => (
                <li key={visit.id} className="location-visit-card">
                  <div className="location-visit-card__top">
                    <span
                      className={`location-visit-card__icon ${EVENT_META[visit.type].className}`}
                      aria-hidden
                    >
                      {visit.type === 'call' ? <IconPhone /> : <IconCalendar />}
                    </span>
                    <div className="location-visit-card__copy">
                      <div className="location-visit-card__title-row">
                        <strong>{visit.title}</strong>
                        <span className="activity-tag is-draft">{visit.status}</span>
                      </div>
                      <p>
                        {visit.dateLabel} · {EVENT_META[visit.type].label.toLowerCase()}
                      </p>
                    </div>
                  </div>
                  <div className="location-visit-card__summary">{visit.summary}</div>
                </li>
              ))}
            </ul>
          ) : null}

          {page === 1 ? (
            <div className="location-sheet__panel">
              <p className="location-sheet__panel-meta">
                <IconBuilding /> {item.orgName}
              </p>
              <p className="location-sheet__panel-meta">
                <IconPhone /> {item.orgPhone}
              </p>
              <p className="muted">
                近 30 天拜访活跃，信用评级稳定。建议在下次会面前核对采购窗口与现有商机阶段。
              </p>
            </div>
          ) : null}

          {page === 2 ? (
            <div className="location-sheet__panel">
              <ul className="location-sheet__actions">
                <li>
                  <IconChevronRight />
                  跟进 Remote Consultation 演示反馈
                </li>
                <li>
                  <IconChevronRight />
                  确认 Mobile Nursing 升级时间表
                </li>
                <li>
                  <IconChevronRight />
                  整理联系人并同步 CRM 草稿
                </li>
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )

  return host ? createPortal(sheet, host) : sheet
}
