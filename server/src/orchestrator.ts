import { config, hasDeepSeek } from './config.js'
import { classifyIntent } from './agents/intent.js'
import { extractVisit } from './agents/extract.js'
import { buildAccountProfileMessage, resolveAccount } from './agents/accountProfile.js'
import { createActivityDraft } from './agents/activityCreate.js'
import { createOpportunityDraft } from './agents/opportunityCreate.js'
import { queryOrderLogistics } from './agents/orderQuery.js'
import { store } from './store/dataverseStore.js'
import type {
  AgentMessage,
  DraftPayload,
  OrchestratorRequest,
  OrchestratorResponse,
} from './types.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export async function orchestrate(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  const t0 = performance.now()
  const utterance = req.utterance.trim()
  const sessionKey = req.context?.conversationId || req.context?.sessionKey
  const modes = new Set<'deepseek' | 'heuristic'>()

  const intentResult = await classifyIntent(utterance)
  modes.add(intentResult.mode)
  let intent = intentResult.intent

  // If context already has account and user asks progress-like short text
  if (intent === 'clarify' && req.context?.accountId) {
    intent = 'query_account'
  }

  let messages: AgentMessage[] = []
  let drafts: DraftPayload[] = []
  let context: Record<string, string> = { ...(req.context || {}) }

  if (intent === 'clarify') {
    messages = [
      {
        id: uid('msg'),
        role: 'assistant',
        agent_name: 'Orchestrator',
        content:
          '我可以帮你：① 录入拜访（说客户/联系人/产品/数量）② 查询客户画像 ③ 查询订单物流。请补充一句完整需求。',
        sources: [],
        confidence: 0.55,
        agent_chain: ['Orchestrator'],
        createdAt: new Date().toISOString(),
      },
    ]
  } else if (intent === 'query_account') {
    const account =
      resolveAccount(utterance) ||
      (context.accountId ? store.getAccount(context.accountId) : undefined) ||
      (context.accountName ? store.getAccount(context.accountName) : undefined)

    if (!account) {
      messages = [
        {
          id: uid('msg'),
          role: 'assistant',
          agent_name: 'Orchestrator',
          content: '未匹配到客户种子。可试「仁济医院最近怎么样？」或「Hospital Alpha 最新进度？」',
          sources: [],
          confidence: 0.45,
          agent_chain: ['Orchestrator', '客户画像 Agent'],
          createdAt: new Date().toISOString(),
        },
      ]
    } else {
      const profile = buildAccountProfileMessage(account)
      const composite: AgentMessage = {
        id: uid('msg'),
        role: 'assistant',
        agent_name: 'Orchestrator',
        content: profile.content,
        sources: profile.sources,
        confidence: profile.confidence,
        agent_chain: ['Orchestrator', '客户画像 Agent', '商机评估 Agent'],
        createdAt: new Date().toISOString(),
      }
      messages = [composite, profile]
      context = {
        ...context,
        accountId: account.id,
        accountName: account.name,
        accountRef: account.externalKey,
      }
    }
  } else if (intent === 'query_order') {
    const orderMsg = queryOrderLogistics(utterance)
    const account =
      resolveAccount(utterance) ||
      (context.accountId ? store.getAccount(context.accountId) : undefined)
    if (account) {
      context = {
        ...context,
        accountId: account.id,
        accountName: account.name,
        accountRef: account.externalKey,
      }
    }
    messages = [
      {
        id: uid('msg'),
        role: 'assistant',
        agent_name: 'Orchestrator',
        content: orderMsg.content,
        sources: orderMsg.sources,
        confidence: orderMsg.confidence,
        agent_chain: orderMsg.agent_chain,
        createdAt: new Date().toISOString(),
      },
      orderMsg,
    ]
  } else {
    // capture_visit — sequential pipeline
    const { extracted, mode: extractMode } = await extractVisit(utterance)
    modes.add(extractMode)

    if (!extracted.accountName && extracted.confidence < 0.6) {
      messages = [
        {
          id: uid('msg'),
          role: 'assistant',
          agent_name: 'Orchestrator',
          content:
            '置信度偏低：请补充客户名称（例如上海仁济医院），以及联系人/产品/数量，以便生成草稿。',
          sources: [{ kind: 'other', label: '实体抽取', ref: 'extract' }],
          confidence: extracted.confidence,
          agent_chain: ['Orchestrator', 'EntityExtract'],
          createdAt: new Date().toISOString(),
        },
      ]
    } else {
      const account =
        (extracted.accountName && resolveAccount(extracted.accountName)) ||
        resolveAccount(utterance) ||
        (context.accountId ? store.getAccount(context.accountId) : undefined)

      const contact = account
        ? store
            .getContactsForAccount(account.id)
            .find((c) =>
              extracted.contactName ? c.name.includes(extracted.contactName) || extracted.contactName.includes(c.name) : true,
            ) || store.getContactsForAccount(account.id)[0]
        : undefined

      const productHint = [extracted.productModel, extracted.productLine].filter(Boolean).join(' ')
      const existing = account
        ? store.findMatchingOpportunity(account.id, productHint || extracted.productModel)
        : undefined

      const activity = createActivityDraft({
        utterance,
        extracted,
        account,
        contact,
        sessionKey,
      })
      store.upsertActivity(activity)

      const opportunity = createOpportunityDraft({
        extracted,
        account,
        existing,
        activity,
        sessionKey,
      })
      store.upsertOpportunityDraft(opportunity)
      drafts = [activity, opportunity]

      if (account) {
        context = {
          ...context,
          accountId: account.id,
          accountName: account.name,
          accountRef: account.externalKey,
        }
        if (existing?.externalKey) context.opportunityId = existing.externalKey
      }

      const chain = [
        'EntityExtract',
        '客户画像 Agent',
        '活动创建 Agent',
        '商机创建 Agent',
        '商机督导 Agent',
      ]

      const composite: AgentMessage = {
        id: uid('msg'),
        role: 'assistant',
        agent_name: 'Orchestrator',
        content: account
          ? `已识别「活动录入 + 商机线索」。${account.name}（信用 ${account.creditLevel} / 近 30 天 ${account.visitCount30d} 次拜访）。已生成活动草稿；${
              opportunity.reuseExisting
                ? `商机侧建议追加既有 ${opportunity.existingOpportunityRef}`
                : '已生成新商机草稿'
            }。请确认或编辑后提交。`
          : '已根据口述生成草稿，但客户未命中种子库，请编辑客户名称后确认。',
        sources: activity.sources,
        confidence: Math.min(activity.confidence, opportunity.confidence),
        agent_chain: chain,
        createdAt: new Date().toISOString(),
      }

      messages = [
        composite,
        {
          id: uid('msg'),
          role: 'assistant',
          agent_name: activity.agentName,
          content: activity.summary,
          sources: activity.sources,
          confidence: activity.confidence,
          draft: activity,
          createdAt: activity.createdAt,
        },
        {
          id: uid('msg'),
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
      ]
    }
  }

  const latencyMs = Math.round(performance.now() - t0)
  const mode = modes.has('deepseek') ? 'deepseek' : 'heuristic'

  store.writeLog({
    sessionId: sessionKey,
    agentName: 'Orchestrator',
    inputSummary: utterance.slice(0, 500),
    outputEnvelope: JSON.stringify({ intent, drafts: drafts.length, messages: messages.length }),
    latencyMs,
    success: true,
    confidence: messages[0]?.confidence,
    promptVersion: config.promptVersion,
    modelName: hasDeepSeek() ? config.deepseekModel : 'heuristic',
  })

  if (sessionKey) {
    const prev = store.getConversation(sessionKey)
    const prevMessages = prev ? (JSON.parse(prev.messagesJson) as unknown[]) : []
    store.saveConversation(sessionKey, context, [
      ...prevMessages,
      { role: 'user', content: utterance },
      ...messages,
    ])
  }

  return {
    messages,
    drafts,
    context,
    latencyMs,
    intent,
    mode,
  }
}
