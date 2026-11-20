import { api, ApiRequestError } from '../api/client'
import type { AgendaItem } from './agenda'

export type InsightSignalTone = 'neutral' | 'positive' | 'pending' | 'risk' | 'ai'
export type InsightActionPriority = 'immediate' | 'this_week' | 'later'
export type InsightActionType =
  | 'follow_up'
  | 'log_activity'
  | 'opportunity'
  | 'meeting'
  | 'material'
  | 'other'

export type InsightSignal = {
  id: string
  label: string
  value: string
  tone: InsightSignalTone
  source: 'activity' | 'opportunity' | 'visit' | 'ai' | 'derived'
}

export type InsightPendingCheck = {
  id: string
  text: string
  source: 'missing_crm_field' | 'activity_notes' | 'ai' | 'opportunity' | 'visit'
}

export type InsightAction = {
  id: string
  title: string
  description: string
  priority: InsightActionPriority
  ownerName: string | null
  contactName: string | null
  dueAt: string | null
  dueLabel: string | null
  source: string
  actionType: InsightActionType
}

export type InsightEvidence = {
  activityIncluded: boolean
  opportunityCount: number
  recentVisitCount: number
  crmUpdatedAt: string | null
}

export type ActivityInsightView = {
  summary: string
  signals: InsightSignal[]
  pendingChecks: InsightPendingCheck[]
  actions: InsightAction[]
  evidence: InsightEvidence
  updatedAt: string
  mode: 'deepseek' | 'heuristic' | 'copilotstudio'
  agentName: string
  opportunityCount: number
  visitCount: number
}

export const PRIORITY_LABEL: Record<InsightActionPriority, string> = {
  immediate: '立即',
  this_week: '本周',
  later: '后续',
}

export function formatInsightUpdatedAt(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `更新于 ${month}月${day}日 ${hh}:${mm}`
}

export function formatCrmAsOf(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `CRM 数据截至 ${month}月${day}日 ${hh}:${mm}`
}

/** Same-org agenda rows used as「最近的拜访」context for the agent. */
export function relatedVisitsForActivity(item: AgendaItem, allEvents: AgendaItem[]) {
  return allEvents
    .filter((ev) => ev.orgName === item.orgName && ev.id !== item.id)
    .slice(0, 5)
    .map((ev) => ({
      title: ev.title,
      time: ev.time,
      status: ev.status,
      notes: ev.notes,
    }))
}

function statusLabel(status: string): { value: string; tone: InsightSignalTone } {
  const raw = (status || '').trim()
  const lower = raw.toLowerCase()
  if (lower === 'draft' || raw === '草稿') return { value: '草稿', tone: 'pending' }
  if (lower === 'confirmed' || raw === '已确认') return { value: '已确认', tone: 'neutral' }
  if (lower === 'completed' || lower === 'synced' || raw === '已同步' || raw === '已完成') {
    return { value: '已同步', tone: 'neutral' }
  }
  return { value: raw || '待确认', tone: 'pending' }
}

function typeZh(type: string) {
  if (type === 'meeting') return '会议'
  if (type === 'call') return '电话'
  if (type === 'visit') return '拜访'
  if (type === 'email') return '邮件'
  return '活动'
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
  evidence?: Partial<InsightEvidence> | null
  updatedAt?: string
  mode?: ActivityInsightView['mode']
  agentName?: string
  opportunityCount?: number
  visitCount?: number
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
      source: action.source || 'activity_notes',
      actionType: action.actionType || 'follow_up',
    }))
    .filter((action) => action.title)
}

function normalizeInsight(raw: InsightPayloadInput): ActivityInsightView {
  const evidence = raw.evidence || {
    activityIncluded: true,
    opportunityCount: raw.opportunityCount ?? 0,
    recentVisitCount: raw.visitCount ?? 0,
    crmUpdatedAt: null,
  }
  return {
    summary: String(raw.summary || '').trim() || '洞察结果待确认。',
    signals: Array.isArray(raw.signals) ? raw.signals : [],
    pendingChecks: Array.isArray(raw.pendingChecks) ? raw.pendingChecks : [],
    actions: normalizeActions(raw.actions),
    evidence: {
      activityIncluded: evidence.activityIncluded !== false,
      opportunityCount: evidence.opportunityCount ?? 0,
      recentVisitCount: evidence.recentVisitCount ?? 0,
      crmUpdatedAt: evidence.crmUpdatedAt ?? null,
    },
    updatedAt: raw.updatedAt || new Date().toISOString(),
    mode: raw.mode === 'deepseek' || raw.mode === 'copilotstudio' ? raw.mode : 'heuristic',
    agentName: raw.agentName || '活动洞察 Agent',
    opportunityCount: evidence.opportunityCount ?? raw.opportunityCount ?? 0,
    visitCount: evidence.recentVisitCount ?? raw.visitCount ?? 0,
  }
}

export async function fetchActivityInsight(
  item: AgendaItem,
  opts?: { recentVisits?: ReturnType<typeof relatedVisitsForActivity>; refreshNonce?: string },
): Promise<ActivityInsightView> {
  try {
    const result = await api.activityInsight({
      activity: {
        id: item.id,
        title: item.title,
        type: item.type,
        status: item.status,
        time: item.time,
        location: item.location,
        orgName: item.orgName,
        orgIndustry: item.orgIndustry,
        notes: item.notes,
        contacts: item.contacts.map((c) => ({ name: c.name, role: c.role })),
      },
      recentVisits: opts?.recentVisits,
      refreshNonce: opts?.refreshNonce,
    })
    return normalizeInsight(result)
  } catch (err) {
    // Offline, or production API not yet redeployed with POST /activity-insight (nginx 404).
    if (
      err instanceof ApiRequestError &&
      (err.kind === 'network' || err.status === 404 || err.status === 502 || err.status === 503)
    ) {
      return localHeuristicInsight(item, opts?.recentVisits)
    }
    throw err
  }
}

function localHeuristicInsight(
  item: AgendaItem,
  recentVisits?: ReturnType<typeof relatedVisitsForActivity>,
): ActivityInsightView {
  const result = (item.notes || '').replace(/^结果\s*[:：]\s*/i, '').trim()
  const contact = item.contacts[0]?.name ?? null
  const visitCount = recentVisits?.length ?? 0
  const status = statusLabel(item.status)
  const typeLabel = typeZh(item.type)

  const pendingChecks: InsightPendingCheck[] = [
    {
      id: 'purchase_intent',
      text: '是否已经形成明确采购需求',
      source: 'missing_crm_field',
    },
    {
      id: 'create_opportunity',
      text: '是否需要创建新商机',
      source: 'opportunity',
    },
  ]
  if (!result) {
    pendingChecks.unshift({
      id: 'activity_result',
      text: '本次活动实际结果尚未完整记录',
      source: 'missing_crm_field',
    })
  }

  const summary = result
    ? `本次${typeLabel}已进行，活动结果为：${result.slice(0, 80)}${result.length > 80 ? '…' : ''}。当前活动状态为${status.value}，暂未匹配到开放商机。是否已形成明确采购需求仍待确认。`
    : `本次${typeLabel}记录已创建，活动结果细节仍待补充。当前活动状态为${status.value}，暂未匹配到开放商机。是否已形成明确采购需求仍待确认。`

  const actions: InsightAction[] = [
    {
      id: 'follow_up_questions',
      title: contact ? `回复${contact}提出的待决问题` : '整理并回复本次未决问题',
      description: '关闭演示/沟通中尚未答复的技术或业务问题',
      priority: 'immediate',
      ownerName: contact,
      contactName: contact,
      dueAt: null,
      dueLabel: '建议 2 日内',
      source: 'activity_notes',
      actionType: 'follow_up',
    },
    {
      id: 'log_activity_outcome',
      title: '在 CRM 中核验并留痕本次活动结果',
      description: '确认状态、备注与联系人记录完整，便于团队复盘',
      priority: 'immediate',
      ownerName: contact,
      contactName: contact,
      dueAt: null,
      dueLabel: '建议当日',
      source: 'activity',
      actionType: 'log_activity',
    },
    {
      id: 'decide_opportunity',
      title: `确认「${item.orgName}」是否需新建商机`,
      description: '对照本次沟通结果，判断是否进入管线或仅作培育',
      priority: 'this_week',
      ownerName: contact,
      contactName: contact,
      dueAt: null,
      dueLabel: '本周内',
      source: 'opportunity',
      actionType: 'opportunity',
    },
  ]

  const signals: InsightSignal[] = [
    {
      id: 'activity_status',
      label: '活动状态',
      value: status.value,
      tone: status.tone,
      source: 'activity',
    },
    {
      id: 'opportunity',
      label: '关联商机',
      value: '暂无',
      tone: 'pending',
      source: 'opportunity',
    },
    {
      id: 'pending_checks',
      label: '未决问题',
      value: String(pendingChecks.length),
      tone: 'pending',
      source: 'derived',
    },
  ]
  if (visitCount > 0) {
    signals.push({
      id: 'recent_visits',
      label: '近期拜访',
      value: String(visitCount),
      tone: 'neutral',
      source: 'visit',
    })
  }

  return normalizeInsight({
    summary,
    signals,
    pendingChecks,
    actions,
    evidence: {
      activityIncluded: true,
      opportunityCount: 0,
      recentVisitCount: visitCount,
      crmUpdatedAt: null,
    },
    updatedAt: new Date().toISOString(),
    mode: 'heuristic',
    agentName: '活动洞察 Agent',
    opportunityCount: 0,
    visitCount,
  })
}
