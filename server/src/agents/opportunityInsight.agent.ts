/**
 * Opportunity AI Insight — button-triggered on opportunity detail.
 * Invoked via POST /api/opportunity-insight (not chat intent routing).
 *
 * CRM facts (signals / evidence) are assembled on the server.
 * The LLM may only fill summary, pendingChecks, actions, and optional feedbackTone.
 */
import type { DomainAgent } from './agentTypes.js'
import * as tools from '../tools/dataverseTools.js'
import { chatStructured, hasLlm } from '../llm/deepseek.js'
import {
  opportunityInsightLlmOutputSchema,
  insightActionSchema,
  insightPendingCheckSchema,
  insightSignalSchema,
} from '../llm/schemas.js'
import { OPPORTUNITY_INSIGHT_SYSTEM } from './prompts.js'
import { nowIsoInZone } from '../util/datetime.js'
import type { z } from 'zod'

const STAGE_LABEL: Record<string, string> = {
  Identify: '识别',
  Qualify: '资格确认',
  Propose: '方案报价',
  Negotiate: '谈判',
  Closed: '成交',
}

export type OpportunityInsightRequest = {
  opportunity: {
    id: string
    name: string
    accountName: string
    accountRef?: string
    stage: string
    amount?: number
    currency?: string
    closeDate?: string
    productLine?: string
    quantity?: number
    ownerName?: string
    contactName?: string
    syncLabel?: string
    kind?: 'pipeline' | 'draft'
    budgetStatus?: string
    competition?: string
    missingForNextStage?: string[]
    supervisorHints?: string[]
    lastVisit?: {
      date: string
      sentiment?: 'positive' | 'neutral' | 'risk'
      summary?: string
    } | null
    winForecast?: { probability: number; source: 'crm' | 'ai' } | null
    contacts?: Array<{ name: string; role?: string; title?: string }>
  }
  recentVisits?: Array<{
    title: string
    time?: string
    status?: string
    notes?: string
  }>
  refreshNonce?: string
}

type InsightSignal = z.infer<typeof insightSignalSchema>
type InsightPendingCheck = z.infer<typeof insightPendingCheckSchema>
type InsightAction = z.infer<typeof insightActionSchema>

export type OpportunityInsightResult = {
  summary: string
  signals: InsightSignal[]
  pendingChecks: InsightPendingCheck[]
  actions: InsightAction[]
  evidence: {
    opportunityIncluded: boolean
    recentVisitCount: number
    missingFieldCount: number
    crmUpdatedAt: string | null
  }
  updatedAt: string
  mode: 'deepseek' | 'openai' | 'heuristic' | 'copilotstudio'
  agentName: string
  visitCount: number
  missingFieldCount: number
  /** Internal diagnostics — do not render in UI. */
  confidence: number
}

function stageZh(stage: string) {
  return STAGE_LABEL[stage] || stage || '阶段待确认'
}

function sentimentZh(sentiment?: string | null): { value: string; tone: InsightSignal['tone'] } | null {
  if (sentiment === 'positive') return { value: '积极', tone: 'positive' }
  if (sentiment === 'risk') return { value: '有风险', tone: 'risk' }
  if (sentiment === 'neutral') return { value: '中性', tone: 'neutral' }
  return null
}

function syncSignal(kind: string | undefined, syncLabel: string | undefined): InsightSignal {
  const label = (syncLabel || '').trim()
  if (kind === 'draft' || label === '待确认') {
    return { id: 'sync_status', label: '同步状态', value: '待确认', tone: 'pending', source: 'opportunity' }
  }
  if (label === '同步失败') {
    return { id: 'sync_status', label: '同步状态', value: '同步失败', tone: 'risk', source: 'opportunity' }
  }
  if (label === '同步中') {
    return { id: 'sync_status', label: '同步状态', value: '同步中', tone: 'pending', source: 'opportunity' }
  }
  return {
    id: 'sync_status',
    label: '同步状态',
    value: label || (kind === 'pipeline' ? '进行中' : '待确认'),
    tone: 'neutral',
    source: 'opportunity',
  }
}

function buildCrmSignals(params: {
  stage: string
  kind?: string
  syncLabel?: string
  missingCount: number
  recentVisitCount: number
  feedbackTone?: 'positive' | 'neutral' | 'risk' | null
  lastVisitSentiment?: string | null
  hasWinForecast: boolean
}): InsightSignal[] {
  const signals: InsightSignal[] = [
    {
      id: 'stage',
      label: '当前阶段',
      value: stageZh(params.stage),
      tone: params.stage === 'Closed' ? 'positive' : 'neutral',
      source: 'opportunity',
    },
    syncSignal(params.kind, params.syncLabel),
  ]

  if (params.missingCount > 0) {
    signals.push({
      id: 'missing_fields',
      label: '待补字段',
      value: String(params.missingCount),
      tone: 'pending',
      source: 'derived',
    })
  }

  const visitTone = sentimentZh(params.lastVisitSentiment)
  if (params.feedbackTone) {
    const value =
      params.feedbackTone === 'positive' ? '积极' : params.feedbackTone === 'risk' ? '有风险' : '中性'
    const tone: InsightSignal['tone'] =
      params.feedbackTone === 'positive'
        ? 'positive'
        : params.feedbackTone === 'risk'
          ? 'risk'
          : 'neutral'
    signals.push({
      id: 'customer_feedback',
      label: '客户反馈',
      value,
      tone,
      source: 'ai',
    })
  } else if (visitTone) {
    signals.push({
      id: 'last_visit',
      label: '最近互动',
      value: visitTone.value,
      tone: visitTone.tone,
      source: 'visit',
    })
  } else if (params.recentVisitCount > 0) {
    signals.push({
      id: 'recent_visits',
      label: '近期拜访',
      value: String(params.recentVisitCount),
      tone: 'neutral',
      source: 'visit',
    })
  }

  if (params.hasWinForecast) {
    signals.push({
      id: 'win_forecast',
      label: 'CRM 预测',
      value: '已有',
      tone: 'ai',
      source: 'opportunity',
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

function normalizeActions(actions: LooseAction[], contactName?: string): InsightAction[] {
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
      source: a.source || 'opportunity',
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

function heuristicInsight(req: OpportunityInsightRequest, recentVisits: NonNullable<OpportunityInsightRequest['recentVisits']>): {
  summary: string
  pendingChecks: InsightPendingCheck[]
  actions: InsightAction[]
  feedbackTone: 'positive' | 'neutral' | 'risk' | null
  confidence: number
} {
  const opp = req.opportunity
  const contact = opp.contacts?.[0]?.name || opp.contactName || undefined
  const missing = (opp.missingForNextStage || []).filter(Boolean)
  const stage = stageZh(opp.stage)
  const visit = opp.lastVisit

  const gapClause =
    missing.length > 0
      ? `进入下一阶段仍缺：${missing.slice(0, 3).join('、')}${missing.length > 3 ? '等' : ''}。`
      : opp.stage === 'Closed'
        ? '商机已关闭，以复盘与归档为主。'
        : '推进下一阶段所需关键信息已较齐备，仍需人工确认写入。'

  const visitClause = visit?.summary
    ? `最近互动（${visit.date}）：${visit.summary.slice(0, 60)}${visit.summary.length > 60 ? '…' : ''}`
    : recentVisits.length > 0
      ? `同客户近期有 ${recentVisits.length} 条拜访记录可参考`
      : '暂无可靠客户互动记录'

  const summary = `「${opp.name}」当前处于${stage}阶段。${gapClause}${visitClause}。关键预算、竞争与决策节奏仍待核实。`

  const pendingChecks: InsightPendingCheck[] = missing.slice(0, 3).map((field, i) => ({
    id: `missing_${i + 1}`,
    text: `待补充：${field}`,
    source: 'missing_crm_field' as const,
  }))
  if (!visit?.summary && recentVisits.length === 0) {
    pendingChecks.push({
      id: 'next_touch',
      text: '下次客户触达时间尚未确定',
      source: 'missing_crm_field',
    })
  }
  if ((opp.budgetStatus || '').includes('待补充') || !opp.budgetStatus) {
    pendingChecks.push({
      id: 'budget',
      text: '预算到位情况尚待确认',
      source: 'missing_crm_field',
    })
  }
  if ((opp.competition || '').includes('待补充') || !opp.competition) {
    pendingChecks.push({
      id: 'competition',
      text: '竞争格局与主要对手尚未核实',
      source: 'ai',
    })
  }

  const actions: InsightAction[] = []
  if (missing.length > 0) {
    actions.push({
      id: 'fill_missing',
      title: `补齐「${missing[0]}」等推进字段`,
      description: `对照进入下一阶段缺口：${missing.slice(0, 3).join('、')}`,
      priority: 'immediate',
      ownerName: opp.ownerName || contact || null,
      contactName: contact || null,
      dueAt: null,
      dueLabel: '建议当日',
      source: 'missing_crm_field',
      actionType: 'opportunity',
    })
  } else if (opp.stage !== 'Closed') {
    actions.push({
      id: 'confirm_advance',
      title: `确认是否推进「${opp.name}」至下一阶段`,
      description: '关键信息已较齐备，推进前仍需人工确认',
      priority: 'this_week',
      ownerName: opp.ownerName || contact || null,
      contactName: contact || null,
      dueAt: null,
      dueLabel: '本周内',
      source: 'opportunity',
      actionType: 'opportunity',
    })
  }

  actions.push({
    id: 'follow_contact',
    title: contact ? `跟进联系人${contact}` : '确认主联系人并安排跟进',
    description: visit?.summary
      ? '围绕最近互动中的未决问题闭环'
      : '补充决策链与联系方式，避免跟进断档',
    priority: 'immediate',
    ownerName: opp.ownerName || contact || null,
    contactName: contact || null,
    dueAt: null,
    dueLabel: '建议 2 日内',
    source: visit?.summary ? 'visit' : 'opportunity',
    actionType: 'follow_up',
  })

  if (recentVisits.length > 0 || visit) {
    actions.push({
      id: 'schedule_next_touch',
      title: '设定下次拜访或演示',
      description: '结合近期互动节奏，在日历中留痕',
      priority: 'this_week',
      ownerName: opp.ownerName || contact || null,
      contactName: contact || null,
      dueAt: null,
      dueLabel: '本周内',
      source: 'visit',
      actionType: 'meeting',
    })
  } else {
    actions.push({
      id: 'log_first_visit',
      title: `为「${opp.accountName}」安排首次/补访`,
      description: '缺少近期互动，需先建立可核实的接触记录',
      priority: 'this_week',
      ownerName: opp.ownerName || contact || null,
      contactName: contact || null,
      dueAt: null,
      dueLabel: '本周内',
      source: 'visit',
      actionType: 'log_activity',
    })
  }

  if (opp.kind === 'draft') {
    actions.push({
      id: 'review_draft',
      title: '核验草稿字段后确认同步',
      description: 'AI/手动草稿不会自动改写正式商机，需人工确认',
      priority: 'immediate',
      ownerName: opp.ownerName || contact || null,
      contactName: contact || null,
      dueAt: null,
      dueLabel: '建议当日',
      source: 'crm',
      actionType: 'opportunity',
    })
  } else {
    actions.push({
      id: 'prepare_materials',
      title: '准备下一阶段方案或报价材料',
      description: '针对产品线与客户场景提前备答',
      priority: 'later',
      ownerName: opp.ownerName || contact || null,
      contactName: contact || null,
      dueAt: null,
      dueLabel: '后续',
      source: 'opportunity',
      actionType: 'material',
    })
  }

  const feedbackTone =
    visit?.sentiment === 'positive' || visit?.sentiment === 'risk' || visit?.sentiment === 'neutral'
      ? visit.sentiment
      : null

  return {
    summary,
    pendingChecks: pendingChecks.slice(0, 4),
    actions: normalizeActions(actions.slice(0, 5), contact),
    feedbackTone,
    confidence: missing.length || recentVisits.length || visit ? 0.76 : 0.6,
  }
}

function assembleResult(params: {
  summary: string
  pendingChecks: InsightPendingCheck[]
  actions: InsightAction[]
  feedbackTone: 'positive' | 'neutral' | 'risk' | null
  confidence: number
  mode: OpportunityInsightResult['mode']
  stage: string
  kind?: string
  syncLabel?: string
  missingCount: number
  recentVisitCount: number
  lastVisitSentiment?: string | null
  hasWinForecast: boolean
  contactName?: string
}): OpportunityInsightResult {
  const pendingChecks = normalizePending(params.pendingChecks)
  const actions = normalizeActions(params.actions, params.contactName)
  const signals = buildCrmSignals({
    stage: params.stage,
    kind: params.kind,
    syncLabel: params.syncLabel,
    missingCount: params.missingCount,
    recentVisitCount: params.recentVisitCount,
    feedbackTone: params.feedbackTone,
    lastVisitSentiment: params.lastVisitSentiment,
    hasWinForecast: params.hasWinForecast,
  })

  return {
    summary: params.summary.trim(),
    signals,
    pendingChecks,
    actions,
    evidence: {
      opportunityIncluded: true,
      recentVisitCount: params.recentVisitCount,
      missingFieldCount: params.missingCount,
      crmUpdatedAt: null,
    },
    updatedAt: new Date().toISOString(),
    mode: params.mode,
    agentName: '商机洞察 Agent',
    visitCount: params.recentVisitCount,
    missingFieldCount: params.missingCount,
    confidence: Math.max(0, Math.min(1, params.confidence)),
  }
}

export async function generateOpportunityInsight(
  req: OpportunityInsightRequest,
): Promise<OpportunityInsightResult> {
  const opp = req.opportunity
  const accountName = String(opp?.accountName || '').trim()
  if (!accountName) {
    throw new Error('opportunity.accountName required')
  }
  if (!String(opp?.name || '').trim() && !String(opp?.id || '').trim()) {
    throw new Error('opportunity.name or opportunity.id required')
  }

  const accounts = await tools.searchAccounts(accountName)
  const account =
    accounts.find((a) => a.name === accountName) ||
    (opp.accountRef
      ? accounts.find((a) => a.externalKey === opp.accountRef) || accounts[0]
      : accounts[0])

  const drafts = (await tools.listActivityDrafts())
    .filter((d) => d.syncStatus !== 'Discarded')
    .filter(
      (d) =>
        d.accountName === accountName ||
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

  const missing = (opp.missingForNextStage || []).map((s) => String(s || '').trim()).filter(Boolean)
  const contactName = opp.contacts?.[0]?.name || opp.contactName || undefined
  const crmPending: InsightPendingCheck[] = missing.slice(0, 4).map((field, i) => ({
    id: `missing_${i + 1}`,
    text: `待补充：${field}`,
    source: 'missing_crm_field' as const,
  }))

  const fallback = heuristicInsight(req, recentVisits)
  let summary = fallback.summary
  let pendingChecks = mergePendingChecks(crmPending, fallback.pendingChecks)
  let actions = fallback.actions
  let feedbackTone = fallback.feedbackTone
  let mode: OpportunityInsightResult['mode'] = 'heuristic'
  let confidence = fallback.confidence

  const hasWinForecast = Boolean(opp.winForecast && opp.winForecast.source === 'crm')
  const crmFacts = {
    stage: stageZh(opp.stage),
    syncLabel: opp.syncLabel || null,
    kind: opp.kind || null,
    missingFieldCount: missing.length,
    recentVisitCount: recentVisits.length,
    hasLastVisit: Boolean(opp.lastVisit?.summary),
    hasCrmWinForecast: hasWinForecast,
    primaryContact: contactName || null,
  }

  if (hasLlm()) {
    try {
      const { data, mode: m } = await chatStructured({
        system: OPPORTUNITY_INSIGHT_SYSTEM,
        user: JSON.stringify({
          now: nowIsoInZone(),
          timezone: 'Asia/Shanghai',
          locale: 'zh-CN',
          refreshNonce: req.refreshNonce || null,
          crmFacts,
          opportunity: {
            id: opp.id,
            name: opp.name,
            accountName,
            stage: opp.stage,
            stageLabel: crmFacts.stage,
            amount: opp.amount,
            currency: opp.currency,
            closeDate: opp.closeDate,
            productLine: opp.productLine,
            quantity: opp.quantity,
            ownerName: opp.ownerName,
            syncLabel: opp.syncLabel,
            kind: opp.kind,
            budgetStatus: opp.budgetStatus,
            competition: opp.competition,
            lastVisit: opp.lastVisit || null,
            contacts: opp.contacts || [],
          },
          missingForNextStage: missing,
          supervisorHints: (opp.supervisorHints || []).slice(0, 6),
          recentVisits: recentVisits.map((v) => ({
            title: v.title,
            time: v.time,
            status: v.status,
            notes: v.notes,
          })),
          instruction:
            '严格按 JSON Schema 输出；不得因 refreshNonce 改变事实判断；信息不足写入 pendingChecks；禁止输出赢单率百分比。',
        }),
        temperature: 0.2,
        maxTokens: 900,
        schema: opportunityInsightLlmOutputSchema,
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
    stage: opp.stage,
    kind: opp.kind,
    syncLabel: opp.syncLabel,
    missingCount: missing.length,
    recentVisitCount: recentVisits.length,
    lastVisitSentiment: opp.lastVisit?.sentiment,
    hasWinForecast,
    contactName,
  })
}

/** Registered for catalog visibility; primary entry is generateOpportunityInsight via API. */
export const opportunityInsightAgent: DomainAgent = {
  name: 'OpportunityInsight',
  displayName: '商机洞察 Agent',
  description: '根据商机阶段、缺口字段与近期拜访生成中文 AI 洞察与行动建议',
  intents: [],
  async run() {
    return {
      mode: 'heuristic',
      messages: [
        {
          id: `msg_${Math.random().toString(36).slice(2, 10)}`,
          role: 'assistant',
          agent_id: 'OpportunityInsight',
          agent_name: '商机洞察 Agent',
          content: '请在商机详情页点击「AI 洞察」生成建议。',
          sources: [],
          confidence: 0.5,
          confidence_kind: 'answer',
          agent_chain: ['Orchestrator', '商机洞察 Agent'],
          createdAt: new Date().toISOString(),
        },
      ],
    }
  },
}
