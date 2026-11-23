/**
 * Activity AI Insight — button-triggered on activity detail.
 * Invoked via POST /api/activity-insight (not chat intent routing).
 *
 * CRM facts (signals / evidence) are assembled on the server.
 * The LLM may only fill summary, pendingChecks, actions, and optional feedbackTone.
 */
import type { DomainAgent } from './agentTypes.js'
import type { OpportunityRecord } from '../types.js'
import * as tools from '../tools/dataverseTools.js'
import { chatStructured, hasLlm } from '../llm/deepseek.js'
import {
  activityInsightLlmOutputSchema,
  insightActionSchema,
  insightPendingCheckSchema,
  insightSignalSchema,
} from '../llm/schemas.js'
import { ACTIVITY_INSIGHT_SYSTEM } from './prompts.js'
import { nowIsoInZone } from '../util/datetime.js'
import type { z } from 'zod'

const STAGE_LABEL: Record<string, string> = {
  Identify: '识别',
  Qualify: '资格确认',
  Propose: '方案报价',
  Negotiate: '谈判',
  Closed: '成交',
}

const TYPE_LABEL: Record<string, string> = {
  meeting: '会议',
  visit: '拜访',
  call: '电话',
  email: '邮件',
  other: '活动',
}

export type ActivityInsightRequest = {
  activity: {
    id: string
    title: string
    type: string
    status: string
    time?: string
    location?: string
    orgName: string
    orgIndustry?: string
    notes?: string
    contacts?: Array<{ name: string; role?: string }>
  }
  recentVisits?: Array<{
    title: string
    time?: string
    status?: string
    notes?: string
  }>
  /** Identifies a refresh request; must not alter factual judgment. */
  refreshNonce?: string
}

type InsightSignal = z.infer<typeof insightSignalSchema>
type InsightPendingCheck = z.infer<typeof insightPendingCheckSchema>
type InsightAction = z.infer<typeof insightActionSchema>

export type ActivityInsightResult = {
  summary: string
  signals: InsightSignal[]
  pendingChecks: InsightPendingCheck[]
  actions: InsightAction[]
  evidence: {
    activityIncluded: boolean
    opportunityCount: number
    recentVisitCount: number
    crmUpdatedAt: string | null
  }
  updatedAt: string
  mode: 'deepseek' | 'openai' | 'heuristic' | 'copilotstudio'
  agentName: string
  opportunityCount: number
  visitCount: number
  /** Internal diagnostics — do not render in UI. */
  confidence: number
}

function stageZh(stage: string) {
  return STAGE_LABEL[stage] || stage || '阶段待确认'
}

function typeZh(type: string) {
  return TYPE_LABEL[type] || '活动'
}

function stripResultPrefix(notes?: string) {
  if (!notes) return ''
  return notes.replace(/^结果\s*[:：]\s*/i, '').trim()
}

function statusLabel(status: string): { value: string; tone: InsightSignal['tone'] } {
  const raw = (status || '').trim()
  const lower = raw.toLowerCase()
  if (lower === 'draft' || raw === '草稿') return { value: '草稿', tone: 'pending' }
  if (lower === 'confirmed' || raw === '已确认') return { value: '已确认', tone: 'neutral' }
  if (lower === 'completed' || lower === 'synced' || raw === '已同步' || raw === '已完成') {
    return { value: '已同步', tone: 'neutral' }
  }
  return { value: raw || '待确认', tone: 'pending' }
}

function opportunitySignal(count: number): InsightSignal {
  if (count <= 0) {
    return {
      id: 'opportunity',
      label: '关联商机',
      value: '暂无',
      tone: 'pending',
      source: 'opportunity',
    }
  }
  return {
    id: 'opportunity',
    label: '关联商机',
    value: count === 1 ? '1 个' : '多个',
    tone: 'neutral',
    source: 'opportunity',
  }
}

function buildCrmSignals(params: {
  activityStatus: string
  opportunityCount: number
  recentVisitCount: number
  pendingCount: number
  feedbackTone?: 'positive' | 'neutral' | 'risk' | null
  hasActivityResult: boolean
}): InsightSignal[] {
  const status = statusLabel(params.activityStatus)
  const signals: InsightSignal[] = [
    {
      id: 'activity_status',
      label: '活动状态',
      value: status.value,
      tone: status.tone,
      source: 'activity',
    },
    opportunitySignal(params.opportunityCount),
  ]

  if (params.pendingCount > 0) {
    signals.push({
      id: 'pending_checks',
      label: '未决问题',
      value: String(params.pendingCount),
      tone: 'pending',
      source: 'derived',
    })
  }

  if (params.hasActivityResult && params.feedbackTone) {
    const feedbackValue =
      params.feedbackTone === 'positive' ? '积极' : params.feedbackTone === 'risk' ? '有风险' : '中性'
    const feedbackTone: InsightSignal['tone'] =
      params.feedbackTone === 'positive'
        ? 'positive'
        : params.feedbackTone === 'risk'
          ? 'risk'
          : 'neutral'
    signals.push({
      id: 'customer_feedback',
      label: '客户反馈',
      value: feedbackValue,
      tone: feedbackTone,
      source: 'ai',
    })
  }

  if (params.recentVisitCount > 0) {
    signals.push({
      id: 'recent_visits',
      label: '近期拜访',
      value: String(params.recentVisitCount),
      tone: 'neutral',
      source: 'visit',
    })
  }

  return signals.slice(0, 5)
}

type LooseAction = {
  id?: string
  title?: string
  description?: string
  priority?: InsightAction['priority']
  ownerName?: string | null
  contactName?: string | null
  dueAt?: string | null
  dueLabel?: string | null
  source?: string
  actionType?: InsightAction['actionType']
}

type LoosePending = {
  id?: string
  text?: string
  source?: InsightPendingCheck['source']
}

function normalizeActions(
  actions: LooseAction[],
  contactName?: string,
): InsightAction[] {
  return actions
    .map((a, index) => ({
      id: (a.id || `action_${index + 1}`).trim(),
      title: String(a.title || '').trim(),
      description: String(a.description || '').trim(),
      priority: a.priority || 'this_week',
      ownerName: a.ownerName ?? contactName ?? null,
      contactName: a.contactName ?? contactName ?? null,
      dueAt: a.dueAt ?? null,
      dueLabel: a.dueLabel ?? null,
      source: a.source || 'activity_notes',
      actionType: a.actionType || 'follow_up',
    }))
    .filter((a) => a.title)
    .slice(0, 5)
}

function normalizePending(checks: LoosePending[]): InsightPendingCheck[] {
  return checks
    .map((c, index) => ({
      id: (c.id || `pending_${index + 1}`).trim(),
      text: String(c.text || '').trim(),
      source: c.source || 'ai',
    }))
    .filter((c) => c.text)
    .slice(0, 6)
}

function mergePendingChecks(
  crmChecks: InsightPendingCheck[],
  aiChecks: InsightPendingCheck[],
): InsightPendingCheck[] {
  const seen = new Set<string>()
  const out: InsightPendingCheck[] = []
  for (const item of [...crmChecks, ...aiChecks]) {
    const key = item.text.replace(/\s+/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out.slice(0, 6)
}

function heuristicInsight(
  req: ActivityInsightRequest,
  opportunities: OpportunityRecord[],
  recentVisits: NonNullable<ActivityInsightRequest['recentVisits']>,
): {
  summary: string
  pendingChecks: InsightPendingCheck[]
  actions: InsightAction[]
  feedbackTone: 'positive' | 'neutral' | 'risk' | null
  confidence: number
} {
  const org = req.activity.orgName
  const result = stripResultPrefix(req.activity.notes)
  const contact = req.activity.contacts?.[0]?.name
  const typeLabel = typeZh(req.activity.type)
  const status = statusLabel(req.activity.status)

  const oppLine =
    opportunities.length === 0
      ? '暂未匹配到开放商机'
      : opportunities.length === 1
        ? `关联商机「${opportunities[0].name || opportunities[0].productLine}」处于${stageZh(opportunities[0].stage)}阶段`
        : `已匹配到 ${opportunities.length} 个开放商机，当前以「${opportunities[0].name || opportunities[0].productLine}」（${stageZh(opportunities[0].stage)}）为主`

  const resultClause = result
    ? `本次${typeLabel}已进行，活动结果为：${result.slice(0, 80)}${result.length > 80 ? '…' : ''}`
    : `本次${typeLabel}记录已创建，活动结果细节仍待补充`

  const gapClause =
    opportunities.length === 0
      ? '是否已形成明确采购需求、以及是否需要新建商机仍待确认。'
      : '采购节奏与下一步会议安排仍待确认。'

  const summary = `${resultClause}。当前活动状态为${status.value}，${oppLine}。${gapClause}`

  const pendingChecks: InsightPendingCheck[] = []
  if (!result) {
    pendingChecks.push({
      id: 'activity_result',
      text: '本次活动实际结果尚未完整记录',
      source: 'missing_crm_field',
    })
  }
  if (opportunities.length === 0) {
    pendingChecks.push({
      id: 'purchase_intent',
      text: '是否已经形成明确采购需求',
      source: 'missing_crm_field',
    })
    pendingChecks.push({
      id: 'create_opportunity',
      text: '是否需要创建新商机',
      source: 'opportunity',
    })
  } else {
    pendingChecks.push({
      id: 'next_meeting',
      text: '后续会议时间尚未确定',
      source: 'missing_crm_field',
    })
  }

  const actions: InsightAction[] = []
  if (result) {
    actions.push({
      id: 'follow_up_questions',
      title: contact ? `回复${contact}提出的待决问题` : '整理并回复本次未决问题',
      description: '关闭演示/沟通中尚未答复的技术或业务问题',
      priority: 'immediate',
      ownerName: contact ?? null,
      contactName: contact ?? null,
      dueAt: null,
      dueLabel: '建议 2 日内',
      source: 'activity_notes',
      actionType: 'follow_up',
    })
  }
  actions.push({
    id: 'log_activity_outcome',
    title: '在 CRM 中核验并留痕本次活动结果',
    description: '确认状态、备注与联系人记录完整，便于团队复盘',
    priority: 'immediate',
    ownerName: contact ?? null,
    contactName: contact ?? null,
    dueAt: null,
    dueLabel: '建议当日',
    source: 'activity',
    actionType: 'log_activity',
  })
  if (opportunities.length === 0) {
    actions.push({
      id: 'decide_opportunity',
      title: `确认「${org}」是否需新建商机`,
      description: '对照本次沟通结果，判断是否进入管线或仅作培育',
      priority: 'this_week',
      ownerName: contact ?? null,
      contactName: contact ?? null,
      dueAt: null,
      dueLabel: '本周内',
      source: 'opportunity',
      actionType: 'opportunity',
    })
  } else {
    const opp = opportunities[0]
    actions.push({
      id: 'advance_opportunity',
      title: `推进商机「${opp.name || opp.productLine}」`,
      description: `对照当前阶段（${stageZh(opp.stage)}）补齐下一阶段所需材料`,
      priority: 'this_week',
      ownerName: contact ?? null,
      contactName: contact ?? null,
      dueAt: null,
      dueLabel: '本周内',
      source: 'opportunity',
      actionType: 'opportunity',
    })
  }
  if (recentVisits.length > 0) {
    actions.push({
      id: 'schedule_next_touch',
      title: '结合近期拜访设定下次触达',
      description: '避免跟进断档，并在日历/活动中留痕',
      priority: 'later',
      ownerName: contact ?? null,
      contactName: contact ?? null,
      dueAt: null,
      dueLabel: '后续',
      source: 'visit',
      actionType: 'meeting',
    })
  } else {
    actions.push({
      id: 'prepare_materials',
      title: '准备平台兼容性或临床场景补充材料',
      description: '针对本次沟通中可预见的技术问题提前备答',
      priority: 'this_week',
      ownerName: contact ?? null,
      contactName: contact ?? null,
      dueAt: null,
      dueLabel: '本周内',
      source: 'activity_notes',
      actionType: 'material',
    })
  }

  return {
    summary,
    pendingChecks: pendingChecks.slice(0, 4),
    actions: normalizeActions(actions.slice(0, 5), contact),
    feedbackTone: null,
    confidence: opportunities.length || recentVisits.length ? 0.78 : 0.62,
  }
}

function assembleResult(params: {
  summary: string
  pendingChecks: InsightPendingCheck[]
  actions: InsightAction[]
  feedbackTone: 'positive' | 'neutral' | 'risk' | null
  confidence: number
  mode: ActivityInsightResult['mode']
  activityStatus: string
  activityResult: string
  opportunityCount: number
  recentVisitCount: number
  contactName?: string
}): ActivityInsightResult {
  const pendingChecks = normalizePending(params.pendingChecks)
  const actions = normalizeActions(params.actions, params.contactName)
  const signals = buildCrmSignals({
    activityStatus: params.activityStatus,
    opportunityCount: params.opportunityCount,
    recentVisitCount: params.recentVisitCount,
    pendingCount: pendingChecks.length,
    feedbackTone: params.feedbackTone,
    hasActivityResult: Boolean(params.activityResult),
  })

  return {
    summary: params.summary.trim(),
    signals,
    pendingChecks,
    actions,
    evidence: {
      activityIncluded: true,
      opportunityCount: params.opportunityCount,
      recentVisitCount: params.recentVisitCount,
      crmUpdatedAt: null,
    },
    updatedAt: new Date().toISOString(),
    mode: params.mode,
    agentName: '活动洞察 Agent',
    opportunityCount: params.opportunityCount,
    visitCount: params.recentVisitCount,
    confidence: Math.max(0, Math.min(1, params.confidence)),
  }
}

export async function generateActivityInsight(
  req: ActivityInsightRequest,
): Promise<ActivityInsightResult> {
  const orgName = String(req.activity?.orgName || '').trim()
  if (!orgName) {
    throw new Error('activity.orgName required')
  }

  const accounts = await tools.searchAccounts(orgName)
  const account = accounts.find((a) => a.name === orgName) || accounts[0]

  let opportunities: OpportunityRecord[] = []
  if (account) {
    opportunities = await tools.getOpportunitiesForAccount(account.id)
  }

  const drafts = (await tools.listActivityDrafts())
    .filter((d) => d.syncStatus !== 'Discarded')
    .filter(
      (d) =>
        d.accountName === orgName ||
        (account && (d.accountId === account.id || d.accountRef === account.externalKey)),
    )
    .slice(0, 6)

  const recentVisits =
    req.recentVisits?.length
      ? req.recentVisits.slice(0, 6)
      : drafts.map((d) => ({
          title: d.subject,
          time: d.occurredAt || d.updatedAt,
          status: d.syncStatus,
          notes: d.summary,
        }))

  const activityResult = stripResultPrefix(req.activity.notes)
  const contactName = req.activity.contacts?.[0]?.name
  const crmPending: InsightPendingCheck[] = []
  if (opportunities.length === 0) {
    crmPending.push({
      id: 'purchase_intent',
      text: '是否已经形成明确采购需求',
      source: 'missing_crm_field',
    })
    crmPending.push({
      id: 'create_opportunity',
      text: '是否需要创建新商机',
      source: 'opportunity',
    })
  }
  if (!activityResult) {
    crmPending.push({
      id: 'activity_result',
      text: '本次活动实际结果尚未完整记录',
      source: 'missing_crm_field',
    })
  }

  const fallback = heuristicInsight(req, opportunities, recentVisits)
  let summary = fallback.summary
  let pendingChecks = mergePendingChecks(crmPending, fallback.pendingChecks)
  let actions = fallback.actions
  let feedbackTone = fallback.feedbackTone
  let mode: ActivityInsightResult['mode'] = 'heuristic'
  let confidence = fallback.confidence

  const crmFacts = {
    activityStatus: statusLabel(req.activity.status).value,
    opportunityCount: opportunities.length,
    recentVisitCount: recentVisits.length,
    hasActivityResult: Boolean(activityResult),
    primaryContact: contactName || null,
  }

  if (hasLlm()) {
    try {
      const { data, mode: m } = await chatStructured({
        system: ACTIVITY_INSIGHT_SYSTEM,
        user: JSON.stringify({
          now: nowIsoInZone(),
          timezone: 'Asia/Shanghai',
          locale: 'zh-CN',
          refreshNonce: req.refreshNonce || null,
          crmFacts,
          activity: {
            id: req.activity.id,
            title: req.activity.title,
            type: req.activity.type,
            typeLabel: typeZh(req.activity.type),
            status: req.activity.status,
            statusLabel: crmFacts.activityStatus,
            time: req.activity.time,
            location: req.activity.location,
            orgName,
            orgIndustry: req.activity.orgIndustry,
            result: activityResult,
            contacts: req.activity.contacts || [],
          },
          opportunities: opportunities.map((o) => ({
            name: o.name,
            productLine: o.productLine,
            stage: stageZh(o.stage),
            amount: o.amount,
            currency: o.currencyCode,
            hints: o.supervisorHints || [],
          })),
          recentVisits: recentVisits.map((v) => ({
            title: v.title,
            time: v.time,
            status: v.status,
            result: stripResultPrefix(v.notes),
          })),
          instruction:
            '严格按 JSON Schema 输出；不得因 refreshNonce 改变事实判断；信息不足写入 pendingChecks。',
        }),
        temperature: 0.2,
        maxTokens: 900,
        schema: activityInsightLlmOutputSchema,
      })
      if (data.summary.trim() && data.actions?.length) {
        summary = data.summary.trim()
        pendingChecks = mergePendingChecks(crmPending, normalizePending(data.pendingChecks || []))
        actions = normalizeActions(data.actions, contactName)
        feedbackTone = data.feedbackTone ?? null
        mode = m
        confidence = Math.max(0, Math.min(1, data.confidence ?? 0.8))
      }
    } catch {
      /* keep heuristic */
    }
  }

  return assembleResult({
    summary,
    pendingChecks,
    actions,
    feedbackTone,
    confidence,
    mode,
    activityStatus: req.activity.status,
    activityResult,
    opportunityCount: opportunities.length,
    recentVisitCount: recentVisits.length,
    contactName,
  })
}

/** Registered for catalog visibility; primary entry is generateActivityInsight via API. */
export const activityInsightAgent: DomainAgent = {
  name: 'ActivityInsight',
  displayName: '活动洞察 Agent',
  description: '根据活动结果、关联商机与近期拜访生成中文 AI 洞察与行动建议',
  intents: [],
  async run() {
    return {
      mode: 'heuristic',
      messages: [
        {
          id: `msg_${Math.random().toString(36).slice(2, 10)}`,
          role: 'assistant',
          agent_id: 'ActivityInsight',
          agent_name: '活动洞察 Agent',
          content: '请在活动详情页点击「AI 洞察」生成建议。',
          sources: [],
          confidence: 0.5,
          confidence_kind: 'answer',
          agent_chain: ['Orchestrator', '活动洞察 Agent'],
          createdAt: new Date().toISOString(),
        },
      ],
    }
  },
}
