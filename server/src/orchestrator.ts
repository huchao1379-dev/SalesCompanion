import { config, hasDeepSeek } from './config.js'
import {
  mergeUtteranceWithAttachments,
  understandAttachments,
} from './agents/attachments.js'
import { buildClarifyReply } from './agents/clarify.js'
import { classifyIntent } from './agents/intent.js'
import { ensureAgentsRegistered } from './agents/catalog.js'
import { requireAgent } from './agents/registry.js'
import type {
  AgentContext,
  AgentResult,
  ConversationTurn,
  PipelineDef,
  PipelineState,
} from './agents/agentTypes.js'
import { repository } from './store/dataverseStore.js'
import type {
  AgentMessage,
  AgentStep,
  DraftPayload,
  Intent,
  MessageUiMetric,
  OrchestratorRequest,
  OrchestratorResponse,
  ReviewFinding,
  SourceRef,
} from './types.js'

/**
 * Intent → collaboration mode + agent chain.
 * Add agents in catalog.ts, then list them here (or use intents[] for single-route).
 */
const PIPELINES: Partial<Record<Intent, PipelineDef>> = {
  /**
   * Visit path: extract → draft → supervise.
   * Account resolve is folded into ActivityCreate (no separate AccountProfile hop),
   * which cuts one sequential step without losing seed matching.
   */
  capture_visit: {
    mode: 'sequential',
    agents: ['EntityExtract', 'ActivityCreate', 'OpportunityCreate', 'OpportunitySupervisor'],
  },
  query_account: {
    mode: 'fanout',
    agents: ['AccountProfile', 'OpportunityPulse'],
  },
  query_order: {
    mode: 'single',
    agents: ['OrderQuery'],
  },
  work_summary: {
    mode: 'single',
    agents: ['WorkSummary'],
  },
  general_assist: {
    mode: 'single',
    agents: ['GeneralAssist'],
  },
}

const AGENT_IDS: Record<string, string> = {
  Orchestrator: 'Orchestrator',
  销售Copilot: 'Orchestrator',
  实体抽取: 'EntityExtract',
  客户画像Agent: 'AccountProfile',
  商机速览Agent: 'OpportunityPulse',
  活动创建Agent: 'ActivityCreate',
  商机创建Agent: 'OpportunityCreate',
  商机督导Agent: 'OpportunitySupervisor',
  订单查询Agent: 'OrderQuery',
  工作总结Agent: 'WorkSummary',
  通用助手: 'GeneralAssist',
}

const AGENT_ALIASES: Record<string, string[]> = {
  上海仁济医院: ['仁济', '仁济医院'],
  'Hospital Alpha': ['Alpha'],
  'Hospital Beta': ['Beta'],
  'Hospital Gamma': ['Gamma'],
  'Hospital Delta': ['Delta'],
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}

function agentIdFor(name: string, fallback = 'Orchestrator') {
  if (!name) return fallback
  if (AGENT_IDS[name]) return AGENT_IDS[name]
  const compact = name.replace(/\s+/g, '')
  if (AGENT_IDS[compact]) return AGENT_IDS[compact]
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return name
  return fallback
}

function mergeResult(
  into: { messages: AgentMessage[]; drafts: DraftPayload[] },
  result: AgentResult,
  ctx: AgentContext,
) {
  if (result.messages?.length) into.messages.push(...result.messages)
  for (const draft of result.drafts ?? []) {
    const idx = into.drafts.findIndex((item) => item.idempotencyKey === draft.idempotencyKey)
    if (idx >= 0) into.drafts[idx] = draft
    else into.drafts.push(draft)
  }
  if (result.memoryPatch) Object.assign(ctx.memory, result.memoryPatch)
  if (result.statePatch) Object.assign(ctx.state, result.statePatch)
  if (result.review) ctx.state.review = result.review
  if (result.mode) ctx.modes.add(result.mode)
}

async function safeLog(row: Parameters<typeof repository.writeLog>[0]) {
  try {
    await repository.writeLog(row)
  } catch {
    /* Logging must never break the user turn. */
  }
}

async function runAgentWithLog(
  name: string,
  ctx: AgentContext,
  steps: AgentStep[],
): Promise<AgentResult> {
  const agent = requireAgent(name)
  const started = performance.now()
  try {
    const result = await agent.run(ctx)
    const latencyMs = Math.round(performance.now() - started)
    const confidence =
      result.messages?.find((message) => message.confidence > 0)?.confidence ??
      result.drafts?.[0]?.confidence
    const status = result.mode === 'heuristic' && hasDeepSeek() ? 'fallback' : 'ok'
    steps.push({
      agentId: agent.name,
      agentName: agent.displayName,
      status,
      latencyMs,
      summary: result.messages?.[0]?.content.slice(0, 120) ||
        (result.drafts?.length ? `生成 ${result.drafts.length} 条草稿` : undefined),
    })
    await safeLog({
      sessionId: ctx.sessionKey,
      agentName: agent.displayName,
      inputSummary: ctx.utterance.slice(0, 500),
      outputEnvelope: JSON.stringify({
        agentId: agent.name,
        messages: result.messages?.length ?? 0,
        drafts: result.drafts?.map((draft) => draft.idempotencyKey) ?? [],
        review: result.review?.length ?? 0,
      }),
      latencyMs,
      success: true,
      confidence,
      promptVersion: config.promptVersion,
      modelName: hasDeepSeek() ? config.deepseekModel : 'heuristic',
      fallbackReason: status === 'fallback' ? 'agent returned heuristic output' : undefined,
    })
    if (result.mode) ctx.modes.add(result.mode)
    return result
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started)
    steps.push({
      agentId: agent.name,
      agentName: agent.displayName,
      status: 'error',
      latencyMs,
      errorCode: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
    })
    await safeLog({
      sessionId: ctx.sessionKey,
      agentName: agent.displayName,
      inputSummary: ctx.utterance.slice(0, 500),
      latencyMs,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'unknown',
      errorCode: 'AGENT_FAILED',
      promptVersion: config.promptVersion,
      modelName: hasDeepSeek() ? config.deepseekModel : 'heuristic',
    })
    throw error
  }
}

async function runSequential(agentNames: string[], ctx: AgentContext, steps: AgentStep[]) {
  const bag = { messages: [] as AgentMessage[], drafts: [] as DraftPayload[] }
  const snapshot = repository.snapshotDrafts?.()
  try {
    for (const name of agentNames) {
      const result = await runAgentWithLog(name, ctx, steps)
      mergeResult(bag, result, ctx)
      if (result.halt) break
    }
    return bag
  } catch (error) {
    if (snapshot) repository.restoreDrafts?.(snapshot)
    throw error
  }
}

async function runFanout(agentNames: string[], ctx: AgentContext, steps: AgentStep[]) {
  const bag = { messages: [] as AgentMessage[], drafts: [] as DraftPayload[] }
  const snapshot = repository.snapshotDrafts?.()
  try {
    const results = await Promise.all(
      agentNames.map(async (name) => {
        const branchSteps: AgentStep[] = []
        const branchCtx: AgentContext = {
          ...ctx,
          memory: { ...ctx.memory },
          state: { ...ctx.state },
          modes: new Set(ctx.modes),
        }
        const result = await runAgentWithLog(name, branchCtx, branchSteps)
        steps.push(...branchSteps)
        return { result, branchCtx }
      }),
    )
    for (const { result, branchCtx } of results) {
      mergeResult(bag, result, ctx)
      Object.assign(ctx.memory, branchCtx.memory)
      Object.assign(ctx.state, branchCtx.state)
      for (const mode of branchCtx.modes) ctx.modes.add(mode)
    }
    return bag
  } catch (error) {
    if (snapshot) repository.restoreDrafts?.(snapshot)
    throw error
  }
}

function dedupeSources(sources: SourceRef[]) {
  return sources.filter(
    (source, index, list) =>
      list.findIndex(
        (item) =>
          item.kind === source.kind &&
          item.label === source.label &&
          (item.ref || '') === (source.ref || ''),
      ) === index,
  )
}

function reviewFor(ctx: AgentContext): ReviewFinding[] {
  return ctx.state.review || ctx.state.opportunity?.reviewFindings || ctx.state.activity?.reviewFindings || []
}

/** Deduplicate and attach shared follow-ups on the last query_account card. */
function enrichAccountFollowUps(messages: AgentMessage[], ctx: AgentContext): AgentMessage[] {
  if (!messages.length) return messages
  const accountName =
    ctx.state.account?.name ||
    ctx.memory.accountName ||
    messages.find((m) => m.ui?.accountKey)?.ui?.title ||
    ''
  const label = accountName || '这家客户'
  const shared = [
    `查一下${label}上个订单的物流`,
    `帮我写一封给${label}的跟进邮件`,
    `刚拜访完${label}，帮我生成活动草稿`,
  ]
  const seen = new Set<string>()
  const followUps: string[] = []
  for (const message of messages) {
    for (const chip of message.ui?.followUps || message.ui?.examples || []) {
      const key = chip.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      followUps.push(key)
    }
  }
  for (const chip of shared) {
    if (seen.has(chip)) continue
    seen.add(chip)
    followUps.push(chip)
  }
  const trimmed = followUps.slice(0, 4)
  // Put unified chips on the last assistant card so the thread ends with one chase row.
  return messages.map((message, index) => {
    if (!message.ui) return message
    if (index !== messages.length - 1) {
      return {
        ...message,
        ui: {
          ...message.ui,
          followUps: undefined,
          examples: undefined,
        },
      }
    }
    return {
      ...message,
      ui: {
        ...message.ui,
        followUps: trimmed,
        examples: trimmed,
      },
    }
  })
}

function synthesizeVisitComposite(ctx: AgentContext): AgentMessage[] {
  const { account, opportunity, activity, extracted } = ctx.state
  if (!activity && !opportunity) return []

  const chain = ['EntityExtract', 'ActivityCreate', 'OpportunityCreate', 'OpportunitySupervisor']
  const product = [extracted?.productLine, extracted?.productModel].filter(Boolean).join(' ')
  const qty = extracted?.quantity ? `${extracted.quantity} 台` : ''
  const contact = extracted?.contactName || activity?.contactName
  const findings = reviewFor(ctx)
  const blocked = findings.some((finding) => finding.severity === 'block')
  const warnings = findings.filter((finding) => finding.severity === 'warn')

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
  const reviewLine = blocked
    ? '督导发现阻断项，请先补全客户信息。'
    : warnings.length
      ? `督导提醒：${warnings[0].message}`
      : '督导未发现阻断问题。'
  const tail = account ? '请确认或编辑后提交。' : '请先编辑客户名称再确认。'

  const content = [
    [head, ...detailParts].filter(Boolean).join('，'),
    accountMeta,
    `${oppLine}。${reviewLine}${tail}`,
  ]
    .filter(Boolean)
    .join('。')
    .replace(/。。+/g, '。')

  const metrics: MessageUiMetric[] = [
    {
      label: '活动草稿',
      value: activity ? (activity.followUpAt ? `跟进 ${activity.followUpAt}` : '待补跟进') : '未生成',
      tone: activity ? 'accent' : 'warn',
      priority: 'primary',
    },
    {
      label: '商机',
      value: opportunity
        ? opportunity.reuseExisting
          ? '关联既有'
          : '新建草稿'
        : '未生成',
      tone: opportunity?.reuseExisting ? 'good' : opportunity ? 'accent' : 'neutral',
      priority: 'primary',
    },
  ]

  const facts = [
    { label: '客户', value: account?.name || activity?.accountName || '待确认', tone: account ? 'good' as const : 'warn' as const },
    { label: '联系人', value: contact || activity?.contactName || '待确认', tone: contact ? 'neutral' as const : 'warn' as const },
    { label: '产品', value: product || '待确认', tone: product ? 'neutral' as const : 'warn' as const },
    { label: '数量', value: qty || '待确认', tone: qty ? 'neutral' as const : 'warn' as const },
    { label: '下次跟进', value: activity?.followUpAt || '待确认', tone: activity?.followUpAt ? 'good' as const : 'warn' as const },
  ]

  return [
    {
      id: uid('msg'),
      role: 'assistant',
      agent_id: 'Orchestrator',
      agent_name: '销售 Copilot',
      content,
      sources: dedupeSources([...(activity?.sources ?? []), ...(opportunity?.sources ?? [])]),
      confidence: Math.min(activity?.confidence ?? 1, opportunity?.confidence ?? 1),
      confidence_kind: 'composite',
      agent_chain: chain,
      createdAt: new Date().toISOString(),
      ui: {
        type: 'capture_result',
        title: account?.name || '本次拜访草稿',
        metrics,
        facts,
        findings,
        followUps: [
          account ? `${account.name}最近怎么样？` : '仁济医院最近怎么样？',
          '帮我写一封拜访后的跟进邮件',
          '根据今天的跟进帮我写一段工作小结',
        ],
        footnote: blocked
          ? '督导存在阻断项：请先编辑草稿补全必填信息，再确认同步。'
          : '草稿尚未写入业务系统；确认后才会进入同步流程。',
        tone: blocked ? 'warn' : 'info',
      },
    },
  ]
}

function errorMessage(intent: Intent, error: unknown): AgentMessage {
  return {
    id: uid('msg'),
    role: 'assistant',
    agent_id: 'Orchestrator',
    agent_name: 'Orchestrator',
    content: `处理「${intent}」时遇到问题：${
      error instanceof Error ? error.message.slice(0, 160) : '未知错误'
    }。请稍后重试，或改用规则兜底。`,
    sources: [],
    confidence: 0.3,
    confidence_kind: 'answer',
    agent_chain: ['Orchestrator'],
    createdAt: new Date().toISOString(),
    ui: {
      type: 'clarify',
      title: '处理失败',
      question: '要重试还是换一种说法？',
      examples: ['帮我写今日工作小结', '仁济医院最近怎么样？'],
      tone: 'warn',
    },
  }
}

function normalizeMessage(message: AgentMessage, fallbackAgentId = 'Orchestrator'): AgentMessage {
  const agentId = message.agent_id || agentIdFor(message.agent_name, fallbackAgentId)
  const confidence = clamp(
    message.confidence > 0
      ? message.confidence
      : message.draft
        ? 0.65
        : 0.72,
  )
  const confidenceKind =
    message.confidence_kind ||
    (message.draft
      ? 'extraction'
      : agentId === 'Orchestrator'
        ? 'composite'
        : 'answer')
  return {
    ...message,
    agent_id: agentId,
    confidence,
    confidence_kind: confidenceKind,
    sources: message.sources || [],
  }
}

function knownAccountAliases() {
  return Object.entries(AGENT_ALIASES).flatMap(([name, aliases]) => [name, ...aliases])
}

async function buildContext(req: OrchestratorRequest, intent: Intent, history: ConversationTurn[], memory: Record<string, string>) {
  const accounts = await repository.listAccounts()
  const ctx: AgentContext = {
    utterance: req.utterance.trim(),
    locale: req.locale,
    sessionKey: req.context?.conversationId || req.context?.sessionKey,
    turnId: req.turnId,
    intent,
    memory,
    state: {} as PipelineState,
    history,
    knownAccounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      aliases: AGENT_ALIASES[account.name] || [account.externalKey.split(/[-_]/).at(-1) || ''],
    })),
    modes: new Set<'deepseek' | 'heuristic'>(),
  }
  return ctx
}

export async function orchestrate(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  ensureAgentsRegistered()
  const startedAt = performance.now()
  const utterance = req.utterance.trim()
  const sessionKey = req.context?.conversationId || req.context?.sessionKey

  let serverMemory: Record<string, string> = {}
  let history: ConversationTurn[] = []
  let previousMessages: unknown[] = []
  if (sessionKey) {
    try {
      const conversation = await repository.getConversation(sessionKey)
      if (conversation) {
        serverMemory = JSON.parse(conversation.contextJson) as Record<string, string>
        previousMessages = JSON.parse(conversation.messagesJson) as unknown[]
        history = previousMessages
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .map((item) => ({
            role: String(item.role || 'assistant'),
            content: String(item.content || '').slice(0, 480),
            agentName: typeof item.agent_name === 'string' ? item.agent_name : undefined,
          }))
          .filter((turn) => turn.content.trim().length > 0)
          .slice(-10)
      }
    } catch {
      /* Corrupt conversation cache must not block a turn. */
    }
  }

  // Server-side Shared Memory wins over client-supplied context.
  const memory: Record<string, string> = { ...(req.context || {}), ...serverMemory }

  const attachmentStarted = performance.now()
  const attachmentUnderstanding = await understandAttachments(req.attachments)
  const effectiveUtterance = mergeUtteranceWithAttachments(utterance, attachmentUnderstanding)
  const enrichedReq: OrchestratorRequest = { ...req, utterance: effectiveUtterance }

  const intentStarted = performance.now()
  const intentResult = await classifyIntent(effectiveUtterance, {
    history,
    memory,
    knownAccounts: (await repository.listAccounts()).map((account) => ({
      name: account.name,
      aliases: AGENT_ALIASES[account.name] || [],
    })),
  })
  let intent = intentResult.intent
  if (
    intent === 'clarify' &&
    memory.accountId &&
    !/你能做|能做什么|有什么功能|怎么用|你好|嗨|hello|hi/i.test(effectiveUtterance) &&
    /那|它|这个|这家|刚才|这单|那单/.test(effectiveUtterance)
  ) {
    intent = 'query_account'
  }
  // Pronoun follow-ups with remembered account → prefer account query over vague clarify.
  if (
    intent === 'clarify' &&
    memory.accountId &&
    intentResult.focus === 'ambiguous' &&
    /最近|怎么样|进度|信用|商机|画像/.test(effectiveUtterance)
  ) {
    intent = 'query_account'
  }

  const ctx = await buildContext(enrichedReq, intent, history, memory)
  ctx.modes.add(intentResult.mode)
  const steps: AgentStep[] = []
  if (req.attachments?.length) {
    steps.push({
      agentId: 'AttachmentUnderstand',
      agentName: '附件理解',
      status: attachmentUnderstanding.visionDegraded ? 'fallback' : 'ok',
      latencyMs: Math.round(performance.now() - attachmentStarted),
      summary: attachmentUnderstanding.summaries.join('；').slice(0, 160) || '已接收附件',
    })
  }
  steps.push({
    agentId: 'IntentRouter',
    agentName: '意图路由',
    status: intentResult.mode === 'heuristic' && hasDeepSeek() ? 'fallback' : 'ok',
    latencyMs: Math.round(performance.now() - intentStarted),
    summary: `${intentResult.intent} · ${(intentResult.confidence * 100).toFixed(0)}%`,
  })
  await safeLog({
    sessionId: sessionKey,
    agentName: 'IntentRouter',
    inputSummary: effectiveUtterance.slice(0, 500),
    outputEnvelope: JSON.stringify(intentResult),
    latencyMs: steps[steps.length - 1].latencyMs,
    success: true,
    confidence: intentResult.confidence,
    promptVersion: config.promptVersion,
    modelName: hasDeepSeek() ? config.deepseekModel : 'heuristic',
  })

  let messages: AgentMessage[] = []
  let drafts: DraftPayload[] = []
  let pipelineError: unknown

  // Prefer running domain agents. Clarify only for true clarify intents,
  // capability/greeting, or queries that lack both utterance cues and memory.
  const missingAccount =
    intentResult.missingSlots.includes('account') &&
    !memory.accountId &&
    !memory.accountName &&
    !memory.accountRef &&
    !/仁济|Hospital|医院/.test(effectiveUtterance)
  const softClarifyFocus =
    intentResult.focus === 'capability' ||
    intentResult.focus === 'greeting' ||
    intentResult.focus === 'missing_info'
  const shouldClarify =
    intent === 'clarify' ||
    (intentResult.needsClarification && softClarifyFocus && intent !== 'capture_visit') ||
    (missingAccount && (intent === 'query_account' || intent === 'query_order'))

  if (shouldClarify) {
    const clarifyStarted = performance.now()
    const clarify = await buildClarifyReply(utterance, {
      reason: intentResult.reason,
      focus: intentResult.focus,
      missingSlots: intentResult.missingSlots,
      history,
      memory,
      knownAccounts: knownAccountAliases(),
    })
    ctx.modes.add(clarify.mode)
    messages = [clarify.message]
    steps.push({
      agentId: 'Clarify',
      agentName: '澄清 Agent',
      status: clarify.mode === 'heuristic' && hasDeepSeek() ? 'fallback' : 'ok',
      latencyMs: Math.round(performance.now() - clarifyStarted),
      summary: clarify.message.content.slice(0, 80),
    })
    await safeLog({
      sessionId: sessionKey,
      agentName: 'Clarify',
      inputSummary: utterance.slice(0, 500),
      outputEnvelope: JSON.stringify({ intent, focus: intentResult.focus, missingSlots: intentResult.missingSlots }),
      latencyMs: steps[steps.length - 1].latencyMs,
      success: true,
      confidence: clarify.message.confidence,
      promptVersion: config.promptVersion,
      modelName: hasDeepSeek() ? config.deepseekModel : 'heuristic',
    })
  } else {
    const pipeline = PIPELINES[intent]
    if (!pipeline || pipeline.agents.length === 0) {
      messages = [errorMessage(intent, new Error('无可用流水线'))]
    } else {
      try {
        const bag =
          pipeline.mode === 'fanout'
            ? await runFanout(pipeline.agents, ctx, steps)
            : await runSequential(pipeline.agents, ctx, steps)
        drafts = bag.drafts
        if (intent === 'capture_visit') {
          const composite = synthesizeVisitComposite(ctx)
          messages = composite.length ? composite : bag.messages
        } else if (intent === 'query_account') {
          messages = enrichAccountFollowUps(bag.messages, ctx)
        } else {
          messages = bag.messages
        }
      } catch (error) {
        pipelineError = error
        messages = [errorMessage(intent, error)]
      }
    }
  }

  if (!messages.length && drafts.length === 0) {
    messages = [
      normalizeMessage({
        id: uid('msg'),
        role: 'assistant',
        agent_name: 'Orchestrator',
        content: '暂时没有可展示的答复。可以换个说法，或先说明客户和要办的事。',
        sources: [],
        confidence: 0.4,
        confidence_kind: 'answer',
        createdAt: new Date().toISOString(),
      }),
    ]
  }

  messages = messages.map((message) => normalizeMessage(message))
  ctx.memory.lastIntent = intent
  ctx.memory.lastUtterance = utterance.slice(0, 500)
  if (attachmentUnderstanding.contextBlock) {
    ctx.memory.lastAttachmentSummary = attachmentUnderstanding.summaries.join('；').slice(0, 400)
  }
  if (ctx.state.account) {
    ctx.memory.accountId = ctx.state.account.id
    ctx.memory.accountName = ctx.state.account.name
    ctx.memory.accountRef = ctx.state.account.externalKey
  }
  if (ctx.state.activity?.idempotencyKey) {
    ctx.memory.lastActivityKey = ctx.state.activity.idempotencyKey
  }
  if (ctx.state.opportunity?.idempotencyKey) {
    ctx.memory.lastOpportunityKey = ctx.state.opportunity.idempotencyKey
  }
  if (ctx.state.opportunity?.existingOpportunityRef || ctx.state.opportunity?.id) {
    ctx.memory.opportunityId =
      ctx.state.opportunity.existingOpportunityRef || ctx.state.opportunity.id || ctx.memory.opportunityId
  }
  for (const draft of drafts) {
    if (draft.kind === 'activity' && draft.idempotencyKey) {
      ctx.memory.lastActivityKey = draft.idempotencyKey
    }
    if (draft.kind === 'opportunity' && draft.idempotencyKey) {
      ctx.memory.lastOpportunityKey = draft.idempotencyKey
    }
  }

  const latencyMs = Math.round(performance.now() - startedAt)
  const modes = ctx.modes
  const mode: OrchestratorResponse['mode'] = !hasDeepSeek()
    ? 'heuristic'
    : modes.has('deepseek') && modes.has('heuristic')
      ? 'mixed'
      : modes.has('heuristic')
        ? 'heuristic'
        : 'deepseek'
  const fallbackSteps = steps.filter((step) => step.status === 'fallback' || step.status === 'error')
  const degradedParts = [
    fallbackSteps.length
      ? `部分步骤降级：${fallbackSteps.map((step) => step.agentName).join('、')}`
      : '',
    attachmentUnderstanding.visionDegraded
      ? '部分图片未能视觉识别（未配置 VISION_MODEL 或识别失败），已按文件名/文字说明继续。'
      : '',
  ].filter(Boolean)
  const degradedReason = degradedParts.length ? degradedParts.join(' ') : undefined

  await safeLog({
    sessionId: sessionKey,
    agentName: 'Orchestrator',
    inputSummary: utterance.slice(0, 500),
    outputEnvelope: JSON.stringify({
      intent,
      pipeline: PIPELINES[intent]?.agents ?? [],
      drafts: drafts.length,
      messages: messages.length,
      steps: steps.map((step) => `${step.agentId}:${step.status}`),
      error: pipelineError instanceof Error ? pipelineError.message : undefined,
    }),
    latencyMs,
    success: !pipelineError,
    confidence: messages[0]?.confidence,
    errorMessage: pipelineError instanceof Error ? pipelineError.message : undefined,
    errorCode: pipelineError ? 'PIPELINE_FAILED' : undefined,
    promptVersion: config.promptVersion,
    modelName: hasDeepSeek() ? config.deepseekModel : 'heuristic',
    fallbackReason: degradedReason,
  })

  if (sessionKey) {
    try {
      const stored = messages.map((message) => ({
        role: message.role,
        agent_id: message.agent_id,
        agent_name: message.agent_name,
        content: message.content,
        sources: message.sources,
        confidence: message.confidence,
        confidence_kind: message.confidence_kind,
        createdAt: message.createdAt,
        ui: message.ui,
      }))
      await repository.saveConversation(sessionKey, ctx.memory, [
        ...previousMessages.slice(-32),
        { role: 'user', content: utterance, createdAt: new Date().toISOString() },
        ...stored,
      ].slice(-48))
    } catch {
      /* Conversation cache is best-effort. */
    }
  }

  return {
    messages,
    drafts,
    context: ctx.memory,
    latencyMs,
    intent,
    mode,
    degraded_reason: degradedReason,
    steps,
  }
}
