import type { DomainAgent } from './agentTypes.js'
import { resolveAccount } from './accountProfile.js'
import { createActivityDraft } from './activityCreate.js'
import { draftIdempotencyKey } from './draftKeys.js'
import * as tools from '../tools/dataverseTools.js'

/**
 * Visit pipeline no longer calls AccountProfile as a separate hop.
 * Resolve account/contact here from extract + session memory when needed.
 */
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
            role: 'assistant' as const,
            agent_id: 'ActivityCreate',
            agent_name: '活动创建 Agent',
            content: '缺少实体抽取结果，无法生成活动草稿。',
            sources: [],
            confidence: 0.3,
            confidence_kind: 'extraction' as const,
            createdAt: new Date().toISOString(),
          },
        ],
        halt: true,
      }
    }

    let account = ctx.state.account
    let contact = ctx.state.contact

    if (!account) {
      const hint = ctx.state.extracted.accountName || ctx.memory.accountName || ctx.memory.accountId
      account =
        (hint ? await resolveAccount(hint) : undefined) ||
        (ctx.memory.accountId ? await tools.getAccount(ctx.memory.accountId) : undefined) ||
        (ctx.memory.accountRef ? await tools.getAccount(ctx.memory.accountRef) : undefined)
    }

    if (account && !contact) {
      const contacts = await tools.getContactsForAccount(account.id)
      const want = ctx.state.extracted.contactName || ''
      contact =
        contacts.find(
          (item) =>
            want &&
            (item.name.includes(want) || want.includes(item.name)),
        ) || contacts[0]
    }

    const activity = await tools.upsertActivityDraft(
      createActivityDraft({
        utterance: ctx.utterance,
        extracted: ctx.state.extracted,
        account,
        contact,
        sessionKey: ctx.sessionKey,
        idempotencyKey: draftIdempotencyKey('activity', ctx),
      }),
    )

    const memoryPatch: Record<string, string> = {
      lastActivityKey: activity.idempotencyKey,
    }
    if (account) {
      memoryPatch.accountId = account.id
      memoryPatch.accountName = account.name
      memoryPatch.accountRef = account.externalKey
    }

    return {
      drafts: [activity],
      statePatch: { activity, account, contact },
      memoryPatch,
      messages: [
        {
          id: `msg_${Math.random().toString(36).slice(2, 10)}`,
          role: 'assistant',
          agent_id: 'ActivityCreate',
          agent_name: activity.agentName,
          content: activity.summary,
          sources: activity.sources,
          confidence: activity.confidence,
          confidence_kind: 'extraction',
          draft: activity,
          createdAt: activity.createdAt,
        },
      ],
    }
  },
}
