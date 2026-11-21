import { api, ApiRequestError } from '../api/client'
import type {
  InsightAction,
  InsightActionPriority,
  InsightActionType,
  InsightPendingCheck,
  InsightSignal,
  InsightSignalTone,
} from './activityInsight'
import {
  formatCrmAsOf,
  formatInsightUpdatedAt,
  PRIORITY_LABEL,
} from './activityInsight'
import type { OpportunityDetail } from './opportunityDetail'

export type OpportunityInsightEvidence = {
  opportunityIncluded: boolean
  recentVisitCount: number
  missingFieldCount: number
  crmUpdatedAt: string | null
}

export type OpportunityInsightView = {
  summary: string
  signals: InsightSignal[]
  pendingChecks: InsightPendingCheck[]
  actions: InsightAction[]
  evidence: OpportunityInsightEvidence
  updatedAt: string
  mode: 'deepseek' | 'heuristic' | 'copilotstudio'
  agentName: string
  visitCount: number
  missingFieldCount: number
}

export { PRIORITY_LABEL, formatInsightUpdatedAt, formatCrmAsOf }
export type {
  InsightAction,
  InsightActionPriority,
  InsightActionType,
  InsightPendingCheck,
  InsightSignal,
  InsightSignalTone,
}

type InsightActionInput = {
  id?: string
  title?: string
  description?: string
  priority?: InsightActionPriority
  ownerName?: string | null
  contactName?: string | null
  dueAt?: string | null
  dueLabel?: string | null
  source?: string
  actionType?: InsightActionType
}

type InsightPayloadInput = {
  summary?: string
  signals?: InsightSignal[]
  pendingChecks?: InsightPendingCheck[]
  actions?: InsightActionInput[]
  evidence?: Partial<OpportunityInsightEvidence> | null
  updatedAt?: string
  mode?: OpportunityInsightView['mode']
  agentName?: string
  visitCount?: number
  missingFieldCount?: number
}

function normalizeActions(actions: InsightActionInput[] | undefined): InsightAction[] {
  if (!Array.isArray(actions)) return []
  return actions
    .map((action, index) => ({
      id: String(action.id || `action_${index + 1}`),
      title: String(action.title || '').trim(),
      description: String(action.description || '').trim(),
      priority: action.priority || 'this_week',
      ownerName: action.ownerName ?? null,
      contactName: action.contactName ?? null,
      dueAt: action.dueAt ?? null,
      dueLabel: action.dueLabel ?? null,
      source: action.source || 'opportunity',
      actionType: action.actionType || 'follow_up',
    }))
    .filter((action) => action.title)
}

function normalizeInsight(raw: InsightPayloadInput): OpportunityInsightView {
  const evidence = raw.evidence || {
    opportunityIncluded: true,
    recentVisitCount: raw.visitCount ?? 0,
    missingFieldCount: raw.missingFieldCount ?? 0,
    crmUpdatedAt: null,
  }
  return {
    summary: String(raw.summary || '').trim() || '洞察结果待确认。',
    signals: Array.isArray(raw.signals) ? raw.signals : [],
    pendingChecks: Array.isArray(raw.pendingChecks) ? raw.pendingChecks : [],
    actions: normalizeActions(raw.actions),
    evidence: {
      opportunityIncluded: evidence.opportunityIncluded !== false,
      recentVisitCount: evidence.recentVisitCount ?? 0,
      missingFieldCount: evidence.missingFieldCount ?? 0,
      crmUpdatedAt: evidence.crmUpdatedAt ?? null,
    },
    updatedAt: raw.updatedAt || new Date().toISOString(),
    mode: raw.mode === 'deepseek' || raw.mode === 'copilotstudio' ? raw.mode : 'heuristic',
    agentName: raw.agentName || '商机洞察 Agent',
    visitCount: evidence.recentVisitCount ?? raw.visitCount ?? 0,
    missingFieldCount: evidence.missingFieldCount ?? raw.missingFieldCount ?? 0,
  }
}

export type OpportunityRecentVisit = {
  title: string
  time?: string
  status?: string
  notes?: string
}

/** Timeline / last-visit rows used as「近期拜访」context for the agent. */
export function relatedVisitsForOpportunity(detail: OpportunityDetail): OpportunityRecentVisit[] {
  const fromTimeline = detail.timeline
    .filter((ev) => ev.type === 'visit' || ev.type === 'call' || ev.type === 'email')
    .slice(0, 5)
    .map((ev) => ({
      title: ev.title,
      time: ev.at,
      status: ev.source,
      notes: ev.summary,
    }))
  if (fromTimeline.length > 0) return fromTimeline
  if (detail.lastVisit) {
    return [
      {
        title: '客户拜访',
        time: detail.lastVisit.date,
        status: detail.lastVisit.sentiment,
        notes: detail.lastVisit.summary,
      },
    ]
  }
  return []
}

export async function fetchOpportunityInsight(
  detail: OpportunityDetail,
  opts?: { recentVisits?: OpportunityRecentVisit[]; refreshNonce?: string },
): Promise<OpportunityInsightView> {
  try {
    if (!(await api.supportsOpportunityInsight())) {
      return localHeuristicInsight(detail, opts?.recentVisits)
    }
    const result = await api.opportunityInsight({
      opportunity: {
        id: detail.id,
        name: detail.name,
        accountName: detail.accountName,
        accountRef: detail.accountRef,
        stage: detail.stage,
        amount: detail.amount,
        currency: detail.currency,
        closeDate: detail.closeDate || undefined,
        productLine: detail.productLine || undefined,
        quantity: detail.quantity,
        ownerName: detail.ownerName,
        contactName: detail.contactName,
        syncLabel: detail.syncLabel,
        kind: detail.kind,
        budgetStatus: detail.budgetStatus,
        competition: detail.competition,
        missingForNextStage: detail.missingForNextStage,
        supervisorHints: detail.draft?.supervisorHints,
        lastVisit: detail.lastVisit,
        winForecast: detail.winForecast,
        contacts: detail.contacts.map((c) => ({
          name: c.name,
          role: c.role,
          title: c.title,
        })),
      },
      recentVisits: opts?.recentVisits,
      refreshNonce: opts?.refreshNonce,
    })
    return normalizeInsight(result)
  } catch (err) {
    if (
      err instanceof ApiRequestError &&
      (err.kind === 'network' || err.status === 404 || err.status === 502 || err.status === 503)
    ) {
      return localHeuristicInsight(detail, opts?.recentVisits)
    }
    throw err
  }
}

function localHeuristicInsight(
  detail: OpportunityDetail,
  recentVisits?: OpportunityRecentVisit[],
): OpportunityInsightView {
  const contact = detail.contacts[0]?.name || detail.contactName || null
  const visitCount = recentVisits?.length ?? (detail.lastVisit ? 1 : 0)
  const missing = detail.missingForNextStage || []
  const stageLabel =
    detail.stage === 'Identify'
      ? '识别'
      : detail.stage === 'Qualify'
        ? '资格确认'
        : detail.stage === 'Propose'
          ? '方案报价'
          : detail.stage === 'Negotiate'
            ? '谈判'
            : detail.stage === 'Closed'
              ? '成交'
              : detail.stage

  const gapClause =
    missing.length > 0
      ? `进入下一阶段仍缺：${missing.slice(0, 3).join('、')}${missing.length > 3 ? '等' : ''}。`
      : detail.stage === 'Closed'
        ? '商机已关闭，以复盘与归档为主。'
        : '推进下一阶段所需关键信息已较齐备，仍需人工确认写入。'

  const visitClause = detail.lastVisit?.summary
    ? `最近互动（${detail.lastVisit.date}）：${detail.lastVisit.summary.slice(0, 60)}${
        detail.lastVisit.summary.length > 60 ? '…' : ''
      }`
    : visitCount > 0
      ? `同客户近期有 ${visitCount} 条拜访记录可参考`
      : '暂无可靠客户互动记录'

  const summary = `「${detail.name}」当前处于${stageLabel}阶段。${gapClause}${visitClause}。关键预算、竞争与决策节奏仍待核实。`

  const pendingChecks: InsightPendingCheck[] = missing.slice(0, 3).map((field, i) => ({
    id: `missing_${i + 1}`,
    text: `待补充：${field}`,
    source: 'missing_crm_field',
  }))
  if (!detail.lastVisit?.summary && visitCount === 0) {
    pendingChecks.push({
      id: 'next_touch',
      text: '下次客户触达时间尚未确定',
      source: 'missing_crm_field',
    })
  }
  pendingChecks.push({
    id: 'budget',
    text: '预算到位情况尚待确认',
    source: 'missing_crm_field',
  })

  const actions: InsightAction[] = []
  if (missing.length > 0) {
    actions.push({
      id: 'fill_missing',
      title: `补齐「${missing[0]}」等推进字段`,
      description: `对照进入下一阶段缺口：${missing.slice(0, 3).join('、')}`,
      priority: 'immediate',
      ownerName: detail.ownerName !== '未指定' ? detail.ownerName : contact,
      contactName: contact,
      dueAt: null,
      dueLabel: '建议当日',
      source: 'missing_crm_field',
      actionType: 'opportunity',
    })
  } else if (detail.stage !== 'Closed') {
    actions.push({
      id: 'confirm_advance',
      title: `确认是否推进「${detail.name}」至下一阶段`,
      description: '关键信息已较齐备，推进前仍需人工确认',
      priority: 'this_week',
      ownerName: detail.ownerName !== '未指定' ? detail.ownerName : contact,
      contactName: contact,
      dueAt: null,
      dueLabel: '本周内',
      source: 'opportunity',
      actionType: 'opportunity',
    })
  }
  actions.push({
    id: 'follow_contact',
    title: contact && contact !== '待确认' && contact !== '未指定' ? `跟进联系人${contact}` : '确认主联系人并安排跟进',
    description: detail.lastVisit?.summary
      ? '围绕最近互动中的未决问题闭环'
      : '补充决策链与联系方式，避免跟进断档',
    priority: 'immediate',
    ownerName: detail.ownerName !== '未指定' ? detail.ownerName : contact,
    contactName: contact,
    dueAt: null,
    dueLabel: '建议 2 日内',
    source: detail.lastVisit ? 'visit' : 'opportunity',
    actionType: 'follow_up',
  })
  actions.push({
    id: 'schedule_next_touch',
    title: visitCount > 0 || detail.lastVisit ? '设定下次拜访或演示' : `为「${detail.accountName}」安排拜访`,
    description: '结合近期互动节奏，在日历中留痕',
    priority: 'this_week',
    ownerName: detail.ownerName !== '未指定' ? detail.ownerName : contact,
    contactName: contact,
    dueAt: null,
    dueLabel: '本周内',
    source: 'visit',
    actionType: 'meeting',
  })
  if (detail.kind === 'draft') {
    actions.push({
      id: 'review_draft',
      title: '核验草稿字段后确认同步',
      description: 'AI/手动草稿不会自动改写正式商机，需人工确认',
      priority: 'immediate',
      ownerName: detail.ownerName !== '未指定' ? detail.ownerName : contact,
      contactName: contact,
      dueAt: null,
      dueLabel: '建议当日',
      source: 'crm',
      actionType: 'opportunity',
    })
  }

  const syncTone: InsightSignalTone =
    detail.syncLabel === '待确认' || detail.syncLabel === '同步中'
      ? 'pending'
      : detail.syncLabel === '同步失败'
        ? 'risk'
        : 'neutral'

  const signals: InsightSignal[] = [
    {
      id: 'stage',
      label: '当前阶段',
      value: stageLabel,
      tone: detail.stage === 'Closed' ? 'positive' : 'neutral',
      source: 'opportunity',
    },
    {
      id: 'sync_status',
      label: '同步状态',
      value: detail.kind === 'draft' ? `草稿 · ${detail.syncLabel}` : detail.syncLabel,
      tone: syncTone,
      source: 'opportunity',
    },
  ]
  if (missing.length > 0) {
    signals.push({
      id: 'missing_fields',
      label: '待补字段',
      value: String(missing.length),
      tone: 'pending',
      source: 'derived',
    })
  }
  if (detail.lastVisit) {
    const tone: InsightSignalTone =
      detail.lastVisit.sentiment === 'positive'
        ? 'positive'
        : detail.lastVisit.sentiment === 'risk'
          ? 'risk'
          : 'neutral'
    signals.push({
      id: 'last_visit',
      label: '最近互动',
      value:
        detail.lastVisit.sentiment === 'positive'
          ? '积极'
          : detail.lastVisit.sentiment === 'risk'
            ? '有风险'
            : '中性',
      tone,
      source: 'visit',
    })
  }

  return normalizeInsight({
    summary,
    signals,
    pendingChecks: pendingChecks.slice(0, 4),
    actions: actions.slice(0, 5),
    evidence: {
      opportunityIncluded: true,
      recentVisitCount: visitCount,
      missingFieldCount: missing.length,
      crmUpdatedAt: null,
    },
    updatedAt: new Date().toISOString(),
    mode: 'heuristic',
    agentName: '商机洞察 Agent',
    visitCount,
    missingFieldCount: missing.length,
  })
}
