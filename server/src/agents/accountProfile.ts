import {
  chatStructured,
  chatWithTools,
  hasDeepSeek,
  parseStructuredJson,
} from '../llm/deepseek.js'
import {
  accountProfileOutputSchema,
} from '../llm/schemas.js'
import type {
  AccountRecord,
  AgentMessage,
  ContactRecord,
  MessageUiBlock,
  MessageUiItem,
  MessageUiMetric,
  MessageUiMetricTone,
  OpportunityRecord,
  SourceRef,
} from '../types.js'
import { repository } from '../store/dataverseStore.js'
import {
  accountProfileToolResultSchema,
  accountQueryTools,
} from '../tools/readOnlyAgentTools.js'
import { ACCOUNT_PROFILE_SYSTEM, ACCOUNT_PROFILE_TOOL_ADDENDUM } from './prompts.js'
import { nowIsoInZone } from '../util/datetime.js'

export async function resolveAccount(query: string): Promise<AccountRecord | undefined> {
  const hits = await repository.searchAccounts(query)
  if (hits.length) return hits[0]
  const knownKey = /仁济/.test(query)
    ? 'SAP-ACC-RENJI'
    : /Alpha/i.test(query)
      ? 'SAP-ACC-ALPHA'
      : /Beta/i.test(query)
        ? 'SAP-ACC-BETA'
        : /Gamma/i.test(query)
          ? 'SAP-ACC-GAMMA'
          : /Delta/i.test(query)
            ? 'SAP-ACC-DELTA'
            : undefined
  if (knownKey) return repository.getAccount(knownKey)
  return undefined
}

export type AccountProfileData = {
  contacts: Array<Pick<ContactRecord, 'id' | 'name' | 'title'>>
  opportunities: Array<
    Pick<
      OpportunityRecord,
      | 'id'
      | 'externalKey'
      | 'name'
      | 'productLine'
      | 'productModel'
      | 'stage'
      | 'amount'
      | 'currencyCode'
      | 'updatedAt'
      | 'createdAt'
      | 'isSeed'
    >
  >
}

async function loadProfileData(account: AccountRecord): Promise<AccountProfileData> {
  const [contacts, opportunities] = await Promise.all([
    repository.getContactsForAccount(account.id),
    repository.getOpportunitiesForAccount(account.id),
  ])
  return { contacts, opportunities }
}

function profileFacts(account: AccountRecord, profileData: AccountProfileData) {
  const { opportunities: opps, contacts } = profileData
  const sources: SourceRef[] = [
    {
      kind: 'dataverse',
      label: `${account.name} · Account`,
      ref: account.externalKey,
      entity: 'crmai_account',
      id: account.id,
    },
    ...opps.slice(0, 4).map((opportunity) => ({
      kind: 'dataverse' as const,
      label: `${opportunity.name} · ${opportunity.stage}`,
      ref: opportunity.externalKey || opportunity.id,
      entity: 'crmai_opportunity',
      id: opportunity.id,
    })),
  ]

  const facts = {
    name: account.name,
    creditLevel: account.creditLevel,
    hasMsa: account.hasMsa,
    visitCount30d: account.visitCount30d,
    npsDelta: account.npsDelta,
    lastVisitAt: account.lastVisitAt,
    contacts: contacts.map((c) => ({ name: c.name, title: c.title })),
    opportunities: opps.map((o) => ({
      name: o.name,
      productLine: o.productLine,
      productModel: o.productModel,
      stage: o.stage,
      amount: o.amount,
      currencyCode: o.currencyCode,
    })),
  }

  const dataAsOf = latestDataAt(account, opps)
  const staleDays = account.lastVisitAt && !Number.isNaN(new Date(account.lastVisitAt).getTime())
    ? Math.max(0, Math.floor((Date.now() - new Date(account.lastVisitAt).getTime()) / 86_400_000))
    : undefined

  return {
    facts,
    unverifiedNotes: account.notes,
    meta: { dataAsOf, staleDays },
    sources,
    opps,
    contacts,
  }
}

function detectProfileFocus(utterance?: string) {
  const t = utterance || ''
  if (/信用|评级|MSA|msa|框架协议/.test(t)) return 'credit' as const
  if (/商机|机会|pipeline|阶段|定标/.test(t)) return 'opportunities' as const
  if (/联系人|主任|谁负责|对接/.test(t)) return 'contacts' as const
  if (/拜访|近访|上次|最近|NPS|nps/.test(t)) return 'visits' as const
  return 'overview' as const
}

function creditTone(level: string): MessageUiMetricTone {
  const l = level.toUpperCase()
  if (l.startsWith('A')) return 'good'
  if (l.startsWith('B')) return 'accent'
  if (l.startsWith('C') || l.startsWith('D')) return 'warn'
  return 'neutral'
}

function npsTone(nps?: string): MessageUiMetricTone {
  if (!nps) return 'neutral'
  const n = Number.parseFloat(nps.replace(/[^\d.+-]/g, ''))
  if (!Number.isFinite(n)) return 'neutral'
  if (n > 0) return 'good'
  if (n < 0) return 'warn'
  return 'neutral'
}

const STAGE_LABEL: Record<string, string> = {
  Identify: '识别阶段',
  Qualify: '资格确认',
  Propose: '方案报价',
  Negotiate: '谈判',
  Closed: '成交',
}

function stageLabel(stage: string) {
  return STAGE_LABEL[stage] || stage || '阶段待确认'
}

function formatMoney(amount: number, currencyCode: string) {
  const code = currencyCode || 'USD'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${code} ${amount.toLocaleString('en-US')}`
  }
}

function formatDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function latestDataAt(account: AccountRecord, opps: AccountProfileData['opportunities']) {
  const candidates = [
    account.lastVisitAt,
    ...opps.map((o) => o.updatedAt || o.createdAt),
  ].filter(Boolean) as string[]
  if (!candidates.length) return new Date().toISOString()
  return candidates.sort((a, b) => b.localeCompare(a))[0]
}

function isStaleVisitWindow(lastVisitAt?: string) {
  if (!lastVisitAt) return true
  const t = new Date(lastVisitAt).getTime()
  if (Number.isNaN(t)) return true
  const days = (Date.now() - t) / (24 * 60 * 60 * 1000)
  return days > 30
}

function normalizeSuggestion(raw?: string) {
  const text = (raw || '').trim()
  if (!text) return undefined
  if (/^AI\s*建议/.test(text)) return text
  return `AI 建议，待核实：${text}`
}

function openPipelineAmount(opps: AccountProfileData['opportunities']) {
  if (!opps.length) return null
  const currency = opps[0]?.currencyCode || 'USD'
  const total = opps.reduce((sum, o) => sum + (Number.isFinite(o.amount) ? o.amount : 0), 0)
  return { total, currency }
}

function buildAccountPulseUi(
  account: AccountRecord,
  profileData: AccountProfileData,
  suggestion?: string,
): MessageUiBlock {
  const contact = profileData.contacts[0]
  const opps = profileData.opportunities
  const pipeline = openPipelineAmount(opps)
  const lastVisit = formatDate(account.lastVisitAt)
  const dataAt = formatDate(latestDataAt(account, opps))
  const visitStale = isStaleVisitWindow(account.lastVisitAt)
  const seedish = opps.some((o) => o.isSeed) || visitStale

  const primary: MessageUiMetric[] = [
    {
      label: '信用',
      value: account.creditLevel || '—',
      tone: creditTone(account.creditLevel || ''),
      priority: 'primary',
    },
    {
      label: pipeline ? '开放商机金额' : '开放商机',
      value: pipeline ? formatMoney(pipeline.total, pipeline.currency) : '0',
      tone: pipeline && pipeline.total > 0 ? 'accent' : 'neutral',
      priority: 'primary',
    },
  ]

  const secondary: MessageUiMetric[] = [
    {
      label: lastVisit ? `近 30 天拜访（截至 ${lastVisit}）` : '近 30 天拜访',
      value: String(account.visitCount30d ?? 0),
      tone: (account.visitCount30d ?? 0) >= 3 ? 'good' : 'neutral',
      priority: 'secondary',
    },
    ...(account.npsDelta
      ? [
          {
            label: 'NPS 变化',
            value: account.npsDelta,
            tone: npsTone(account.npsDelta),
            priority: 'secondary' as const,
          },
        ]
      : []),
    {
      label: '框架协议',
      value: account.hasMsa ? '已签' : '未签',
      tone: account.hasMsa ? 'good' : 'warn',
      priority: 'secondary',
    },
  ]

  const items: MessageUiItem[] = [
    ...opps.slice(0, 3).map((o) => {
      const product = [o.productLine, o.productModel].filter(Boolean).join(' ') || o.name
      const money =
        Number.isFinite(o.amount) && o.amount > 0
          ? `${formatMoney(o.amount, o.currencyCode || 'USD')}（预估金额）`
          : '金额待确认'
      return {
        title: product,
        subtitle: `${o.name} · ${money}`,
        badge: stageLabel(o.stage),
        kind: 'opportunity' as const,
      }
    }),
    ...(contact
      ? [
          {
            title: contact.name,
            subtitle: contact.title || '主要对接人',
            badge: '联系人',
            kind: 'contact' as const,
          },
        ]
      : []),
  ]

  const footnoteParts = [
    dataAt ? `数据更新于 ${dataAt}` : null,
    visitStale && lastVisit ? `最近拜访 ${lastVisit}（已超过 30 天，数据可能过期）` : null,
    seedish ? '种子演示数据，请核实是否为最新 CRM 状态' : '请以 CRM 实时数据为准',
  ].filter(Boolean)

  return {
    type: 'account_pulse',
    title: account.name,
    metrics: [...primary, ...secondary],
    items: items.length ? items : undefined,
    actions: [
      {
        id: 'open_account',
        label: '查看客户画像',
      },
    ],
    accountKey: account.externalKey || account.id,
    originLabel: 'CRM 数据',
    footnote: footnoteParts.join(' · '),
    hint: normalizeSuggestion(suggestion),
  }
}

function shortProfileSummary(
  account: AccountRecord,
  focus: ReturnType<typeof detectProfileFocus>,
  opps: AccountProfileData['opportunities'],
) {
  const credit = `信用 ${account.creditLevel || '—'}`
  const msa = account.hasMsa ? '框架协议已签' : '框架协议未签'
  const lastVisit = formatDate(account.lastVisitAt)
  const visits = isStaleVisitWindow(account.lastVisitAt) && lastVisit
    ? `最近一次拜访 ${lastVisit}（已超过 30 天，数据可能过期）`
    : lastVisit
      ? `近 30 天 ${account.visitCount30d ?? 0} 次拜访（最近 ${lastVisit}）`
      : `近 30 天 ${account.visitCount30d ?? 0} 次拜访`
  const pipeline = openPipelineAmount(opps)
  const oppLine = pipeline
    ? `开放商机 ${opps.length} 个，合计 ${formatMoney(pipeline.total, pipeline.currency)}`
    : '当前无开放商机'

  if (focus === 'credit') return `${account.name}：${credit}，${msa}。`
  if (focus === 'opportunities') return `${account.name}：${oppLine}，${credit}。`
  if (focus === 'contacts') return `${account.name}：对接信息如下，${credit}。`
  if (focus === 'visits') {
    return `${account.name}：${visits}${account.npsDelta ? `，NPS ${account.npsDelta}` : ''}。`
  }
  return `${account.name}：${credit}，${msa}；${visits}；${oppLine}。`
}

function defaultSuggestion(
  account: AccountRecord,
  opps: AccountProfileData['opportunities'],
  focus: ReturnType<typeof detectProfileFocus>,
) {
  // Only emit a cautious next-step when the facts themselves suggest an open Identify opp.
  if (focus !== 'opportunities' && focus !== 'overview') return undefined
  const identify = opps.find((o) => o.stage === 'Identify')
  if (!identify) return undefined
  const product = [identify.productLine, identify.productModel].filter(Boolean).join(' ')
  return normalizeSuggestion(
    `可核对「${product || identify.name}」需求确认与采购窗口；当前仅为识别阶段，信用 ${account.creditLevel || '—'} 不代表可立即推进。`,
  )
}

/** Sync heuristic — also used as DeepSeek fallback. Varies by question focus. */
export async function buildAccountProfileMessage(
  account: AccountRecord,
  utterance?: string,
  profileData?: AccountProfileData,
  suggestion?: string,
): Promise<AgentMessage> {
  const data = profileData ?? (await loadProfileData(account))
  const { sources, opps } = profileFacts(account, data)
  const focus = detectProfileFocus(utterance)
  const hint = normalizeSuggestion(suggestion) || defaultSuggestion(account, opps, focus)
  const ui = buildAccountPulseUi(account, data, hint)
  ui.unverifiedNotes = account.notes
  const content = shortProfileSummary(account, focus, opps)
  const completeness = [
    account.creditLevel,
    account.lastVisitAt,
    data.contacts.length > 0,
    opps.length > 0,
  ].filter(Boolean).length
  const confidence = Math.max(0.45, Math.min(0.95, 0.5 + completeness * 0.11))

  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: 'assistant',
    agent_id: 'AccountProfile',
    agent_name: '客户画像 Agent',
    content,
    sources,
    // Query replies are answer confidence, not extraction confidence.
    confidence,
    confidence_kind: 'answer',
    agent_chain: ['客户画像 Agent'],
    createdAt: new Date().toISOString(),
    ui,
  }
}

/** DeepSeek 摘要合成；无 Key / 失败时回落启发式。 */
export async function synthesizeAccountProfile(
  account: AccountRecord,
  utterance?: string,
  profileData?: AccountProfileData,
): Promise<{ message: AgentMessage; mode: 'deepseek' | 'heuristic' }> {
  const data = profileData ?? (await loadProfileData(account))
  const fallback = await buildAccountProfileMessage(account, utterance, data)
  if (!hasDeepSeek()) return { message: fallback, mode: 'heuristic' }

  const { facts, sources, unverifiedNotes, meta } = profileFacts(account, data)
  try {
    const { data: output, mode } = await chatStructured({
      system: ACCOUNT_PROFILE_SYSTEM,
      user: JSON.stringify({
        question: utterance || '客户最近怎么样？',
        focusHint: detectProfileFocus(utterance),
        facts,
        unverifiedNotes,
        meta,
        instruction:
          'summary 只写已确认事实；unverifiedNotes 只放备注/推测；suggestion 为空或以「AI 建议，待核实：」开头；禁止写出赢单率/confidenceScore。',
      }),
      temperature: 0.3,
      maxTokens: 520,
      schema: accountProfileOutputSchema,
    })
    if (!output.summary.trim()) return { message: fallback, mode: 'heuristic' }
    const hint = normalizeSuggestion(output.suggestion) || fallback.ui?.hint
    return {
      mode,
      message: {
        ...fallback,
        content: output.summary.trim(),
        confidence: Math.max(0.3, Math.min(1, output.confidence ?? fallback.confidence)),
        sources,
        ui: fallback.ui
          ? {
              ...fallback.ui,
              hint,
              unverifiedNotes: output.unverifiedNotes || unverifiedNotes,
            }
          : fallback.ui,
      },
    }
  } catch {
    return { message: fallback, mode: 'heuristic' }
  }
}

/** Model-selected, read-only account lookup followed by schema-validated synthesis. */
export async function queryAccountProfileWithTools(
  utterance: string,
  knownAccountId?: string,
): Promise<{ account: AccountRecord; message: AgentMessage; mode: 'deepseek' }> {
  const { finalText, toolResults } = await chatWithTools({
    system: `${ACCOUNT_PROFILE_SYSTEM}\n\n${ACCOUNT_PROFILE_TOOL_ADDENDUM}`,
    user: JSON.stringify({
      question: utterance,
      knownAccountId,
      now: nowIsoInZone(),
      timezone: 'Asia/Shanghai',
    }),
    tools: accountQueryTools,
    temperature: 0.2,
    maxTokens: 520,
    maxToolRounds: 3,
  })

  const rawProfile = toolResults.find((item) => item.name === 'get_account_profile')?.result
  const profile = accountProfileToolResultSchema.parse(rawProfile)
  const account = profile.account
  const profileData: AccountProfileData = {
    contacts: profile.contacts,
    opportunities: profile.opportunities,
  }
  const output = parseStructuredJson(finalText, accountProfileOutputSchema)
  const fallback = await buildAccountProfileMessage(
    account,
    utterance,
    profileData,
    output.suggestion,
  )
  return {
    account,
    mode: 'deepseek',
    message: {
      ...fallback,
      content: output.summary?.trim() || fallback.content,
      confidence: Math.max(0.3, Math.min(1, output.confidence ?? fallback.confidence)),
      ui: fallback.ui
        ? {
            ...fallback.ui,
            hint: normalizeSuggestion(output.suggestion) || fallback.ui.hint,
            unverifiedNotes: output.unverifiedNotes || fallback.ui.unverifiedNotes,
          }
        : fallback.ui,
    },
  }
}
