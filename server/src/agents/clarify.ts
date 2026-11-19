import { chatStructured, hasDeepSeek } from '../llm/deepseek.js'
import { clarifyOutputSchema } from '../llm/schemas.js'
import type { AgentMessage, MessageUiBlock } from '../types.js'
import type { ConversationTurn } from './agentTypes.js'
import { CLARIFY_SYSTEM } from './prompts.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export type ClarifyOptions = {
  reason?: string
  focus?: 'capability' | 'greeting' | 'missing_info' | 'ambiguous' | 'none'
  missingSlots?: string[]
  history?: ConversationTurn[]
  memory?: Record<string, string>
  knownAccounts?: string[]
}

function quoteSnippet(utterance: string, max = 28) {
  const t = utterance.trim().replace(/\s+/g, ' ')
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function pickAccounts(accounts: string[] = []) {
  return accounts.filter(Boolean).slice(0, 3)
}

function focusLabel(focus?: ClarifyOptions['focus']) {
  if (focus === 'capability') return '能力说明'
  if (focus === 'greeting') return '开始使用'
  if (focus === 'ambiguous') return '需要确认'
  return '补充信息'
}

function makeClarifyMessage(params: {
  reply: string
  question: string
  examples: string[]
  confidence: number
  focus?: ClarifyOptions['focus']
}): AgentMessage {
  const ui: MessageUiBlock = {
    type: 'clarify',
    title: focusLabel(params.focus),
    question: params.question,
    examples: params.examples.length ? params.examples : undefined,
    tone: 'info',
    footnote: '也可以直接点下面的示例，我会按你的场景继续。',
  }
  return {
    id: uid('msg'),
    role: 'assistant',
    agent_id: 'Orchestrator',
    agent_name: '销售 Copilot',
    content: params.reply,
    sources: [],
    confidence: params.confidence,
    confidence_kind: 'answer',
    agent_chain: ['Orchestrator', 'Clarify'],
    createdAt: new Date().toISOString(),
    ui,
  }
}

/** Heuristic clarify that varies with the utterance — never a single fixed string. */
export function heuristicClarify(utterance: string, opts?: ClarifyOptions): AgentMessage {
  const t = utterance.trim()
  const lower = t.toLowerCase()
  const snippet = quoteSnippet(t)
  const missing = opts?.missingSlots || []
  const focus = opts?.focus
  const accounts = pickAccounts(opts?.knownAccounts)
  const accountExamples = [...new Set([
    ...accounts.map((name) => `${name}最近怎么样？`),
    '仁济医院最近怎么样？',
    'Hospital Alpha 的开放商机',
  ])].slice(0, 3)

  if (focus === 'capability' || /你能做|能做什么|有什么功能|怎么用|你会什么|帮我什么|告诉我你能|capabilities|what can you/i.test(t)) {
    const reply = snippet
      ? `你在问「${snippet}」——我可以把一句拜访口述变成活动/商机草稿，也能查客户画像、订单物流和写工作总结。`
      : '我可以把一句拜访口述变成活动/商机草稿，也能查客户画像、订单物流和写工作总结。'
    return makeClarifyMessage({
      reply,
      question: '你今天想先处理哪件事？',
      examples: [
        '刚拜访仁济医院张主任，N17 要 12 台，下周三再约',
        '仁济医院最近怎么样？',
        '查一下 Hospital Alpha 上个订单的物流',
      ],
      confidence: 0.82,
      focus: 'capability',
    })
  }

  if (focus === 'greeting' || (/你好|嗨|在吗|hello|hi\b/i.test(lower) && t.length < 12)) {
    return makeClarifyMessage({
      reply: '你好，我是销售 Copilot。今天想先录入拜访、查客户，还是看订单物流？',
      question: '今天想先做哪件事？',
      examples: ['帮我写今日工作小结', 'Hospital Beta 最新进度怎么样'],
      confidence: 0.76,
      focus: 'greeting',
    })
  }

  if (missing.includes('account') || (focus === 'missing_info' && /客户|医院|订单|物流/.test(t))) {
    return makeClarifyMessage({
      reply: snippet
        ? `要处理「${snippet}」，我需要先确认是哪家客户/医院。`
        : '我需要先确认是哪家客户/医院。',
      question: '是哪一家？',
      examples: accountExamples,
      confidence: 0.66,
      focus: 'missing_info',
    })
  }

  if (missing.includes('action') || focus === 'ambiguous') {
    return makeClarifyMessage({
      reply: snippet
        ? `关于「${snippet}」，我还需要确认你想让我做什么。`
        : '我还需要确认你想让我做什么。',
      question: '你是想录入拜访、查客户画像，还是查订单物流？',
      examples: [
        '刚拜访了仁济张主任，帮我生成草稿',
        '仁济医院最近怎么样？',
        '查一下仁济医院上个订单的物流',
      ],
      confidence: 0.62,
      focus: 'ambiguous',
    })
  }

  if (/订单|物流|发货|清关|运单|ETA|到哪/i.test(t)) {
    return makeClarifyMessage({
      reply: snippet ? `想查「${snippet}」的话，请带上医院/客户名称。` : '查订单或物流请带上医院/客户名称。',
      question: '是哪家客户的订单？',
      examples: accountExamples.slice(0, 2).map((name) => name.replace('最近怎么样？', '上个订单的物流')),
      confidence: 0.68,
      focus: 'missing_info',
    })
  }

  if (/画像|客户|进度|怎么样|信用|商机/.test(t)) {
    return makeClarifyMessage({
      reply: snippet
        ? `关于「${snippet}」，我可以查画像，但需要明确医院或客户名。`
        : '查询客户画像需要明确医院或客户名。',
      question: '是哪一家客户？',
      examples: accountExamples,
      confidence: 0.66,
      focus: 'missing_info',
    })
  }

  if (/总结|日报|周报/.test(t)) {
    return makeClarifyMessage({
      reply: '写总结前最好先有活动草稿。你可以先口述一条拜访，或直接说「帮我写今日工作小结」。',
      question: '要写日报还是周报？',
      examples: ['帮我写今日工作小结', '根据今天的拜访写一段周报素材'],
      confidence: 0.72,
      focus: 'missing_info',
    })
  }

  if (t.length < 8) {
    return makeClarifyMessage({
      reply: `我收到了「${snippet || t}」，信息还不够完整。`,
      question: '补充客户、产品，或说明你想查/录什么？',
      examples: [
        '录入拜访：仁济医院 · 张主任 · 监护仪 N17 · 8 台',
        '查询：仁济医院最近怎么样',
      ],
      confidence: 0.6,
      focus: 'missing_info',
    })
  }

  return makeClarifyMessage({
    reply: snippet ? `关于「${snippet}」，我还需要确认目标。` : '我还需要确认你的目标。',
    question: '你是想录入拜访草稿、查客户画像、查订单物流，还是写工作总结？',
    examples: [
      '刚拜访了对方，帮我生成活动草稿',
      '查这个客户的画像和开放商机',
      '查最近一笔订单物流',
    ],
    confidence: 0.6,
    focus: 'ambiguous',
  })
}

export async function buildClarifyReply(
  utterance: string,
  opts?: ClarifyOptions,
): Promise<{ message: AgentMessage; mode: 'deepseek' | 'heuristic' }> {
  const fallback = heuristicClarify(utterance, opts)
  if (!hasDeepSeek()) return { message: fallback, mode: 'heuristic' }

  try {
    const { data, mode } = await chatStructured({
      system: CLARIFY_SYSTEM,
      user: JSON.stringify({
        utterance,
        focus: opts?.focus || 'missing_info',
        missingSlots: opts?.missingSlots || [],
        intentReason: opts?.reason || null,
        lastTurn: opts?.history?.slice(-2).map((turn) => ({
          role: turn.role,
          agent_name: turn.agentName,
          content: turn.content.slice(0, 200),
        })) || [],
        knownAccounts: (opts?.knownAccounts || []).slice(0, 8),
      }),
      temperature: 0.25,
      maxTokens: 320,
      schema: clarifyOutputSchema,
    })

    const reply = data.reply.trim()
    if (!reply) return { message: fallback, mode: 'heuristic' }

    // Guard against the old canned template if the model regresses.
    const canned = /我可以帮你：①\s*录入拜访\s*②\s*查询客户画像\s*③\s*查询订单物流\s*④\s*写工作总结/
    if (canned.test(reply) && utterance.trim().length > 0) {
      return { message: fallback, mode: 'heuristic' }
    }

    const examples = (data.examples || [])
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3)
    const question = (data.question || reply.split(/[。！？!?]/)[0] || '还需要补充什么？').trim()

    return {
      mode,
      message: {
        ...fallback,
        content: reply,
        confidence: Math.max(0.4, Math.min(1, data.confidence ?? 0.75)),
        createdAt: new Date().toISOString(),
        ui: {
          type: 'clarify',
          title: '需要确认',
          question,
          examples: examples.length ? examples : fallback.ui?.examples,
          tone: 'info',
          footnote: '点下方示例可以直接继续；也可以换一种说法。',
        },
      },
    }
  } catch {
    return { message: fallback, mode: 'heuristic' }
  }
}
