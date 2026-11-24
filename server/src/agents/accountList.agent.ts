/**
 * Account list — answers “我的客户有哪些” by listing Dataverse accounts,
 * not by resolving the utterance as a customer name.
 */
import type { DomainAgent } from './agentTypes.js'
import * as tools from '../tools/dataverseTools.js'
import type { AgentMessage, MessageUiBlock } from '../types.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export const accountListAgent: DomainAgent = {
  name: 'AccountList',
  displayName: '客户列表 Agent',
  description: '列出当前种子库中的客户及数量',
  intents: ['list_accounts'],
  async run() {
    const accounts = await tools.listAccounts()
    const count = accounts.length
    const items = accounts.map((account) => ({
      title: account.name,
      subtitle: [
        account.region,
        account.creditLevel ? `信用 ${account.creditLevel}` : null,
        typeof account.visitCount30d === 'number' ? `近30天 ${account.visitCount30d} 次拜访` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      badge: account.externalKey,
      kind: 'other' as const,
    }))

    const examples = accounts.slice(0, 3).map((account) => `${account.name}最近怎么样？`)
    if (examples.length === 0) {
      examples.push('仁济医院最近怎么样？')
    }

    const content =
      count === 0
        ? '当前种子库里还没有客户。请先加载演示种子，或换环境后再问。'
        : `当前种子库共有 ${count} 家客户：${accounts.map((a) => a.name).join('、')}。点下面任意一家可继续看画像或商机。`

    const ui: MessageUiBlock = {
      type: 'opportunity_list',
      title: '我的客户',
      originLabel: 'CRM 种子',
      metrics: [
        { label: '客户数', value: String(count), tone: count ? 'accent' : 'warn', priority: 'primary' },
      ],
      items,
      followUps: examples,
      examples,
      footnote: '列表来自 Demo 种子内存库，不是 SAP 全量客户。',
      tone: count ? 'info' : 'warn',
    }

    const message: AgentMessage = {
      id: uid('msg'),
      role: 'assistant',
      agent_id: 'AccountList',
      agent_name: '客户列表 Agent',
      content,
      sources: accounts.length
        ? accounts.slice(0, 5).map((account) => ({
            kind: 'dataverse' as const,
            label: account.name,
            ref: account.externalKey || account.id,
            entity: 'account',
            id: account.id,
          }))
        : [{ kind: 'other', label: '无来源', ref: 'none' }],
      confidence: count ? 0.95 : 0.5,
      confidence_kind: 'answer',
      agent_chain: ['AccountList'],
      createdAt: new Date().toISOString(),
      ui,
    }

    return {
      mode: 'heuristic' as const,
      messages: [message],
    }
  },
}
