import type { DomainAgent } from './agentTypes.js'
import { createActivityDraft } from './activityCreate.js'
import * as tools from '../tools/dataverseTools.js'

export const activityCreateAgent: DomainAgent = {
  name: 'ActivityCreate',
  displayName: '活动创建 Agent',
  description: '根据抽取结果生成活动/拜访草稿（只写 draft）',
  async run(ctx) {
    if (!ctx.state.extracted) {
      return {
        messages: [
          {
            id: `msg_${Math.random().toString(36).slice(2, 10)}`,
            role: 'assistant',
            agent_name: '活动创建 Agent',
            content: '缺少实体抽取结果，无法生成活动草稿。',
            sources: [],
            confidence: 0.3,
            createdAt: new Date().toISOString(),
          },
        ],
        halt: true,
      }
    }

    const activity = createActivityDraft({
      utterance: ctx.utterance,
      extracted: ctx.state.extracted,
      account: ctx.state.account,
      contact: ctx.state.contact,
      sessionKey: ctx.sessionKey,
    })
    tools.upsertActivityDraft(activity)

    return {
      drafts: [activity],
      statePatch: { activity },
      messages: [
        {
          id: `msg_${Math.random().toString(36).slice(2, 10)}`,
          role: 'assistant',
          agent_name: activity.agentName,
          content: activity.summary,
          sources: activity.sources,
          confidence: activity.confidence,
          draft: activity,
          createdAt: activity.createdAt,
        },
      ],
    }
  },
}
