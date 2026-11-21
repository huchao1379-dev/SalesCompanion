/**
 * Opportunity pulse — fan-out partner for AccountProfile on query_account.
 * Resolves the account independently and emits an opportunity-focused card.
 */
import type { DomainAgent } from './agentTypes.js'
import { resolveAccount } from './accountProfile.js'
import * as tools from '../tools/dataverseTools.js'
import type { AgentMessage, MessageUiBlock } from '../types.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${currency || 'USD'} ${amount}`
  }
}

export const opportunityPulseAgent: DomainAgent = {
  name: 'OpportunityPulse',
  displayName: '商机速览 Agent',
  description: '并行汇总客户开放商机（fan-out）',
  intents: ['query_account'],
  async run(ctx) {
    const account =
      (await resolveAccount(ctx.utterance)) ||
      (ctx.memory.accountId ? await tools.getAccount(ctx.memory.accountId) : undefined) ||
      (ctx.memory.accountName ? await tools.getAccount(ctx.memory.accountName) : undefined)

    if (!account) {
      return { mode: 'heuristic' as const }
    }

    const opps = (await tools.getOpportunitiesForAccount(account.id)).filter(
      (o) => o.stage !== 'Closed',
    )
    const total = opps.reduce((sum, o) => sum + (o.amount || 0), 0)
    const currency = opps[0]?.currencyCode || 'USD'

    const items = opps.slice(0, 5).map((o) => ({
      title: o.name,
      subtitle: `${o.productLine}${o.productModel ? ` · ${o.productModel}` : ''} · ${money(o.amount, o.currencyCode)}`,
      badge: o.stage,
      kind: 'opportunity' as const,
    }))

    const followUps = [
      `${account.name}的信用和近访怎么样？`,
      opps[0] ? `查一下${account.name}上个订单的物流` : `帮我写一封给${account.name}的跟进邮件`,
      `刚拜访完${account.name}，帮我生成活动草稿`,
    ]

    const content =
      opps.length === 0
        ? `${account.name} 当前没有开放商机种子。可先录入拜访或新建意向。`
        : `${account.name} 现有 ${opps.length} 条开放商机，合计约 ${money(total, currency)}。重点关注阶段靠前或金额较高的条目，确认后再推进。`

    const ui: MessageUiBlock = {
      type: 'opportunity_list',
      title: '开放商机速览',
      originLabel: 'CRM 种子',
      metrics: [
        { label: '开放商机', value: String(opps.length), tone: opps.length ? 'accent' : 'neutral' },
        {
          label: '合计金额',
          value: opps.length ? money(total, currency) : '—',
          tone: total > 0 ? 'good' : 'neutral',
        },
      ],
      items,
      followUps,
      examples: followUps,
      actions: [{ id: 'open_account', label: '查看客户画像' }],
      accountKey: account.externalKey,
      footnote: '与画像并行查询；金额与阶段来自种子数据，请核实。',
      tone: 'info',
    }

    const message: AgentMessage = {
      id: uid('msg'),
      role: 'assistant',
      agent_id: 'OpportunityPulse',
      agent_name: '商机速览 Agent',
      content,
      sources: [
        {
          kind: 'dataverse',
          entity: 'crmai_opportunity',
          id: account.id,
          label: `${account.name} · 商机`,
          ref: account.externalKey,
        },
      ],
      confidence: opps.length ? 0.86 : 0.7,
      confidence_kind: 'answer',
      agent_chain: ['Orchestrator', '商机速览 Agent'],
      createdAt: new Date().toISOString(),
      ui,
    }

    return {
      messages: [message],
      memoryPatch: {
        accountId: account.id,
        accountName: account.name,
        accountRef: account.externalKey,
      },
      statePatch: { account },
      mode: 'heuristic' as const,
    }
  },
}
