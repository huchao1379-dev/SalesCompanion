import type { AgentMessage } from '../types.js'
import type { DomainAgent } from './agentTypes.js'
import { extractVisit } from './extract.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export const entityExtractAgent: DomainAgent = {
  name: 'EntityExtract',
  displayName: '实体抽取',
  description: '口语拜访描述 → 结构化客户/联系人/产品/数量字段',
  async run(ctx) {
    const { extracted, mode } = await extractVisit(ctx.utterance)

    if (!extracted.accountName && extracted.confidence < 0.6) {
      const missing: string[] = ['客户名称']
      if (!extracted.contactName) missing.push('联系人')
      if (!extracted.productLine && !extracted.productModel) missing.push('产品')
      if (!extracted.quantity) missing.push('数量')
      const msg: AgentMessage = {
        id: uid('msg'),
        role: 'assistant',
        agent_name: '实体抽取',
        content: `信息还不够生成草稿，目前缺：${missing.join('、')}。例如可以说「刚拜访上海仁济医院张主任，他们对 N17 监护仪感兴趣，大概 8 台，下周三再约」。`,
        sources: [{ kind: 'other', label: '实体抽取', ref: 'extract' }],
        confidence: extracted.confidence,
        agent_chain: ['EntityExtract'],
        createdAt: new Date().toISOString(),
      }
      return { messages: [msg], statePatch: { extracted }, halt: true, mode }
    }

    return { statePatch: { extracted }, mode }
  },
}
