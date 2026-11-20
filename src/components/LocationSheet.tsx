import './LocationSheet.css'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconBuilding, IconClose } from './DashIcons'
import { IconButton } from './IconButton'
import {
  ActionsProcurementPanel,
  OpportunityProgressPanel,
  VisitSummaryPanel,
  type ActionTimelineItem,
  type OpportunityProgressItem,
  type VisitSummaryItem,
} from './LocationPanels'
import { SheetScrim } from './SheetScrim'
import { type AgendaItem, type CalEventType } from '../data/agenda'
import { STAGE_LABEL, formatMoney } from '../data/pipeline'
import { listDrafts } from '../data/dataverse'

export type LocationVisit = VisitSummaryItem

type Props = {
  open: boolean
  item: AgendaItem
  relatedVisits?: VisitSummaryItem[]
  opportunities?: OpportunityProgressItem[]
  actions?: ActionTimelineItem[]
  onClose: () => void
}

const PLACE_PAGES = ['Visit Summary', 'Opportunity Progress', 'Actions & Procurement'] as const

const STAGE_PROGRESS: Record<string, number> = {
  Identify: 20,
  Qualify: 40,
  Propose: 50,
  Negotiate: 75,
  Closed: 100,
}

const STAGE_EN: Record<string, string> = {
  Identify: 'identify',
  Qualify: 'qualification',
  Propose: 'proposal',
  Negotiate: 'negotiation',
  Closed: 'closed',
}

function defaultRelatedVisits(item: AgendaItem): VisitSummaryItem[] {
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
      summary: item.notes.startsWith('结果:') ? item.notes : `结果: ${item.notes}`,
    },
  ]
}

function compactAmount(amount: number, currency: string) {
  if (amount >= 1_000_000) {
    return `${currency === 'USD' ? '$' : ''}${(amount / 1_000_000).toFixed(1)}M`
  }
  if (amount >= 1000) {
    const k = amount / 1000
    const label = Number.isInteger(k) ? `${k.toFixed(0)}K` : `${k.toFixed(0)}K`
    return currency === 'USD' ? `$${label}` : formatMoney(amount, currency)
  }
  return formatMoney(amount, currency)
}

function formatCloseLabel(iso: string) {
  if (!iso) return 'Close: —'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return `Close: ${iso}`
  return `Close: ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

function progressForStage(stage: string) {
  return STAGE_PROGRESS[stage] ?? 35
}

function demoOpportunitiesFor(item: AgendaItem): OpportunityProgressItem[] {
  const key = item.orgName
  if (/仁济|Renji/i.test(key)) {
    return [
      {
        id: `${item.id}-opp-n17`,
        name: '监护仪 N17 批量采购',
        progressPct: 20,
        amountLabel: '$144K',
        stageLabel: 'identify',
        closeLabel: 'Close: Sep 30',
        lastAction: '近访确认设备科兴趣；待核对采购窗口与标书细节。',
      },
      {
        id: `${item.id}-opp-service`,
        name: '原厂维保续约',
        progressPct: 40,
        amountLabel: '$62K',
        stageLabel: 'qualification',
        closeLabel: 'Close: Dec 15',
        lastAction: '服务合同到期提醒已发出，等待采购反馈。',
      },
    ]
  }
  if (/Alpha/i.test(key)) {
    return [
      {
        id: `${item.id}-opp-a1`,
        name: 'A1 监护仪 ×8',
        progressPct: 20,
        amountLabel: '$96K',
        stageLabel: 'identify',
        closeLabel: 'Close: Sep 30',
        lastAction: 'ICU 升级评估可能在 6 月启动；关注 A3 演示反馈。',
      },
    ]
  }
  return [
    {
      id: `${item.id}-opp-cloud`,
      name: 'Cloud Migration for Research Data Infrastructure',
      progressPct: 50,
      amountLabel: '$780K',
      stageLabel: 'proposal',
      closeLabel: 'Close: Jan 31',
      lastAction: `${key} needs to migrate genomics data to a secure cloud; vendor evaluation underway, budget approval pending.`,
    },
    {
      id: `${item.id}-opp-flow`,
      name: 'Patient Flow and Bed Management Intelligence',
      progressPct: 50,
      amountLabel: '$550K',
      stageLabel: 'qualification',
      closeLabel: 'Close: Oct 31',
      lastAction: `${key} wants a real-time patient flow system; Clinical Lead and Procurement are reviewing scope.`,
    },
  ]
}

function opportunitiesForAccount(item: AgendaItem): OpportunityProgressItem[] {
  const drafts = listDrafts().filter((d) => d.kind === 'opportunity')
  const fromDrafts: OpportunityProgressItem[] = drafts
    .filter((d) => {
      const name = 'accountName' in d ? d.accountName : ''
      return name && (name.includes(item.orgName) || item.orgName.includes(name))
    })
    .map((d) => {
      const opp = d as Extract<(typeof drafts)[number], { kind: 'opportunity' }>
      return {
        id: opp.idempotencyKey,
        name: opp.name || '未命名商机草稿',
        progressPct: progressForStage(opp.stage || 'Identify'),
        amountLabel: compactAmount(opp.estimatedValue || 0, opp.currency || 'USD'),
        stageLabel: STAGE_EN[opp.stage] || STAGE_LABEL[opp.stage] || (opp.stage || 'identify').toLowerCase(),
        closeLabel: formatCloseLabel(opp.closeDate || ''),
        lastAction: '本地草稿待确认后同步 CRM。',
      }
    })

  if (fromDrafts.length) return fromDrafts

  // Demo org / unmatched accounts still show representative progress cards.
  return demoOpportunitiesFor(item)
}

function defaultActions(item: AgendaItem, visits: VisitSummaryItem[]): ActionTimelineItem[] {
  const fromVisits = visits.slice(0, 3).map((visit, index) => ({
    id: `act-${visit.id}`,
    text: visit.summary.replace(/^结果[:：]\s*/, ''),
    dateLabel: visit.dateLabel,
    done: index > 0,
  }))
  if (fromVisits.length >= 2) return fromVisits
  return [
    {
      id: `${item.id}-a1`,
      text: 'Confirmed details about the mobile nursing system upgrade',
      dateLabel: 'May 28',
      done: false,
    },
    {
      id: `${item.id}-a2`,
      text: 'Held a Teams meeting to demo the remote consultation platform and answered questions',
      dateLabel: 'May 28',
      done: true,
    },
    {
      id: `${item.id}-a3`,
      text: `Aligned next steps with ${item.contacts[0]?.name || 'key contact'} on procurement timing`,
      dateLabel: 'May 17',
      done: true,
    },
  ]
}

export function LocationSheet({
  open,
  item,
  relatedVisits,
  opportunities,
  actions,
  onClose,
}: Props) {
  const [page, setPage] = useState(0)
  const visits = useMemo(() => relatedVisits ?? defaultRelatedVisits(item), [item, relatedVisits])
  const oppItems = useMemo(
    () => opportunities ?? opportunitiesForAccount(item),
    [item, opportunities],
  )
  const actionItems = useMemo(
    () => actions ?? defaultActions(item, visits),
    [actions, item, visits],
  )

  useEffect(() => {
    if (open) setPage(0)
  }, [open, item.id])

  if (!open) return null

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
          <IconButton
            className="location-sheet__close"
            variant="soft"
            size="sm"
            squared
            aria-label="关闭"
            onClick={onClose}
          >
            <IconClose />
          </IconButton>
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
                  aria-label={label}
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
          {page === 0 ? <VisitSummaryPanel items={visits} /> : null}
          {page === 1 ? <OpportunityProgressPanel items={oppItems} /> : null}
          {page === 2 ? <ActionsProcurementPanel actions={actionItems} /> : null}
        </div>
      </section>
    </div>
  )

  return host ? createPortal(sheet, host) : sheet
}

/** @deprecated Prefer VisitSummaryItem from LocationPanels */
export type { CalEventType }
