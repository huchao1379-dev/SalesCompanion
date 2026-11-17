import { config, hasDeepSeek } from './config.js'
import { classifyIntent } from './agents/intent.js'
import { ensureAgentsRegistered } from './agents/catalog.js'
import { requireAgent } from './agents/registry.js'
import type {
  AgentContext,
  AgentResult,
  PipelineDef,
  PipelineState,
} from './agents/agentTypes.js'
import { store } from './store/dataverseStore.js'
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

function clarifyMessage(): AgentMessage {
  return {
    id: uid('msg'),
    role: 'assistant',
    agent_name: 'Orchestrator',
    content:
      '我可以帮你：① 录入拜访 ② 查询客户画像 ③ 查询订单物流 ④ 写工作总结。请补充一句完整需求。',
    sources: [],
    confidence: 0.55,
    agent_chain: ['Orchestrator'],
    createdAt: new Date().toISOString(),
  }
}

function synthesizeVisitComposite(
  ctx: AgentContext,
  _drafts: DraftPayload[],
  stepMessages: AgentMessage[],
): AgentMessage[] {
  const account = ctx.state.account
  const opportunity = ctx.state.opportunity
  const activity = ctx.state.activity
  if (!activity && !opportunity) return stepMessages

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
          opportunity?.reuseExisting
            ? `商机侧建议追加既有 ${opportunity.existingOpportunityRef}`
            : '已生成新商机草稿'
        }。请确认或编辑后提交。`
      : '已根据口述生成草稿，但客户未命中种子库，请编辑客户名称后确认。',
    sources: activity?.sources ?? [],
    confidence: Math.min(
      activity?.confidence ?? 1,
      opportunity?.confidence ?? 1,
    ),
    agent_chain: chain,
    createdAt: new Date().toISOString(),
  }

  // Orchestrator summary first, then per-agent draft bubbles.
  return [composite, ...stepMessages]
}

function synthesizeQueryComposite(
  ctx: AgentContext,
  stepMessages: AgentMessage[],
): AgentMessage[] {
  if (!stepMessages.length) return stepMessages
  const profile = stepMessages[0]
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
  return [composite, ...stepMessages]
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
    messages = [clarifyMessage()]
  } else {
    const pipeline = PIPELINES[intent]
    if (!pipeline || pipeline.agents.length === 0) {
      messages = [clarifyMessage()]
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
      } else if (intent === 'query_account') {
        messages = synthesizeQueryComposite(ctx, bag.messages)
      } else if (intent === 'query_order') {
        const orderMsg = bag.messages[0]
        messages = orderMsg
          ? [
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
              ...bag.messages,
            ]
          : bag.messages
      } else {
        messages = bag.messages
      }
    }
  }

  const latencyMs = Math.round(performance.now() - t0)
  const mode = ctx.modes.has('deepseek') ? 'deepseek' : 'heuristic'

  store.writeLog({
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
    const prev = store.getConversation(sessionKey)
    const prevMessages = prev ? (JSON.parse(prev.messagesJson) as unknown[]) : []
    store.saveConversation(sessionKey, ctx.memory, [
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
