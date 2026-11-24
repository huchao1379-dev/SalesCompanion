/**
 * Customer profile (客户画像) data access.
 * CRM facts vs AI content are separated; mock fallback is explicitly labeled.
 */
import type { AccountProfile, SourceRef, SyncStatus } from '../agents/types'
import { api } from '../api/client'
import { STAGE_LABEL, formatMoney, type VisitSentiment } from './pipeline'
import { isOnline } from './offlineQueue'

export type DataOrigin = 'api' | 'mock'

export type AccountTabId = 'overview' | 'contacts' | 'opportunities' | 'equipment' | 'interactions'

export type AiBulletKind = 'observation' | 'suggestion'

export type AiBullet = {
  id: string
  kind: AiBulletKind
  text: string
  /** Evidence quality — never invent when insufficient. */
  sufficiency: 'ok' | 'insufficient'
  sources: SourceRef[]
  updatedAt: string
}

export type ProfileContact = {
  id: string
  name: string
  title: string
  department: string
  role: string
  isPrimary: boolean
  lastContactAt: string | null
  phone: string | null
  email: string | null
  /** Whether current user may see business channels. */
  canViewChannels: boolean
  channelsVisible: boolean
}

export type ProfileOpportunity = {
  id: string
  name: string
  stage: string
  stageLabel: string
  amount: number
  currency: string
  closeDate: string
  ownerName: string
  nextAction: string
  kind: 'pipeline' | 'draft'
  syncStatus?: SyncStatus
  syncLabel: string
  /** null → UI shows 暂无可靠预测; never use visit mood as win rate. */
  winForecast: { probability: number; source: 'crm' | 'ai'; updatedAt: string } | null
  productLine: string
}

export type ProfileEquipment = {
  id: string
  productLine: string
  status: string
  lastServiceAt: string | null
  openItems: string
  dataComplete: boolean
  sourceLabel: string
}

export type ProfileInteraction = {
  id: string
  at: string
  type: 'visit' | 'call' | 'email' | 'meeting' | 'opportunity'
  typeLabel: string
  contactName: string
  summary: string
  result: string
  followUp: string
  sentiment: VisitSentiment | null
  sourceLabel: string
}

export type ProfileHighlight = {
  id: string
  label: string
  value: string
  tone: 'neutral' | 'positive' | 'risk' | 'warn'
}

export type AccountProfileView = {
  dataOrigin: DataOrigin
  loadedAt: string
  asOf: string
  note: string
  partialUnavailable: string[]
  stale: boolean
  permissions: {
    canViewAddress: boolean
    canViewContactChannels: boolean
    canViewService: boolean
  }
  header: {
    accountRef: string
    accountId: string
    name: string
    accountType: string
    region: string
    tier: string
    status: string
    ownerName: string
  }
  relationship: {
    lastContactAt: string | null
    openOppCount: number
    openOppAmount: number
    currency: string
    pendingFollowUps: number
  }
  facts: {
    region: string
    address: string | null
    addressHidden: boolean
    tier: string
    ownerName: string
    updatedAt: string | null
    hasMsa: boolean | null
    visitCount30d: number | null
    npsDelta: string | null
  }
  ai: {
    agentName: string
    updatedAt: string
    sources: SourceRef[]
    bullets: AiBullet[]
    rawContent: string
  }
  highlights: ProfileHighlight[]
  products: Array<{ id: string; label: string; status: string }>
  contacts: ProfileContact[]
  opportunities: ProfileOpportunity[]
  equipment: ProfileEquipment[]
  interactions: ProfileInteraction[]
}

const PENDING = '待补充'

type ApiAccount = {
  id: string
  externalKey: string
  name: string
  region?: string
  creditLevel: string
  visitCount30d: number
  npsDelta?: string
  lastVisitAt?: string
  hasMsa?: boolean
  notes?: string
}

type ApiContact = {
  id: string
  accountId: string
  name: string
  title?: string
  phone?: string
  email?: string
}

type ApiOpp = {
  id: string
  name: string
  stage: string
  amount?: number
  currencyCode?: string
  closeDate?: string
  productLine: string
  productModel?: string
  confidenceScore?: number
  syncStatus?: string
  isSeed?: boolean
  crmWinProbability?: number | null
  ownerName?: string | null
  nextAction?: { label: string; dueAt: string } | null
}

type ApiOrder = {
  id: string
  name: string
  status: string
  orderedAt: string
  amount: number
  currencyCode: string
  externalKey?: string
}

type ApiShipment = {
  id: string
  orderId: string
  name: string
  status: string
  eta: string
  trackingNo: string
}

type ApiActivity = {
  id: string
  subject: string
  summary: string
  visitType: string
  contactName: string
  followUpAt: string
  scheduledStart?: string
  updatedAt: string
  syncStatus: SyncStatus
}

type ApiOppDraft = {
  id: string
  name: string
  stage: string
  estimatedValue: number
  currency: string
  closeDate: string
  productLine: string
  productModel?: string
  syncStatus: SyncStatus
  confidence: number
  updatedAt: string
}

function display(value: string | null | undefined, fallback = PENDING): string {
  const v = (value ?? '').trim()
  return v ? v : fallback
}

function dateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  return iso.slice(0, 10)
}

function normalizeStatus(status?: string): SyncStatus | undefined {
  if (!status) return undefined
  const key = status.replace(/[_-\s]/g, '').toLowerCase()
  const map: Record<string, SyncStatus> = {
    draft: 'Draft',
    confirmed: 'Confirmed',
    syncing: 'Syncing',
    synced: 'Synced',
    syncfailed: 'SyncFailed',
    discarded: 'Discarded',
  }
  return map[key]
}

function syncLabelFromStatus(status?: string, isDraft = false): string {
  const normalized = normalizeStatus(status)
  if (isDraft || normalized === 'Draft') return '待确认'
  if (normalized === 'SyncFailed') return '同步失败'
  if (normalized === 'Syncing') return '同步中'
  if (normalized === 'Synced' || normalized === 'Confirmed') return '已同步'
  return '正式商机'
}

function mapSentimentLabel(s: VisitSentiment | null): string {
  if (s === 'positive') return '积极'
  if (s === 'neutral') return '中性'
  if (s === 'risk') return '有风险'
  return PENDING
}

export { mapSentimentLabel }

function buildAiBullets(
  account: ApiAccount,
  opps: ApiOpp[],
  profileContent: string,
  sources: SourceRef[],
  updatedAt: string,
): AiBullet[] {
  const bullets: AiBullet[] = []
  const push = (kind: AiBulletKind, text: string, sufficiency: 'ok' | 'insufficient') => {
    bullets.push({
      id: `ai-${bullets.length + 1}`,
      kind,
      text,
      sufficiency,
      sources,
      updatedAt,
    })
  }

  push(
    'observation',
    `近 30 天拜访 ${account.visitCount30d} 次${account.lastVisitAt ? `，最近接触 ${dateLabel(account.lastVisitAt)}` : ''}`,
    'ok',
  )

  if (opps.length === 0) {
    push('observation', '当前无开放商机记录', 'ok')
  } else {
    const names = opps
      .slice(0, 3)
      .map((o) => `${o.productLine}${o.productModel ? ' ' + o.productModel : ''}（${STAGE_LABEL[o.stage] || o.stage}）`)
      .join('、')
    push('observation', `开放商机重点：${names}`, 'ok')
  }

  const content = (profileContent || account.notes || '').trim()
  if (content) {
    const parts = content
      .split(/[。；\n]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 6)
      .slice(0, 3)
    for (const part of parts) {
      const looksSuggest = /建议|下一步|应|需|可考虑|关注/.test(part)
      const thin = /可能|或许|估计|待确认|待核实/.test(part)
      push(looksSuggest ? 'suggestion' : 'observation', part, thin ? 'insufficient' : 'ok')
    }
  } else {
    push('suggestion', '信息不足，暂无可靠的下一步建议', 'insufficient')
  }

  return bullets.slice(0, 6)
}

function mapOpportunities(opps: ApiOpp[], drafts: ApiOppDraft[] = []): ProfileOpportunity[] {
  const formal: ProfileOpportunity[] = opps.map((o) => {
    const crmWin = o.crmWinProbability
    return {
      id: o.id,
      name: o.name,
      stage: o.stage,
      stageLabel: STAGE_LABEL[o.stage] || o.stage,
      amount: o.amount ?? 0,
      currency: o.currencyCode || 'USD',
      closeDate: display(dateLabel(o.closeDate)),
      ownerName: display(o.ownerName),
      nextAction: o.nextAction
        ? `${o.nextAction.label}（截止 ${dateLabel(o.nextAction.dueAt) || PENDING}）`
        : PENDING,
      kind: 'pipeline',
      syncStatus: normalizeStatus(o.syncStatus) || 'Synced',
      syncLabel: syncLabelFromStatus(o.syncStatus, false),
      winForecast:
        typeof crmWin === 'number'
          ? { probability: crmWin, source: 'crm', updatedAt: new Date().toISOString() }
          : null,
      productLine: [o.productLine, o.productModel].filter(Boolean).join(' '),
    }
  })

  const draftRows: ProfileOpportunity[] = drafts.map((d) => ({
    id: d.id,
    name: d.name,
    stage: d.stage,
    stageLabel: STAGE_LABEL[d.stage] || d.stage,
    amount: d.estimatedValue,
    currency: d.currency || 'USD',
    closeDate: display(dateLabel(d.closeDate)),
    ownerName: PENDING,
    nextAction: '确认草稿后同步',
    kind: 'draft',
    syncStatus: d.syncStatus,
    syncLabel: syncLabelFromStatus(d.syncStatus, true),
    // AI draft confidence is NOT win probability
    winForecast: null,
    productLine: [d.productLine, d.productModel].filter(Boolean).join(' '),
  }))

  return [...draftRows, ...formal]
}

function mapContacts(contacts: ApiContact[], canViewChannels: boolean): ProfileContact[] {
  return contacts.map((c, i) => {
    const phone = (c.phone || '').trim() || null
    const email = (c.email || '').trim() || null
    return {
      id: c.id,
      name: display(c.name),
      title: display(c.title),
      department: PENDING,
      role: PENDING,
      isPrimary: i === 0,
      lastContactAt: null,
      phone,
      email,
      canViewChannels,
      channelsVisible: canViewChannels,
    }
  })
}

function mapEquipment(orders: ApiOrder[], shipments: ApiShipment[]): ProfileEquipment[] {
  return orders.map((o) => {
    const ship = shipments.find((s) => s.orderId === o.id)
    return {
      id: o.id,
      productLine: o.name,
      status: ship?.status || o.status || PENDING,
      lastServiceAt: dateLabel(ship?.eta) || dateLabel(o.orderedAt),
      openItems: ship && ship.status !== '已签收' ? `物流：${ship.status}（${ship.trackingNo}）` : '无未结服务事项',
      dataComplete: Boolean(ship),
      sourceLabel: o.externalKey ? `订单 ${o.externalKey}` : '订单记录',
    }
  })
}

function mapInteractions(
  account: ApiAccount,
  activities: ApiActivity[],
  opps: ApiOpp[],
): ProfileInteraction[] {
  const rows: ProfileInteraction[] = []

  for (const a of activities) {
    rows.push({
      id: a.id,
      at: a.scheduledStart || a.updatedAt,
      type: /电话|call/i.test(a.visitType) ? 'call' : 'visit',
      typeLabel: a.visitType || '拜访',
      contactName: display(a.contactName),
      summary: a.summary || a.subject,
      result: PENDING,
      followUp: display(dateLabel(a.followUpAt), '无跟进日期'),
      sentiment: null,
      sourceLabel: `活动草稿 · ${a.syncStatus}`,
    })
  }

  if (rows.length === 0 && account.lastVisitAt) {
    rows.push({
      id: `visit-${account.id}`,
      at: account.lastVisitAt,
      type: 'visit',
      typeLabel: '拜访',
      contactName: PENDING,
      summary: account.notes?.slice(0, 80) || 'CRM 仅记录最近接触时间，无完整拜访纪要',
      result: PENDING,
      followUp: PENDING,
      sentiment: null,
      sourceLabel: 'Account.lastVisitAt',
    })
  }

  for (const o of opps.slice(0, 2)) {
    rows.push({
      id: `opp-chg-${o.id}`,
      at: o.closeDate || account.lastVisitAt || new Date().toISOString(),
      type: 'opportunity',
      typeLabel: '商机',
      contactName: PENDING,
      summary: `${o.name} · 阶段 ${STAGE_LABEL[o.stage] || o.stage}`,
      result: '阶段记录',
      followUp: display(dateLabel(o.closeDate)),
      sentiment: null,
      sourceLabel: 'Opportunity',
    })
  }

  return rows.sort((a, b) => b.at.localeCompare(a.at))
}

function buildHighlights(
  account: ApiAccount,
  opps: ApiOpp[],
  orders: ApiOrder[],
  shipments: ApiShipment[],
): ProfileHighlight[] {
  const items: ProfileHighlight[] = []
  items.push({
    id: 'h-visit',
    label: '最近拜访',
    value: account.lastVisitAt
      ? `${dateLabel(account.lastVisitAt)} · 结果${PENDING}`
      : '暂无拜访记录',
    tone: account.lastVisitAt ? 'neutral' : 'warn',
  })

  const riskOpp = opps.find((o) => (o.confidenceScore ?? 1) < 0.6)
  if (riskOpp) {
    items.push({
      id: 'h-opp',
      label: '需关注商机',
      value: `${riskOpp.name} · 阶段 ${STAGE_LABEL[riskOpp.stage] || riskOpp.stage}（AI 信心度偏低，非赢单概率）`,
      tone: 'risk',
    })
  } else if (opps[0]) {
    items.push({
      id: 'h-opp',
      label: '重点商机',
      value: `${opps[0].name} · ${STAGE_LABEL[opps[0].stage] || opps[0].stage}`,
      tone: 'positive',
    })
  }

  const openShip = shipments.find((s) => s.status !== '已签收')
  if (openShip) {
    items.push({
      id: 'h-svc',
      label: '服务/物流风险',
      value: `${openShip.name} · ${openShip.status} · ETA ${openShip.eta}`,
      tone: 'warn',
    })
  } else if (orders.length === 0) {
    items.push({
      id: 'h-svc',
      label: '设备与服务',
      value: '暂无订单/服务同步数据',
      tone: 'warn',
    })
  }

  items.push({
    id: 'h-follow',
    label: '待跟进',
    value:
      opps.filter((o) => !o.nextAction).length > 0
        ? `${opps.length} 个开放商机下一步行动待补充`
        : '跟进事项待补充',
    tone: 'warn',
  })

  return items
}

function toViewFromApi(payload: {
  account: ApiAccount
  contacts: ApiContact[]
  opportunities: ApiOpp[]
  opportunityDrafts?: ApiOppDraft[]
  orders: ApiOrder[]
  shipments?: ApiShipment[]
  activities?: ApiActivity[]
  profile?: { sources?: SourceRef[]; content?: string; agent_name?: string; createdAt?: string }
  meta?: { asOf?: string; note?: string; missingFields?: string[]; dataSource?: string }
}): AccountProfileView {
  const account = payload.account
  const opps = payload.opportunities || []
  const drafts = payload.opportunityDrafts || []
  const orders = payload.orders || []
  const shipments = payload.shipments || []
  const activities = payload.activities || []
  const sources = payload.profile?.sources || [
    { kind: 'dataverse', label: `${account.name} · Account`, ref: account.externalKey },
  ]
  const updatedAt = payload.profile?.createdAt || payload.meta?.asOf || new Date().toISOString()
  const openAmount = opps.reduce((sum, o) => sum + (o.amount || 0), 0)
  const currency = opps[0]?.currencyCode || orders[0]?.currencyCode || 'USD'
  const canViewAddress = false // address not in seed; permission gate reserved
  const canViewChannels = true
  const canViewService = true
  const missing = payload.meta?.missingFields || []

  return {
    dataOrigin: 'api',
    loadedAt: new Date().toISOString(),
    asOf: payload.meta?.asOf || updatedAt,
    note: payload.meta?.note || '数据来自 Dataverse 种子/内存库。',
    partialUnavailable: missing,
    stale: false,
    permissions: { canViewAddress, canViewContactChannels: canViewChannels, canViewService },
    header: {
      accountRef: account.externalKey,
      accountId: account.id,
      name: account.name,
      accountType: PENDING,
      region: display(account.region),
      tier: display(account.creditLevel, PENDING),
      status: account.hasMsa ? '已签 MSA' : '合作状态待补充',
      ownerName: PENDING,
    },
    relationship: {
      lastContactAt: dateLabel(account.lastVisitAt),
      openOppCount: opps.length + drafts.filter((d) => d.syncStatus === 'Draft').length,
      openOppAmount: openAmount + drafts.reduce((s, d) => s + (d.estimatedValue || 0), 0),
      currency,
      pendingFollowUps: opps.filter((o) => !o.nextAction).length + (account.lastVisitAt ? 1 : 0),
    },
    facts: {
      region: display(account.region),
      address: null,
      addressHidden: !canViewAddress,
      tier: display(account.creditLevel),
      ownerName: PENDING,
      updatedAt: dateLabel(account.lastVisitAt),
      hasMsa: typeof account.hasMsa === 'boolean' ? account.hasMsa : null,
      visitCount30d: account.visitCount30d,
      npsDelta: account.npsDelta ?? null,
    },
    ai: {
      agentName: payload.profile?.agent_name || '客户画像 Agent',
      updatedAt,
      sources,
      bullets: buildAiBullets(account, opps, payload.profile?.content || '', sources, updatedAt),
      rawContent: payload.profile?.content || account.notes || '',
    },
    highlights: buildHighlights(account, opps, orders, shipments),
    products: opps.slice(0, 4).map((o) => ({
      id: `prod-${o.id}`,
      label: [o.productLine, o.productModel].filter(Boolean).join(' '),
      status: `商机 · ${STAGE_LABEL[o.stage] || o.stage}`,
    })),
    contacts: mapContacts(payload.contacts || [], canViewChannels),
    opportunities: mapOpportunities(opps, drafts),
    equipment: canViewService ? mapEquipment(orders, shipments) : [],
    interactions: mapInteractions(account, activities, opps),
  }
}

export type LoadAccountProfileResult = {
  view: AccountProfileView | null
  error: 'not-found' | 'network' | 'forbidden' | null
  offline: boolean
}

export async function loadAccountProfile(refOrName: string): Promise<LoadAccountProfileResult> {
  if (!isOnline()) {
    return { view: null, error: 'network', offline: true }
  }

  try {
    const res = (await api.account(refOrName)) as Parameters<typeof toViewFromApi>[0]
    if (!res?.account) {
      return { view: null, error: 'not-found', offline: false }
    }
    return { view: toViewFromApi(res), error: null, offline: false }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (/403|forbidden/i.test(msg)) {
      return { view: null, error: 'forbidden', offline: false }
    }
    return { view: null, error: 'network', offline: false }
  }
}

/** Legacy slim profile for ActivityCapture / Brief. */
export function toLegacyAccountProfile(view: AccountProfileView): AccountProfile {
  return {
    accountRef: view.header.accountRef,
    accountName: view.header.name,
    creditRating: view.header.tier === PENDING ? '—' : view.header.tier,
    visitCount30d: view.facts.visitCount30d ?? 0,
    npsDelta: view.facts.npsDelta ?? undefined,
    lastContactAt: view.relationship.lastContactAt ?? undefined,
    openOpportunities: view.opportunities
      .filter((o) => o.kind === 'pipeline')
      .map((o) => ({
        name: o.name,
        stage: o.stage,
        confidence: o.winForecast?.probability ?? 0,
        productLine: o.productLine,
      })),
    summary: view.ai.rawContent || view.ai.bullets.map((b) => b.text).join('。'),
    sources: view.ai.sources,
  }
}

export function formatAsOf(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso.slice(0, 16)
  }
}

export function formatProfileMoney(amount: number, currency: string): string {
  return `${formatMoney(amount, currency)}（${currency}）`
}
