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
      const msg: AgentMessage = {
        id: uid('msg'),
        role: 'assistant',
        agent_name: 'Orchestrator',
        content:
          '置信度偏低：请补充客户名称（例如上海仁济医院），以及联系人/产品/数量，以便生成草稿。',
        sources: [{ kind: 'other', label: '实体抽取', ref: 'extract' }],
        confidence: extracted.confidence,
        agent_chain: ['Orchestrator', 'EntityExtract'],
        createdAt: new Date().toISOString(),
      }
      return { messages: [msg], statePatch: { extracted }, halt: true, mode }
    }

    return { statePatch: { extracted }, mode }
  },
}
