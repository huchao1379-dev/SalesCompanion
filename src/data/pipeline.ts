import type { OpportunityDraftPayload, SyncStatus } from '../agents/types'
import { api } from '../api/client'
import { listDrafts } from './dataverse'

/** Visit outcome for list scanning — not a win-rate. */
export type VisitSentiment = 'positive' | 'neutral' | 'risk'

export type WinForecast = {
  probability: number
  /** CRM official forecast vs AI estimate — never invent CRM values. */
  source: 'crm' | 'ai'
} | null

export type PipelineRisk =
  | 'none'
  | 'pending-confirm'
  | 'sync-failed'
  | 'stale-visit'
  | 'low-signal'

export type PipelineItem = {
  id: string
  /** Formal pipeline vs AI draft awaiting confirm. */
  kind: 'pipeline' | 'draft'
  /** Where the row was loaded from. */
  dataOrigin: 'api' | 'mock' | 'local-draft'
  name: string
  accountName: string
  accountRef?: string
  stage: string
  amount: number
  currency: string
  ownerName: string
  contactName: string
  contactTitle: string
  closeDate: string
  productLine: string
  quantity: number
  syncLabel: '待确认' | '已同步' | '同步失败' | '同步中' | '进行中'
  syncStatus?: SyncStatus
  risk: PipelineRisk
  lastVisit: {
    date: string
    sentiment: VisitSentiment
    summary: string
  } | null
  nextAction: {
    label: string
    dueAt: string
  } | null
  /** null → UI must show「暂无可靠预测」 */
  winForecast: WinForecast
  /** AI draft fields that still need human confirm */
  pendingFields: string[]
  draft?: OpportunityDraftPayload
  isSeed?: boolean
}

export type PipelineSnapshot = {
  items: PipelineItem[]
  dataOrigin: 'api' | 'mock' | 'mixed'
  note: string
  loadedAt: string
}

export const STAGE_LABEL: Record<string, string> = {
  Identify: '识别',
  Qualify: '资格确认',
  Propose: '方案报价',
  Negotiate: '谈判',
  Closed: '成交',
}

export const RISK_LABEL: Record<PipelineRisk, string> = {
  none: '正常',
  'pending-confirm': '待确认',
  'sync-failed': '同步失败',
  'stale-visit': '拜访过旧',
  'low-signal': '信号偏弱',
}

export const SENTIMENT_LABEL: Record<VisitSentiment, string> = {
  positive: '积极',
  neutral: '中性',
  risk: '有风险',
}

type ApiOppRow = {
  id: string
  externalKey?: string
  name: string
  accountId: string
  accountName: string
  accountExternalKey?: string
  productLine: string
  productModel?: string
  quantity: number
  amount: number
  currencyCode: string
  stage: string
  confidenceScore: number
  closeDate?: string
  syncStatus?: string
  isSeed?: boolean
  accountLastVisitAt?: string
  accountVisitCount30d?: number
  accountNpsDelta?: string
  accountNotes?: string
  primaryContact?: { name: string; title: string } | null
  crmWinProbability?: number | null
  ownerName?: string | null
}

/**
 * Offline / API-down fallback — mirrors dataverse/seed/seed.json.
 * Explicitly marked mock; never pretend to be live SAP.
 */
const MOCK_PIPELINE: ApiOppRow[] = [
  {
    id: 'opp-n17',
    externalKey: 'SAP-OPP-N17',
    name: '上海仁济医院 · 监护仪 N17',
    accountId: 'acc-renji',
    accountName: '上海仁济医院',
    accountExternalKey: 'SAP-ACC-RENJI',
    productLine: '监护仪',
    productModel: 'N17',
    quantity: 12,
    amount: 144000,
    currencyCode: 'USD',
    stage: 'Identify',
    confidenceScore: 0.78,
    closeDate: '2026-09-30',
    syncStatus: 'synced',
    isSeed: true,
    accountLastVisitAt: '2026-04-22T10:00:00.000Z',
    accountVisitCount30d: 4,
    accountNpsDelta: '+12',
    accountNotes: '近 3 次拜访摘要已聚合；信用 A 级、已签 MSA。当前开放商机以监护仪 N17（Identify）为主。',
    primaryContact: { name: '张主任', title: '设备科主任' },
    crmWinProbability: null,
    ownerName: null,
  },
  {
    id: 'opp-a1',
    externalKey: 'SAP-OPP-A1',
    name: 'Hospital Alpha · A1 监护仪 ×8',
    accountId: 'acc-alpha',
    accountName: 'Hospital Alpha',
    accountExternalKey: 'SAP-ACC-ALPHA',
    productLine: '监护仪',
    productModel: 'A1',
    quantity: 8,
    amount: 96000,
    currencyCode: 'USD',
    stage: 'Identify',
    confidenceScore: 0.78,
    closeDate: '2026-09-30',
    syncStatus: 'synced',
    isSeed: true,
    accountLastVisitAt: '2026-04-29T14:00:00.000Z',
    accountVisitCount30d: 3,
    accountNpsDelta: '+8',
    accountNotes: '今日拜访关注 A3 演示反馈；ICU 升级评估可能在 6 月启动。',
    primaryContact: { name: 'Maria Silva', title: 'ICU Manager' },
    crmWinProbability: null,
    ownerName: null,
  },
  {
    id: 'opp-beta',
    externalKey: 'SAP-OPP-BETA-N17',
    name: 'Hospital Beta · N17',
    accountId: 'acc-beta',
    accountName: 'Hospital Beta',
    accountExternalKey: 'SAP-ACC-BETA',
    productLine: '监护仪',
    productModel: 'N17',
    quantity: 4,
    amount: 48000,
    currencyCode: 'USD',
    stage: 'Identify',
    confidenceScore: 0.55,
    closeDate: '2026-08-15',
    syncStatus: 'synced',
    isSeed: true,
    accountLastVisitAt: '2026-04-10T09:00:00.000Z',
    accountVisitCount30d: 2,
    accountNpsDelta: '-3',
    accountNotes: 'N17 商机信心度偏低，建议确认采购窗口。',
    primaryContact: null,
    crmWinProbability: null,
    ownerName: null,
  },
]

function blank(value: unknown) {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (typeof value === 'number') return !Number.isFinite(value) || value <= 0
  return false
}

function dateOnly(iso?: string) {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function daysSince(iso?: string) {
  if (!iso) return Infinity
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return Infinity
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000))
}

function sentimentFromAccount(nps?: string, notes?: string): VisitSentiment {
  const npsNum = nps ? Number(String(nps).replace('+', '')) : NaN
  if (!Number.isNaN(npsNum)) {
    if (npsNum < 0) return 'risk'
    if (npsNum >= 8) return 'positive'
  }
  const text = (notes || '').toLowerCase()
  if (/偏低|风险|过期|确认采购|失败/.test(text)) return 'risk'
  if (/msa|演示|升级|聚合|要点/.test(text)) return 'positive'
  return 'neutral'
}

function nextActionFromClose(closeDate?: string, stage?: string) {
  if (!closeDate) {
    return { label: '补充预计成交日', dueAt: '' }
  }
  const due = closeDate
  if (stage === 'Identify' || stage === 'Qualify') {
    return { label: '推进资格确认 / 明确采购窗口', dueAt: due }
  }
  if (stage === 'Propose') {
    return { label: '跟进方案与报价反馈', dueAt: due }
  }
  if (stage === 'Negotiate') {
    return { label: '推进商务条款', dueAt: due }
  }
  return { label: '核对成交收尾', dueAt: due }
}

function riskForPipeline(row: ApiOppRow): PipelineRisk {
  const stale = daysSince(row.accountLastVisitAt) > 45
  if (stale) return 'stale-visit'
  if ((row.confidenceScore ?? 1) < 0.65) return 'low-signal'
  if (row.accountNpsDelta && Number(String(row.accountNpsDelta).replace('+', '')) < 0) {
    return 'low-signal'
  }
  return 'none'
}

function mapApiOpp(row: ApiOppRow, origin: 'api' | 'mock'): PipelineItem {
  const visitDate = dateOnly(row.accountLastVisitAt)
  const sentiment = sentimentFromAccount(row.accountNpsDelta, row.accountNotes)
  const crmProb =
    typeof row.crmWinProbability === 'number' && row.crmWinProbability >= 0
      ? row.crmWinProbability
      : null

  return {
    id: row.externalKey || row.id,
    kind: 'pipeline',
    dataOrigin: origin,
    name: row.name,
    accountName: row.accountName,
    accountRef: row.accountExternalKey,
    stage: row.stage,
    amount: row.amount || 0,
    currency: row.currencyCode || 'CNY',
    ownerName: row.ownerName?.trim() || '未指定',
    contactName: row.primaryContact?.name || '未指定',
    contactTitle: row.primaryContact?.title || '',
    closeDate: dateOnly(row.closeDate),
    productLine: [row.productLine, row.productModel].filter(Boolean).join(' '),
    quantity: row.quantity || 0,
    syncLabel: '进行中',
    risk: riskForPipeline(row),
    lastVisit: visitDate
      ? {
          date: visitDate,
          sentiment,
          summary: (row.accountNotes || '近期有拜访记录').slice(0, 48),
        }
      : null,
    nextAction: nextActionFromClose(dateOnly(row.closeDate), row.stage),
    // Do not promote agent confidenceScore to win probability.
    winForecast: crmProb != null ? { probability: crmProb, source: 'crm' } : null,
    pendingFields: [],
    isSeed: row.isSeed,
  }
}

function pendingFieldsForDraft(d: OpportunityDraftPayload): string[] {
  const fields: string[] = []
  if (blank(d.name)) fields.push('商机名称')
  if (blank(d.accountName)) fields.push('客户')
  if (blank(d.productLine)) fields.push('产品')
  if (blank(d.quantity)) fields.push('数量')
  if (blank(d.estimatedValue)) fields.push('金额')
  if (blank(d.stage)) fields.push('阶段')
  if (blank(d.closeDate)) fields.push('成交日')
  if (d.confidence < 0.62) fields.push('低置信字段')
  return fields
}

function syncLabelForDraft(status: SyncStatus): PipelineItem['syncLabel'] {
  if (status === 'Draft') return '待确认'
  if (status === 'Synced') return '已同步'
  if (status === 'SyncFailed') return '同步失败'
  if (status === 'Syncing' || status === 'Confirmed') return '同步中'
  return '待确认'
}

function mapDraft(d: OpportunityDraftPayload): PipelineItem {
  const pending = pendingFieldsForDraft(d)
  let risk: PipelineRisk = 'none'
  if (d.syncStatus === 'SyncFailed') risk = 'sync-failed'
  else if (d.syncStatus === 'Draft') risk = 'pending-confirm'
  else if (d.confidence < 0.65) risk = 'low-signal'

  return {
    id: d.idempotencyKey,
    kind: 'draft',
    dataOrigin: 'local-draft',
    name: d.name || '未命名商机草稿',
    accountName: d.accountName || '客户待补充',
    accountRef: d.accountRef,
    stage: d.stage || 'Identify',
    amount: d.estimatedValue || 0,
    currency: d.currency || 'CNY',
    ownerName: '未指定',
    contactName: '待确认',
    contactTitle: '',
    closeDate: d.closeDate || '',
    productLine: d.productLine || '',
    quantity: d.quantity || 0,
    syncLabel: syncLabelForDraft(d.syncStatus),
    syncStatus: d.syncStatus,
    risk,
    lastVisit: null,
    nextAction: {
      label:
        d.syncStatus === 'SyncFailed'
          ? '修复后重试同步'
          : d.syncStatus === 'Draft'
            ? '核对 AI 字段并确认同步'
            : '继续跟进',
      dueAt: d.closeDate || '',
    },
    // Draft confidence is extraction confidence — show as AI estimate only when present & user asks win forecast?
    // Requirement: 赢单概率 only with trustworthy source. Extraction confidence ≠ win rate.
    winForecast: null,
    pendingFields: pending,
    draft: d,
  }
}

function mergeItems(pipeline: PipelineItem[], drafts: OpportunityDraftPayload[]): PipelineItem[] {
  const draftItems = drafts
    .filter((d) => d.syncStatus !== 'Discarded')
    .map(mapDraft)

  // Prefer showing drafts that aren't already represented as synced pipeline rows by name+account
  const pipelineKeys = new Set(
    pipeline.map((p) => `${p.accountName}::${p.name}`.toLowerCase()),
  )
  const uniqueDrafts = draftItems.filter((d) => {
    if (d.syncStatus === 'Synced') {
      const key = `${d.accountName}::${d.name}`.toLowerCase()
      return !pipelineKeys.has(key)
    }
    return true
  })

  return [...uniqueDrafts, ...pipeline].sort((a, b) => {
    const rank = (item: PipelineItem) => {
      if (item.syncLabel === '同步失败') return 0
      if (item.syncLabel === '待确认') return 1
      if (item.risk !== 'none') return 2
      return 3
    }
    return rank(a) - rank(b) || b.amount - a.amount
  })
}

export async function loadPipelineSnapshot(
  seedDrafts: OpportunityDraftPayload[] = [],
): Promise<PipelineSnapshot> {
  const localDrafts = [
    ...seedDrafts,
    ...listDrafts().filter((d): d is OpportunityDraftPayload => d.kind === 'opportunity'),
  ]
  const draftMap = new Map<string, OpportunityDraftPayload>()
  localDrafts.forEach((d) => draftMap.set(d.idempotencyKey, d))
  const drafts = [...draftMap.values()]

  try {
    const res = await api.opportunities()
    const rows = (res.opportunities || []) as ApiOppRow[]
    const pipeline = rows.map((r) => mapApiOpp(r, 'api'))
    const items = mergeItems(pipeline, drafts)
    return {
      items,
      dataOrigin: drafts.length ? 'mixed' : 'api',
      note: res.note || '管线数据来自服务端种子/内存库',
      loadedAt: new Date().toISOString(),
    }
  } catch {
    const pipeline = MOCK_PIPELINE.map((r) => mapApiOpp(r, 'mock'))
    const items = mergeItems(pipeline, drafts)
    return {
      items,
      dataOrigin: drafts.length ? 'mixed' : 'mock',
      note: '【本地 Mock】后端 /opportunities 不可用，已加载与 seed 对齐的离线管线数据',
      loadedAt: new Date().toISOString(),
    }
  }
}

export function formatMoney(value: number, currency = 'CNY') {
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString('zh-CN')}`
  }
}

export function computePipelineStats(items: PipelineItem[]) {
  const active = items.filter((i) => i.syncLabel !== '同步失败' || i.kind === 'pipeline')
  const pendingDrafts = items.filter((i) => i.kind === 'draft' && i.syncLabel === '待确认')
  const inProgress = items.filter(
    (i) => i.kind === 'pipeline' || (i.kind === 'draft' && i.syncLabel === '已同步'),
  )
  const failed = items.filter((i) => i.syncLabel === '同步失败')
  const unweighted = active.reduce((sum, i) => sum + (i.amount || 0), 0)
  const withForecast = active.filter((i) => i.winForecast != null)
  const weighted =
    withForecast.length === 0
      ? null
      : withForecast.reduce((sum, i) => sum + i.amount * (i.winForecast?.probability || 0), 0)
  const currency = items[0]?.currency || 'USD'
  return {
    total: items.length,
    pendingDrafts: pendingDrafts.length,
    inProgress: inProgress.length,
    failed: failed.length,
    unweighted,
    weighted,
    currency,
    forecastCoverage: withForecast.length,
  }
}
