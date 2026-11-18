import type { DomainAgent } from './agentTypes.js'
import { createOpportunityDraft } from './opportunityCreate.js'
import * as tools from '../tools/dataverseTools.js'

export const opportunityCreateAgent: DomainAgent = {
  name: 'OpportunityCreate',
  displayName: '商机创建 Agent',
  description: '生成/关联商机草稿，并附带简易督导提示（重复检测）',
  async run(ctx) {
    if (!ctx.state.extracted || !ctx.state.activity) {
      return {
        messages: [
          {
            id: `msg_${Math.random().toString(36).slice(2, 10)}`,
            role: 'assistant',
            agent_name: '商机创建 Agent',
            content: '缺少活动草稿，无法生成商机。',
            sources: [],
            confidence: 0.3,
            createdAt: new Date().toISOString(),
          },
        ],
        halt: true,
      }
    }

    const opportunity = createOpportunityDraft({
      extracted: ctx.state.extracted,
      account: ctx.state.account,
      existing: ctx.state.existingOpportunity,
      activity: ctx.state.activity,
      sessionKey: ctx.sessionKey,
    })
    await tools.upsertOpportunityDraft(opportunity)

    return {
      drafts: [opportunity],
      statePatch: { opportunity },
      messages: [
        {
          id: `msg_${Math.random().toString(36).slice(2, 10)}`,
          role: 'assistant',
          agent_name: opportunity.agentName,
          content: opportunity.reuseExisting
            ? `建议追加既有商机 ${opportunity.existingOpportunityRef}，不新建。`
            : '已生成新商机草稿。',
          sources: opportunity.sources,
          confidence: opportunity.confidence,
          draft: opportunity,
          createdAt: opportunity.createdAt,
        },
      ],
    }
  },
}
