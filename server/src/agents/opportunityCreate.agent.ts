import type { DomainAgent } from './agentTypes.js'
import { createOpportunityDraft } from './opportunityCreate.js'
import { draftIdempotencyKey } from './draftKeys.js'
import * as tools from '../tools/dataverseTools.js'

export const opportunityCreateAgent: DomainAgent = {
  name: 'OpportunityCreate',
  displayName: '商机创建 Agent',
  description: '生成/关联商机草稿，并交给督导 Agent 做重复与阶段校验',
  async run(ctx) {
    if (!ctx.state.extracted || !ctx.state.activity) {
      return {
        messages: [
          {
            id: `msg_${Math.random().toString(36).slice(2, 10)}`,
            role: 'assistant' as const,
            agent_id: 'OpportunityCreate',
            agent_name: '商机创建 Agent',
            content: '缺少活动草稿，无法生成商机。',
            sources: [],
            confidence: 0.3,
            confidence_kind: 'extraction' as const,
            createdAt: new Date().toISOString(),
          },
        ],
        halt: true,
      }
    }

    const opportunity = await tools.upsertOpportunityDraft(
      createOpportunityDraft({
        extracted: ctx.state.extracted,
        account: ctx.state.account,
        existing: ctx.state.existingOpportunity,
        activity: ctx.state.activity,
        sessionKey: ctx.sessionKey,
        idempotencyKey: draftIdempotencyKey('opportunity', ctx),
      }),
    )

    return {
      drafts: [opportunity],
      statePatch: { opportunity },
      messages: [
        {
          id: `msg_${Math.random().toString(36).slice(2, 10)}`,
          role: 'assistant',
          agent_id: 'OpportunityCreate',
          agent_name: opportunity.agentName,
          content: opportunity.reuseExisting
            ? `建议追加既有商机 ${opportunity.existingOpportunityRef}，不新建。`
            : '已生成新商机草稿。',
          sources: opportunity.sources,
          confidence: opportunity.confidence,
          confidence_kind: 'extraction',
          draft: opportunity,
          createdAt: opportunity.createdAt,
        },
      ],
    }
  },
}
