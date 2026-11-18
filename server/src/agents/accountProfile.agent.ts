import type { DomainAgent } from './agentTypes.js'
import {
  queryAccountProfileWithTools,
  resolveAccount,
  synthesizeAccountProfile,
} from './accountProfile.js'
import { hasDeepSeek } from '../llm/deepseek.js'
import * as tools from '../tools/dataverseTools.js'
import type { AgentMessage } from '../types.js'

/**
 * - query_account: emit profile Envelope
 * - capture_visit (after extract): resolve account/contact into state only
 */
export const accountProfileAgent: DomainAgent = {
  name: 'AccountProfile',
  displayName: '客户画像 Agent',
  description: '校验客户存在性，汇总信用/近访/开放商机',
  intents: ['query_account'],
  async run(ctx) {
    const fromExtract = ctx.state.extracted?.accountName
    let account = fromExtract ? await resolveAccount(fromExtract) : undefined
    let toolMessage: AgentMessage | undefined
    let mode: 'deepseek' | 'heuristic' | undefined

    if (!ctx.state.extracted && hasDeepSeek()) {
      try {
        const result = await queryAccountProfileWithTools(ctx.utterance, ctx.memory.accountId)
        account = result.account
        toolMessage = result.message
        mode = result.mode
      } catch {
        // Fall back to the deterministic repository path if tool selection or output fails.
      }
    }

    account = account ||
      await resolveAccount(ctx.utterance) ||
      (ctx.memory.accountId ? await tools.getAccount(ctx.memory.accountId) : undefined) ||
      (ctx.memory.accountName ? await tools.getAccount(ctx.memory.accountName) : undefined)

    if (!account) {
      if (ctx.state.extracted) {
        // Visit pipeline can continue without a seed hit (user edits later).
        return {}
      }
      const hint = ctx.utterance.trim().slice(0, 24)
      return {
        messages: [
          {
            id: `msg_${Math.random().toString(36).slice(2, 10)}`,
            role: 'assistant',
            agent_name: '客户画像 Agent',
            content: hint
              ? `没在种子库里匹配到与「${hint}${ctx.utterance.trim().length > 24 ? '…' : ''}」对应的客户。可以改用完整医院名再试，例如「仁济医院最近怎么样？」或「Hospital Alpha 最新进度？」。`
              : '未匹配到客户种子。可试「仁济医院最近怎么样？」或「Hospital Alpha 最新进度？」',
            sources: [],
            confidence: 0.45,
            agent_chain: ['客户画像 Agent'],
            createdAt: new Date().toISOString(),
          },
        ],
        halt: true,
      }
    }

    const contacts = await tools.getContactsForAccount(account.id)
    const contact = contacts.find((c) =>
      ctx.state.extracted?.contactName
        ? c.name.includes(ctx.state.extracted.contactName) ||
          ctx.state.extracted.contactName.includes(c.name)
        : true,
    ) || contacts[0]

    const productHint = [
      ctx.state.extracted?.productModel,
      ctx.state.extracted?.productLine,
    ]
      .filter(Boolean)
      .join(' ')
    const existingOpportunity = await tools.findMatchingOpportunity(
      account.id,
      productHint || ctx.state.extracted?.productModel,
    )

    const memoryPatch = {
      accountId: account.id,
      accountName: account.name,
      accountRef: account.externalKey,
      ...(existingOpportunity?.externalKey
        ? { opportunityId: existingOpportunity.externalKey }
        : {}),
    }

    const statePatch = { account, contact, existingOpportunity }

    // Visit path: resolve only. Query path: emit profile message.
    if (ctx.state.extracted) {
      return { statePatch, memoryPatch }
    }

    const { message: profile, mode: profileMode } = toolMessage
      ? { message: toolMessage, mode }
      : await synthesizeAccountProfile(account, ctx.utterance)
    return {
      messages: [profile],
      statePatch,
      memoryPatch,
      mode: profileMode,
    }
  },
}
