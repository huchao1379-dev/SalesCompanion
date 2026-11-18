import { chatJson, hasDeepSeek } from '../llm/deepseek.js'
import type { AgentMessage } from '../types.js'
import { CLARIFY_SYSTEM } from './prompts.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

type ClarifyPayload = {
  reply?: string
  confidence?: number
  focus?: string
  examples?: string[]
}

export type ClarifyOptions = {
  reason?: string
}

function formatReply(reply: string, examples?: string[]) {
  const cleaned = reply.trim()
  const ex = (examples || []).map((e) => e.trim()).filter(Boolean).slice(0, 3)
  if (!ex.length) return cleaned
  if (ex.every((e) => cleaned.includes(e))) return cleaned
  return `${cleaned}\n\n可以这样问我：\n${ex.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
}

function quoteSnippet(utterance: string, max = 28) {
  const t = utterance.trim().replace(/\s+/g, ' ')
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** Heuristic clarify that varies with the utterance — never a single fixed string. */
export function heuristicClarify(utterance: string, opts?: ClarifyOptions): AgentMessage {
  const t = utterance.trim()
  const lower = t.toLowerCase()
  const snippet = quoteSnippet(t)

  let reply: string
  let examples: string[]
  let confidence = 0.62

  if (/你能做|能做什么|有什么功能|怎么用|你会什么|帮我什么|告诉我你能|capabilities|what can you/i.test(t)) {
    confidence = 0.8
    reply = snippet
      ? `你在问「${snippet}」——我主要帮销售做四类事：口述录入拜访（生成活动/商机草稿）、查客户画像与开放商机、查订单物流，以及根据活动草稿写日报/周报。直接说具体场景即可，不必套模板。`
      : '我主要帮销售做四类事：录入拜访草稿、查客户画像、查订单物流、写日报/周报素材。直接说具体场景即可。'
    examples = [
      '刚拜访仁济医院张主任，他们对 N17 监护仪感兴趣，大概要 8 台，下周三再约',
      '仁济医院最近怎么样？信用和开放商机呢',
      '查一下 Hospital Alpha 上个订单的物流',
    ]
  } else if (/你好|嗨|在吗|hello|hi\b/i.test(lower) && t.length < 12) {
    confidence = 0.72
    reply = '你好，我是销售 Copilot。今天想先录入拜访、查某个医院，还是看订单物流？'
    examples = ['帮我写今日工作小结', 'Hospital Beta 最新进度怎么样']
  } else if (/订单|物流|发货|清关|运单|ETA|到哪/i.test(t)) {
    confidence = 0.68
    reply = snippet
      ? `想查「${snippet}」的话，请带上医院/客户名称；有运单号或订单名会更准。`
      : '查订单或物流请带上医院/客户名称。'
    examples = ['查一下仁济医院上个订单的物流', 'Hospital Alpha 发货到哪了']
  } else if (/画像|客户|进度|怎么样|信用|商机/.test(t)) {
    confidence = 0.68
    reply = snippet
      ? `关于「${snippet}」，我可以查画像，但需要明确医院或客户名（例如仁济医院 / Hospital Alpha）。`
      : '查询客户画像需要明确医院或客户名。'
    examples = ['仁济医院最近怎么样？', 'Hospital Alpha 信用和开放商机']
  } else if (/总结|日报|周报/.test(t)) {
    confidence = 0.7
    reply = '写总结前最好先有活动草稿。你可以先口述一条拜访，或直接说「帮我写今日工作小结」。'
    examples = ['帮我写今日工作小结', '根据今天的拜访写一段周报素材']
  } else if (t.length < 8) {
    confidence = 0.58
    reply = `我收到了「${snippet || t}」，信息还不够完整。补充客户、产品，或说明你想查/录什么，我就能继续。`
    examples = [
      '录入拜访：仁济医院 · 张主任 · 监护仪 N17 · 8 台',
      '查询：仁济医院最近怎么样',
    ]
  } else {
    confidence = 0.6
    const why = opts?.reason ? `（判定：${opts.reason}）` : ''
    reply = `关于「${snippet}」${why}，我还需要确认目标：录入拜访草稿、查客户画像、查订单物流，还是写工作总结？`
    examples = [
      '刚拜访了对方，帮我生成活动草稿',
      '查这个客户的画像和开放商机',
      '查最近一笔订单物流',
    ]
  }

  return {
    id: uid('msg'),
    role: 'assistant',
    agent_name: 'Orchestrator',
    content: formatReply(reply, examples),
    sources: [],
    confidence,
    agent_chain: ['Orchestrator', 'Clarify'],
    createdAt: new Date().toISOString(),
  }
}

export async function buildClarifyReply(
  utterance: string,
  opts?: ClarifyOptions,
): Promise<{ message: AgentMessage; mode: 'deepseek' | 'heuristic' }> {
  const fallback = heuristicClarify(utterance, opts)
  if (!hasDeepSeek()) return { message: fallback, mode: 'heuristic' }

  try {
    const { data, mode } = await chatJson<ClarifyPayload>({
      system: CLARIFY_SYSTEM,
      user: JSON.stringify({
        utterance,
        intentHint: 'clarify',
        intentReason: opts?.reason || null,
        knownAccounts: ['上海仁济医院', 'Hospital Alpha', 'Hospital Beta', 'Hospital Gamma', 'Hospital Delta'],
        instruction:
          '按用户原话定制回复。禁止输出固定四条编号能力清单作为唯一正文；若介绍能力，用自然段落并配合不同示例。',
      }),
      temperature: 0.55,
    })

    const reply = data.reply?.trim()
    if (!reply) return { message: fallback, mode: 'heuristic' }

    // Guard against the old canned template if the model regresses.
    const canned =
      /我可以帮你：①\s*录入拜访\s*②\s*查询客户画像\s*③\s*查询订单物流\s*④\s*写工作总结/
    if (canned.test(reply) && utterance.trim().length > 0) {
      return { message: fallback, mode: 'heuristic' }
    }

    return {
      mode,
      message: {
        ...fallback,
        content: formatReply(reply, data.examples),
        confidence: Math.max(0.4, Math.min(1, data.confidence ?? 0.75)),
        createdAt: new Date().toISOString(),
      },
    }
  } catch {
    return { message: fallback, mode: 'heuristic' }
  }
}
