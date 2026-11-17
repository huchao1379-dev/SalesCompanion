import type { OpportunityDraftPayload } from '../agents/types'
import { upsertDraft } from './dataverse'
import {
  STAGE_LABEL,
  loadPipelineSnapshot,
  type PipelineItem,
  type VisitSentiment,
  type WinForecast,
} from './pipeline'

/** Canonical stage order used by the progress rail (maps to existing CRM stages). */
export const DETAIL_STAGES = [
  { key: 'Identify', label: '识别' },
  { key: 'Qualify', label: '评估' },
  { key: 'Propose', label: '方案' },
  { key: 'Negotiate', label: '谈判' },
  { key: 'Closed', label: '成交' },
] as const

export type DetailStageKey = (typeof DETAIL_STAGES)[number]['key']

export type AmountState = 'confirmed' | 'estimated' | 'pending-confirm'

export type OpportunityContact = {
  id: string
  name: string
  title: string
  role: string
  phone?: string
  email?: string
  isPrimary: boolean
}

export type TimelineEventType =
  | 'visit'
  | 'call'
  | 'email'
  | 'stage'
  | 'quote'
  | 'sync'

export type TimelineEvent = {
  id: string
  type: TimelineEventType
  title: string
  summary: string
  at: string
  source: string
  actor: string
  /** Explicit mock/local marker when not from live CRM */
  origin: 'api' | 'mock' | 'local'
}

export type AiInsight = {
  id: string
  suggestion: string
  basis: string
  updatedAt: string
  confidence: number
  needsReview: boolean
  sourceLabel: string
}

export type OpportunityDetail = PipelineItem & {
  updatedAt: string
  amountState: AmountState
  amountNote: string
  budgetStatus: string
  competition: string
  sourceLabel: string
  linkedVisitLabel: string
  winWhy: string[]
  missingForNextStage: string[]
  contacts: OpportunityContact[]
  aiInsights: AiInsight[]
  timeline: TimelineEvent[]
  canEditFields: boolean
  permissionNote?: string
}

const LOCAL_EVENTS_KEY = 'salescompanion.opp.timeline.v1'
const LOCAL_META_KEY = 'salescompanion.opp.meta.v1'

type LocalMeta = {
  stageOverrides: Record<string, string>
  outcomeOverrides: Record<string, 'won' | 'lost' | ''>
  updatedAt: Record<string, string>
}

function readMeta(): LocalMeta {
  try {
    const raw = localStorage.getItem(LOCAL_META_KEY)
    if (!raw) return { stageOverrides: {}, outcomeOverrides: {}, updatedAt: {} }
    return JSON.parse(raw) as LocalMeta
  } catch {
    return { stageOverrides: {}, outcomeOverrides: {}, updatedAt: {} }
  }
}

function writeMeta(meta: LocalMeta) {
  localStorage.setItem(LOCAL_META_KEY, JSON.stringify(meta))
}

function readLocalEvents(): Record<string, TimelineEvent[]> {
  try {
    const raw = localStorage.getItem(LOCAL_EVENTS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, TimelineEvent[]>
  } catch {
    return {}
  }
}

function writeLocalEvents(map: Record<string, TimelineEvent[]>) {
  localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(map))
}

export function appendLocalTimelineEvent(opportunityId: string, event: Omit<TimelineEvent, 'id' | 'origin'>) {
  const map = readLocalEvents()
  const row: TimelineEvent = {
    ...event,
    id: `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    origin: 'local',
  }
  map[opportunityId] = [row, ...(map[opportunityId] || [])].slice(0, 40)
  writeLocalEvents(map)
  const meta = readMeta()
  meta.updatedAt[opportunityId] = event.at
  writeMeta(meta)
  return row
}

function stageIndex(stage: string) {
  const idx = DETAIL_STAGES.findIndex((s) => s.key === stage)
  return idx >= 0 ? idx : 0
}

export function missingFieldsForNextStage(item: PipelineItem): string[] {
  const idx = stageIndex(item.stage)
  if (idx >= DETAIL_STAGES.length - 1) return []
  const next = DETAIL_STAGES[idx + 1]
  const missing: string[] = []
  if (item.kind === 'draft' || item.contactName === '待确认' || item.contactName === '未指定') {
    missing.push('主联系人')
  }
  if (!item.closeDate) missing.push('预计成交日')
  if (!item.amount) missing.push('商机金额')
  if (!item.productLine) missing.push('产品/服务')
  if (next.key === 'Qualify' && !item.lastVisit) missing.push('至少一次客户互动记录')
  if (next.key === 'Propose' && item.pendingFields.includes('数量')) missing.push('确认数量')
  if (next.key === 'Negotiate') missing.push('预算状态确认')
  if (item.kind === 'draft' && item.syncLabel === '待确认') missing.push('草稿字段人工确认')
  return [...new Set(missing)]
}

function amountStateFor(item: PipelineItem): { state: AmountState; note: string } {
  if (item.kind === 'draft' && item.syncLabel === '待确认') {
    return { state: 'pending-confirm', note: 'AI/手动预估 · 待确认后才可写入业务系统' }
  }
  if (item.kind === 'draft' && item.syncLabel === '已同步') {
    return { state: 'confirmed', note: '已通过确认同步（以同步结果为准）' }
  }
  if (item.kind === 'pipeline') {
    return { state: 'estimated', note: '种子/管线预估金额 · 非已确认合同额' }
  }
  return { state: 'estimated', note: '预估金额' }
}

function buildContacts(item: PipelineItem): OpportunityContact[] {
  if (!item.contactName || item.contactName === '未指定' || item.contactName === '待确认') {
    return []
  }
  return [
    {
      id: `primary-${item.id}`,
      name: item.contactName,
      title: item.contactTitle || '待补充',
      role: '主联系人',
      isPrimary: true,
    },
  ]
}

function buildWinWhy(item: PipelineItem, forecast: WinForecast): string[] {
  if (!forecast) return []
  const why: string[] = []
  why.push(`当前阶段：${STAGE_LABEL[item.stage] ?? item.stage}`)
  if (item.lastVisit) {
    why.push(`近期互动：${item.lastVisit.date}（${item.lastVisit.sentiment === 'positive' ? '积极' : item.lastVisit.sentiment === 'risk' ? '有风险' : '中性'}）`)
  } else {
    why.push('近期互动：暂无可靠拜访记录')
  }
  why.push('预算确认情况：数据源未提供，未纳入预测依据')
  why.push(
    forecast.source === 'crm'
      ? '预测来源：CRM 官方赢单概率字段'
      : '预测来源：AI 估算（非提取置信度）',
  )
  return why
}

function buildAiInsights(item: PipelineItem): AiInsight[] {
  const updatedAt = new Date().toISOString()
  if (item.kind === 'draft' && item.draft) {
    const hints = item.draft.supervisorHints || []
    if (hints.length === 0) {
      return [
        {
          id: `${item.id}-ai-empty`,
          suggestion: '暂无结构化 AI 建议。可在确认字段后再次从拜访生成洞察。',
          basis: '无 supervisorHints',
          updatedAt,
          confidence: item.draft.confidence,
          needsReview: true,
          sourceLabel: 'AI 草稿',
        },
      ]
    }
    return hints.map((h, i) => ({
      id: `${item.id}-hint-${i}`,
      suggestion: h,
      basis: '编排 Supervisor 提示 · 不会自动改写正式字段',
      updatedAt: item.draft?.updatedAt || updatedAt,
      confidence: item.draft?.confidence ?? 0.5,
      needsReview: (item.draft?.confidence ?? 0) < 0.7 || true,
      sourceLabel: item.draft?.agentName || 'AI',
    }))
  }

  // Pipeline seed: only surface review-needed insights from account notes — not win rates.
  if (item.lastVisit?.summary) {
    return [
      {
        id: `${item.id}-note`,
        suggestion: `跟进提示：关注「${item.lastVisit.summary}」。此为账户备注摘要，不是赢单概率。`,
        basis: '账户 notes / 最近拜访摘要',
        updatedAt: item.lastVisit.date,
        confidence: 0.55,
        needsReview: true,
        sourceLabel: '账户备注',
      },
    ]
  }
  return []
}

function seedTimeline(item: PipelineItem): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const origin = item.dataOrigin === 'api' ? 'api' : item.dataOrigin === 'mock' ? 'mock' : 'local'

  if (item.lastVisit) {
    events.push({
      id: `${item.id}-visit`,
      type: 'visit',
      title: '客户拜访',
      summary: item.lastVisit.summary,
      at: `${item.lastVisit.date}T10:00:00.000Z`,
      source: '账户最近接触',
      actor: item.ownerName !== '未指定' ? item.ownerName : '系统',
      origin,
    })
  }

  events.push({
    id: `${item.id}-stage`,
    type: 'stage',
    title: `阶段：${STAGE_LABEL[item.stage] ?? item.stage}`,
    summary: '当前管线阶段（来自种子/草稿，非实时 SAP 推送）',
    at: item.closeDate ? `${item.closeDate}T00:00:00.000Z` : new Date().toISOString(),
    source: item.kind === 'draft' ? '商机草稿' : '管线种子',
    actor: '系统',
    origin,
  })

  if (item.kind === 'draft' && item.draft) {
    events.push({
      id: `${item.id}-created`,
      type: 'sync',
      title: 'AI/手动草稿创建',
      summary: `状态 ${item.syncLabel}`,
      at: item.draft.createdAt || item.draft.updatedAt || new Date().toISOString(),
      source: item.draft.agentName,
      actor: item.draft.agentName,
      origin: 'local',
    })
    if (item.draft.syncStatus === 'Synced' || item.draft.syncStatus === 'SyncFailed') {
      events.push({
        id: `${item.id}-sync`,
        type: 'sync',
        title: item.draft.syncStatus === 'Synced' ? '同步完成' : '同步失败',
        summary: item.draft.syncError || item.draft.sapExternalId || item.syncLabel,
        at: item.draft.updatedAt || new Date().toISOString(),
        source: 'confirmDraft',
        actor: '当前用户',
        origin: item.draft.sapExternalId?.startsWith('MOCK-') ? 'local' : 'api',
      })
    }
  }

  return events.sort((a, b) => b.at.localeCompare(a.at))
}

function enrich(item: PipelineItem): OpportunityDetail {
  const meta = readMeta()
  const stage = meta.stageOverrides[item.id] || item.stage
  const patched: PipelineItem = { ...item, stage }
  const amount = amountStateFor(patched)
  const forecast = patched.winForecast
  const localEvents = readLocalEvents()[item.id] || []
  const timeline = [...localEvents, ...seedTimeline(patched)].sort((a, b) =>
    b.at.localeCompare(a.at),
  )
  const updatedAt =
    meta.updatedAt[item.id] ||
    patched.draft?.updatedAt ||
    timeline[0]?.at ||
    new Date().toISOString()

  return {
    ...patched,
    updatedAt,
    amountState: amount.state,
    amountNote: amount.note,
    budgetStatus: '待补充',
    competition: '待补充',
    sourceLabel:
      patched.kind === 'draft'
        ? patched.draft?.agentName || 'AI/手动草稿'
        : patched.isSeed
          ? 'Dataverse 种子管线'
          : '管线记录',
    linkedVisitLabel: patched.lastVisit
      ? `${patched.lastVisit.date} · ${patched.lastVisit.summary.slice(0, 24)}`
      : '暂无关联拜访',
    winWhy: buildWinWhy(patched, forecast),
    missingForNextStage: missingFieldsForNextStage(patched),
    contacts: buildContacts(patched),
    aiInsights: buildAiInsights(patched),
    timeline,
    canEditFields: patched.kind === 'draft' && (patched.syncStatus === 'Draft' || patched.syncStatus === 'SyncFailed'),
    permissionNote:
      patched.kind === 'pipeline'
        ? '正式管线字段暂无 SAP 回写接口；阶段变更仅记本地时间线，不伪造成功同步。'
        : undefined,
  }
}

export async function loadOpportunityDetail(
  opportunityId: string,
  seedDrafts: OpportunityDraftPayload[] = [],
): Promise<{ detail: OpportunityDetail | null; note: string; offline: boolean }> {
  const snap = await loadPipelineSnapshot(seedDrafts)
  const item = snap.items.find((i) => i.id === opportunityId) || null
  if (!item) {
    return {
      detail: null,
      note: '未找到该商机。可能已被丢弃，或离线缓存中不存在。',
      offline: snap.dataOrigin === 'mock',
    }
  }
  return {
    detail: enrich(item),
    note: snap.note,
    offline: snap.dataOrigin === 'mock' || snap.dataOrigin === 'mixed',
  }
}

export type SaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'syncing'
  | 'synced'
  | 'sync-failed'

/** Advance stage locally for drafts (field update) or timeline-only for pipeline. */
export function advanceStageLocally(detail: OpportunityDetail): {
  detail: OpportunityDetail
  saved: boolean
  message: string
} {
  const idx = stageIndex(detail.stage)
  if (idx >= DETAIL_STAGES.length - 1) {
    return { detail, saved: false, message: '已在最终阶段' }
  }
  const next = DETAIL_STAGES[idx + 1].key
  const at = new Date().toISOString()

  if (detail.kind === 'draft' && detail.draft && detail.canEditFields) {
    const updated: OpportunityDraftPayload = {
      ...detail.draft,
      stage: next,
      updatedAt: at,
    }
    upsertDraft(updated)
    appendLocalTimelineEvent(detail.id, {
      type: 'stage',
      title: `阶段推进至 ${STAGE_LABEL[next] ?? next}`,
      summary: '草稿本地保存 · 确认同步前不会写入 SAP',
      at,
      source: '商机详情',
      actor: '当前用户',
    })
    return {
      detail: enrich({ ...detail, stage: next, draft: updated, syncStatus: updated.syncStatus }),
      saved: true,
      message: '阶段已保存到草稿（待确认同步）',
    }
  }

  const meta = readMeta()
  meta.stageOverrides[detail.id] = next
  meta.updatedAt[detail.id] = at
  writeMeta(meta)
  appendLocalTimelineEvent(detail.id, {
    type: 'stage',
    title: `本地标记阶段 → ${STAGE_LABEL[next] ?? next}`,
    summary: '无 SAP 阶段回写接口 · 仅本地记录，未同步成功',
    at,
    source: '商机详情',
    actor: '当前用户',
  })
  return {
    detail: enrich({ ...detail, stage: next }),
    saved: true,
    message: '已本地记录阶段变更（未调用 SAP）',
  }
}

export function markOutcomeLocally(
  detail: OpportunityDetail,
  outcome: 'won' | 'lost',
): { detail: OpportunityDetail; message: string } {
  const at = new Date().toISOString()
  const meta = readMeta()
  meta.outcomeOverrides[detail.id] = outcome
  meta.updatedAt[detail.id] = at
  if (outcome === 'won') meta.stageOverrides[detail.id] = 'Closed'
  writeMeta(meta)
  appendLocalTimelineEvent(detail.id, {
    type: 'stage',
    title: outcome === 'won' ? '标记赢单（本地）' : '标记输单（本地）',
    summary: '无正式 SAP 赢/输单接口 · 未伪造成功提交',
    at,
    source: '商机详情',
    actor: '当前用户',
  })
  const stage = outcome === 'won' ? 'Closed' : detail.stage
  return {
    detail: enrich({ ...detail, stage }),
    message: outcome === 'won' ? '已本地标记赢单（未同步 SAP）' : '已本地标记输单（未同步 SAP）',
  }
}

export function sentimentLabel(s: VisitSentiment) {
  if (s === 'positive') return '积极'
  if (s === 'risk') return '有风险'
  return '中性'
}

export function formatDateTime(iso: string) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}
