import type { AgentMessage } from '../types.js'
import type { DomainAgent } from './agentTypes.js'
import { extractVisit } from './extract.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export const entityExtractAgent: DomainAgent = {
  name: 'EntityExtract',
  displayName: '实体抽取',
  description: '口语拜访描述 → 结构化客户/联系人/产品/数量/日期字段',
  async run(ctx) {
    const { extracted, mode } = await extractVisit(ctx.utterance, {
      history: ctx.history,
      knownAccounts: ctx.knownAccounts,
    })

    if (!extracted.accountName && !ctx.memory.accountId && extracted.confidence < 0.82) {
      const missing: string[] = ['客户名称']
      if (!extracted.contactName) missing.push('联系人')
      if (!extracted.productLine && !extracted.productModel) missing.push('产品')
      if (!extracted.quantity) missing.push('数量')
      const msg: AgentMessage = {
        id: uid('msg'),
        role: 'assistant',
        agent_id: 'EntityExtract',
        agent_name: '实体抽取',
        content: `信息还不够生成草稿，目前缺：${missing.join('、')}。例如可以说「刚拜访上海仁济医院张主任，他们对 N17 监护仪感兴趣，大概 8 台，下周三再约」。`,
        sources: [{ kind: 'other', label: '实体抽取', ref: 'extract' }],
        confidence: extracted.confidence,
        confidence_kind: 'extraction',
        agent_chain: ['EntityExtract'],
        createdAt: new Date().toISOString(),
        ui: {
          type: 'clarify',
          title: '还缺关键信息',
          question: `请补充：${missing.join('、')}`,
          examples: [
            '刚拜访上海仁济医院张主任，N17 监护仪 8 台，下周三再约',
            '仁济医院张主任对监护仪感兴趣',
          ],
          tone: 'warn',
        },
      }
      return { messages: [msg], statePatch: { extracted }, halt: true, mode }
    }

    return { statePatch: { extracted }, mode }
  },
}
