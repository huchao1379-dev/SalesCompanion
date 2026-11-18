import { config, hasDeepSeek } from './config.js'
import { buildClarifyReply } from './agents/clarify.js'
import { classifyIntent } from './agents/intent.js'
import { ensureAgentsRegistered } from './agents/catalog.js'
import { requireAgent } from './agents/registry.js'
import type {
  AgentContext,
  AgentResult,
  PipelineDef,
  PipelineState,
} from './agents/agentTypes.js'
import { repository } from './store/dataverseStore.js'
import type {
  AgentMessage,
  DraftPayload,
  Intent,
  OrchestratorRequest,
  OrchestratorResponse,
} from './types.js'

/**
 * Intent → collaboration mode + agent chain.
 * Add agents in catalog.ts, then list them here (or use intents[] for single-route).
 */
const PIPELINES: Partial<Record<Intent, PipelineDef>> = {
  capture_visit: {
    mode: 'sequential',
    agents: ['EntityExtract', 'AccountProfile', 'ActivityCreate', 'OpportunityCreate'],
  },
  query_account: {
    mode: 'fanout',
    agents: ['AccountProfile'],
  },
  query_order: {
    mode: 'single',
    agents: ['OrderQuery'],
  },
  work_summary: {
    mode: 'single',
    agents: ['WorkSummary'],
  },
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function mergeResult(
  into: { messages: AgentMessage[]; drafts: DraftPayload[] },
  result: AgentResult,
  ctx: AgentContext,
) {
  if (result.messages?.length) into.messages.push(...result.messages)
  if (result.drafts?.length) into.drafts.push(...result.drafts)
  if (result.memoryPatch) Object.assign(ctx.memory, result.memoryPatch)
  if (result.statePatch) Object.assign(ctx.state, result.statePatch)
  if (result.mode) ctx.modes.add(result.mode)
}

async function runSequential(agentNames: string[], ctx: AgentContext) {
  const bag = { messages: [] as AgentMessage[], drafts: [] as DraftPayload[] }
  for (const name of agentNames) {
    const agent = requireAgent(name)
    const result = await agent.run(ctx)
    mergeResult(bag, result, ctx)
    if (result.halt) break
  }
  return bag
}

async function runFanout(agentNames: string[], ctx: AgentContext) {
  const bag = { messages: [] as AgentMessage[], drafts: [] as DraftPayload[] }
  // Parallel: each agent gets a shallow-cloned state/memory view; merge after.
  const results = await Promise.all(
    agentNames.map(async (name) => {
      const agent = requireAgent(name)
      const branchCtx: AgentContext = {
        ...ctx,
        memory: { ...ctx.memory },
        state: { ...ctx.state },
        modes: new Set(ctx.modes),
      }
      const result = await agent.run(branchCtx)
      return { result, branchCtx }
    }),
  )
  for (const { result, branchCtx } of results) {
    mergeResult(bag, result, ctx)
    Object.assign(ctx.memory, branchCtx.memory)
    Object.assign(ctx.state, branchCtx.state)
    for (const m of branchCtx.modes) ctx.modes.add(m)
  }
  return bag
}

function synthesizeVisitComposite(
  ctx: AgentContext,
  _drafts: DraftPayload[],
  stepMessages: AgentMessage[],
): AgentMessage[] {
  const account = ctx.state.account
  const opportunity = ctx.state.opportunity
  const activity = ctx.state.activity
  const extracted = ctx.state.extracted
  if (!activity && !opportunity) return stepMessages

  const chain = [
    'EntityExtract',
    '客户画像 Agent',
    '活动创建 Agent',
    '商机创建 Agent',
  ]

  const product = [extracted?.productLine, extracted?.productModel].filter(Boolean).join(' ')
  const qty = extracted?.quantity ? `${extracted.quantity} 台` : ''
  const contact = extracted?.contactName || activity?.contactName
  const head = account
    ? `已根据你的口述生成草稿：${account.name}`
    : '已根据口述生成草稿，但客户未命中种子库'
  const detailParts = [
    contact ? `对接 ${contact}` : null,
    product ? `意向 ${product}${qty ? ` × ${qty}` : ''}` : null,
  ].filter(Boolean)
  const accountMeta = account
    ? `信用 ${account.creditLevel} / 近 30 天 ${account.visitCount30d} 次拜访`
    : null
  const oppLine = opportunity?.reuseExisting
    ? `商机建议追加既有 ${opportunity.existingOpportunityRef}`
    : opportunity
      ? '并已生成新商机草稿'
      : '已生成活动草稿'
  const tail = account ? '请确认或编辑后提交。' : '请先编辑客户名称再确认。'

  const content = [
    [head, ...detailParts].filter(Boolean).join('，'),
    accountMeta,
    `${oppLine}。${tail}`,
  ]
    .filter(Boolean)
    .join('。')
    .replace(/。。+/g, '。')

  const composite: AgentMessage = {
    id: uid('msg'),
    role: 'assistant',
    agent_name: 'Orchestrator',
    content,
    sources: activity?.sources ?? [],
    confidence: Math.min(
      activity?.confidence ?? 1,
      opportunity?.confidence ?? 1,
    ),
    agent_chain: chain,
    createdAt: new Date().toISOString(),
  }

  // Summary first; keep step/draft messages that add new content.
  const extras = stepMessages.filter(
    (m) => m.content.trim() && m.content.trim() !== composite.content.trim(),
  )
  return [composite, ...extras]
}

export async function orchestrate(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  ensureAgentsRegistered()
  const t0 = performance.now()
  const utterance = req.utterance.trim()
  const sessionKey = req.context?.conversationId || req.context?.sessionKey

  const intentResult = await classifyIntent(utterance)
  let intent = intentResult.intent

  if (intent === 'clarify' && req.context?.accountId) {
    intent = 'query_account'
  }

  const ctx: AgentContext = {
    utterance,
    locale: req.locale,
    sessionKey,
    intent,
    memory: { ...(req.context || {}) },
    state: {} as PipelineState,
    modes: new Set<'deepseek' | 'heuristic'>([intentResult.mode]),
  }

  let messages: AgentMessage[] = []
  let drafts: DraftPayload[] = []

  if (intent === 'clarify') {
    const clarify = await buildClarifyReply(utterance, { reason: intentResult.reason })
    messages = [clarify.message]
    ctx.modes.add(clarify.mode)
  } else {
    const pipeline = PIPELINES[intent]
    if (!pipeline || pipeline.agents.length === 0) {
      const clarify = await buildClarifyReply(utterance, {
        reason: intentResult.reason || '无可用流水线',
      })
      messages = [clarify.message]
      ctx.modes.add(clarify.mode)
    } else {
      const bag =
        pipeline.mode === 'fanout'
          ? await runFanout(pipeline.agents, ctx)
          : await runSequential(pipeline.agents, ctx)

      drafts = bag.drafts
      if (intent === 'capture_visit') {
        messages =
          ctx.state.activity || ctx.state.opportunity
            ? synthesizeVisitComposite(ctx, drafts, bag.messages)
            : bag.messages
      } else {
        // query_account / query_order / work_summary: use agent messages directly
        // (avoid duplicating the same content under an Orchestrator wrapper).
        messages = bag.messages
      }
    }
  }

  const latencyMs = Math.round(performance.now() - t0)
  const mode = ctx.modes.has('deepseek') ? 'deepseek' : 'heuristic'

  await repository.writeLog({
    sessionId: sessionKey,
    agentName: 'Orchestrator',
    inputSummary: utterance.slice(0, 500),
    outputEnvelope: JSON.stringify({
      intent,
      pipeline: PIPELINES[intent]?.agents ?? [],
      drafts: drafts.length,
      messages: messages.length,
    }),
    latencyMs,
    success: true,
    confidence: messages[0]?.confidence,
    promptVersion: config.promptVersion,
    modelName: hasDeepSeek() ? config.deepseekModel : 'heuristic',
  })

  if (sessionKey) {
    const prev = await repository.getConversation(sessionKey)
    const prevMessages = prev ? (JSON.parse(prev.messagesJson) as unknown[]) : []
    await repository.saveConversation(sessionKey, ctx.memory, [
      ...prevMessages,
      { role: 'user', content: utterance },
      ...messages,
    ])
  }

  return {
    messages,
    drafts,
    context: ctx.memory,
    latencyMs,
    intent,
    mode,
  }
}
