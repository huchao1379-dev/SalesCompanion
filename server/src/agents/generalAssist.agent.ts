/**
 * General assistant Domain Agent — sales coaching, writing help, optional web tools.
 */
import type { DomainAgent } from './agentTypes.js'
import type { AgentMessage, EmailDraftFields, MessageUiBlock, SourceRef } from '../types.js'
import {
  chatStructured,
  chatWithTools,
  hasLlm,
  llmSuccessMode,
  parseStructuredJson,
} from '../llm/deepseek.js'
import type { LlmSuccessMode } from '../llm/types.js'
import { generalAssistOutputSchema } from '../llm/schemas.js'
import { GENERAL_ASSIST_SYSTEM, GENERAL_ASSIST_TOOL_ADDENDUM } from './prompts.js'
import { generalAssistTools } from '../tools/webTools.js'
import { hasWebFetch, hasWebSearch } from '../config.js'
import { nowIsoInZone } from '../util/datetime.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

/** Parse model JSON with lenient repair (fences / trailing commas / unescaped quotes). */
export function parseAssistJson(raw: string) {
  return parseStructuredJson(raw, generalAssistOutputSchema)
}

type GeneralAssistOutput = ReturnType<typeof parseAssistJson>

/** Short, user/log-safe reason when LLM / tools / JSON parse fails. */
export function formatGeneralAssistError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  const msg = error.message || error.name || 'unknown'
  if (error.name === 'TimeoutError' || /aborted|timeout|TimeoutError/i.test(msg)) {
    return 'LLM/工具请求超时'
  }
  if (/exceeded the tool-call round/i.test(msg)) return '工具调用轮次超限'
  if (
    /Expected ',' or ']'|Expected property name|Unexpected token|Unexpected end|JSON\.parse|No JSON object|position \d+/i.test(
      msg,
    )
  ) {
    return `模型输出 JSON 语法错误：${msg.slice(0, 80)}`
  }
  if (/invalid_type|ZodError|Zod/i.test(msg) || error.name === 'ZodError') {
    return `模型输出校验失败：${msg.slice(0, 80)}`
  }
  if (
    /DeepSeek HTTP|DEEPSEEK_UNAVAILABLE|OpenAI HTTP|OPENAI_UNAVAILABLE/i.test(msg)
  ) {
    return msg.slice(0, 100)
  }
  return msg.slice(0, 120)
}

function digestToolResults(
  toolResults: Array<{ name: string; result: unknown }>,
): Array<{ name: string; result: unknown }> {
  return toolResults.slice(0, 6).map((item) => {
    try {
      const raw = JSON.stringify(item.result ?? null)
      if (raw.length <= 2000) return { name: item.name, result: item.result }
      return { name: item.name, result: `${raw.slice(0, 2000)}…` }
    } catch {
      return { name: item.name, result: String(item.result).slice(0, 500) }
    }
  })
}

/**
 * Prefer local lenient parse; if still broken after tool-calling, one structured repair
 * (json_object + schema) so we don't drop a good web search to the heuristic template.
 */
async function parseAssistJsonOrRepair(
  raw: string,
  payload: Record<string, unknown>,
  toolResults: Array<{ name: string; result: unknown }>,
): Promise<GeneralAssistOutput> {
  try {
    return parseAssistJson(raw)
  } catch {
    const { data } = await chatStructured({
      system: `${GENERAL_ASSIST_SYSTEM}

【修复模式】上一次输出不是合法 JSON（常见：字符串内未转义的引号/换行）。
请根据用户问题与 toolResults 重新输出【一个】合法 JSON 对象；字符串内的双引号必须写成 \\"；不要 Markdown。`,
      user: JSON.stringify({
        ...payload,
        toolResults: digestToolResults(toolResults),
        brokenModelOutput: String(raw || '').slice(0, 6000),
      }),
      temperature: 0,
      maxTokens: 900,
      schema: generalAssistOutputSchema,
    })
    return data
  }
}

function looksLikeHotTopicRequest(text: string) {
  return /热点|热点话题|行业话题|时事|新闻|政策|集采|行情|趋势|话题/.test(text)
}

/** Offline / failure templates. Prefer specific topic matchers before loose「开场」. */
export function heuristicAssist(
  utterance: string,
  accountName?: string,
): {
  answer: string
  title: string
  sections: NonNullable<MessageUiBlock['sections']>
  followUps: string[]
  confidence: number
  emailDraft?: EmailDraftFields
} {
  const t = utterance.trim()
  const ctx = accountName ? `（当前对话客户：${accountName}）` : ''

  // Hot topics / industry chatter — must win over bare「开场」in the same sentence.
  if (looksLikeHotTopicRequest(t)) {
    return {
      title: '行业话题备忘',
      answer: `当前无法实时拉取新闻，先给你 3 个可跟医院客户开场聊的方向框架${ctx}。请自行核实最新政策与数据后再用。`,
      sections: [
        {
          heading: '说明',
          bullets: [
            {
              text: '以下不是实时热点稿，而是销售开场可用的话题骨架；联网恢复后可再问一次以获取更新线索。',
            },
          ],
        },
        {
          heading: '3 条可聊方向',
          bullets: [
            {
              text: '集采与预算窗口：科室本年度采购/招标节点、国产替代与预算切分怎么影响选型节奏。',
            },
            {
              text: '临床与运维痛点：报警疲劳、设备联网/数据互通、维保响应——用对方科室真实场景切入。',
            },
            {
              text: '质量与合规：不良事件上报、等保/数据安全、院内信息化验收对监护设备的新要求。',
            },
          ],
        },
        {
          heading: '建议',
          bullets: [
            {
              text: '开场只抛一个方向 + 一个具体问题（例如「你们科今年集采目录有没有动监护」），再衔接到你的产品证据。',
            },
          ],
        },
      ],
      followUps: [
        '把第 1 条改成 30 秒开场白',
        '对方说太贵怎么回',
        '帮我写一封拜访后的跟进邮件',
      ],
      confidence: 0.58,
    }
  }

  if (/邮件|email|跟进信|感谢信/i.test(t)) {
    const subject = `关于监护仪方案的进一步沟通${accountName ? `｜${accountName}` : ''}`
    const body = `张主任您好：

感谢今日交流。根据您提到的科室需求，我们整理了对应型号的配置与部署要点，方便您内部讨论。若方便，建议下周安排 30 分钟确认标书细节与交付节奏。我可按您的时间发送材料或约会议。

此致
敬礼`
    return {
      title: '跟进邮件草稿',
      answer: `已生成跟进邮件草稿${ctx}。可点击下方草稿编辑后发送。`,
      sections: [
        {
          heading: '结论',
          bullets: [{ text: '先致谢 → 复述对方兴趣点 → 约定下一步 → 附上你可提供的材料。' }],
        },
        {
          heading: '建议',
          bullets: [{ text: '发出前补上真实收件人邮箱、拜访日期、具体型号与你的联系方式。' }],
        },
      ],
      emailDraft: {
        to: '',
        subject,
        body,
      },
      followUps: ['把语气改得更正式一点', '改成微信跟进短消息', '仁济医院最近怎么样？'],
      confidence: 0.7,
    }
  }

  // Avoid bare「开场」— it collides with「开场聊热点」. Prefer explicit coaching cues.
  if (
    /话术|怎么讲|卖点|异议处理|开场话术|开场白|30\s*秒开场|一分钟开场/i.test(t) ||
    (/异议/.test(t) && /价格|竞品|太贵/.test(t))
  ) {
    return {
      title: '拜访话术要点',
      answer: `给你一套可用的沟通框架${ctx}。具体参数请以产品手册为准；客户信用/订单请改用「查客户」「查订单」。`,
      sections: [
        {
          heading: '结论',
          bullets: [{ text: '开场用对方场景切入，中段对齐痛点与证据，收尾约一个可执行的下一步。' }],
        },
        {
          heading: '要点',
          bullets: [
            { text: '开场：确认科室当前监护/设备痛点，而不是先推型号。' },
            { text: '证据：用同类医院部署案例 + 可量化指标（报警、联网、维护）。' },
            { text: '异议：价格 → 拆 TCO；竞品 → 比科室真正在用的功能，不空谈品牌。' },
          ],
        },
        {
          heading: '建议',
          bullets: [{ text: '结束时锁定「下次会议时间 / 需要的材料清单」。' }],
        },
      ],
      followUps: ['帮我写一段 N17 的 30 秒开场', '对方说太贵怎么回', '帮我写今日工作小结'],
      confidence: 0.68,
    }
  }

  if (/会议|准备|议程|demo|演示/i.test(t)) {
    return {
      title: '会议准备清单',
      answer: `会议前按下面清单准备即可${ctx}。若要查该客户开放商机或近访，请直接问「某某医院最近怎么样」。`,
      sections: [
        {
          heading: '结论',
          bullets: [{ text: '目标一句话写清，材料三件套，结束时要一个书面下一步。' }],
        },
        {
          heading: '要点',
          bullets: [
            { text: '目标：今天要对方确认什么（需求/预算窗口/下次评审）。' },
            { text: '材料：一页价值主张、配置清单、同类案例。' },
            { text: '角色：谁拍板、谁使用、谁关心交付。' },
          ],
        },
      ],
      followUps: ['帮我列一个 20 分钟 Demo 议程', '写一封会前确认邮件', '查一下仁济医院开放商机'],
      confidence: 0.66,
    }
  }

  return {
    title: '通用助手',
    answer: hasLlm()
      ? `我可以帮你写话术/邮件、做会议准备，或（若已配置联网）检索公开网页。你刚才说的「${t.slice(0, 40)}${t.length > 40 ? '…' : ''}」我这边需要更明确一点：是要文案、准备清单，还是查公开资料？`
      : `当前未配置聊天模型（DeepSeek / OpenAI），我只能给通用销售框架。你可以试：写跟进邮件、N17 开场话术、Demo 议程；查 CRM 客户请用「仁济医院最近怎么样？」`,
    sections: [
      {
        heading: '建议',
        bullets: [
          { text: 'CRM 事实（信用/订单/拜访）请走查客户 / 查订单 / 录入拜访。' },
          { text: '文案与准备类问题可以直接说目标对象与语气。' },
        ],
      },
    ],
    followUps: [
      '帮我写一封拜访后的跟进邮件',
      '监护仪开场话术怎么讲',
      '仁济医院最近怎么样？',
    ],
    confidence: 0.55,
  }
}

function normalizeEmailDraft(
  draft?: { to?: string; subject?: string; body?: string } | null,
): EmailDraftFields | undefined {
  if (!draft) return undefined
  const subject = String(draft.subject || '').trim()
  const body = String(draft.body || '').trim()
  if (!subject || !body) return undefined
  return {
    to: String(draft.to || '').trim(),
    subject,
    body,
  }
}

function buildMessage(params: {
  answer: string
  title?: string
  sections?: MessageUiBlock['sections']
  followUps?: string[]
  emailDraft?: EmailDraftFields
  confidence: number
  sources: SourceRef[]
  usedWeb: boolean
  mode: LlmSuccessMode | 'heuristic'
}): AgentMessage {
  const emailDraft = normalizeEmailDraft(params.emailDraft)
  const actions = emailDraft
    ? ([{ id: 'edit_send_email', label: '编辑并发送邮件' }] as MessageUiBlock['actions'])
    : undefined

  return {
    id: uid('msg'),
    role: 'assistant',
    agent_id: 'GeneralAssist',
    agent_name: '通用助手',
    content: params.answer,
    sources: params.sources,
    confidence: params.confidence,
    confidence_kind: 'answer',
    agent_chain: ['Orchestrator', '通用助手'],
    createdAt: new Date().toISOString(),
    ui: {
      type: 'general_assist',
      title: params.title || '助手答复',
      sections: params.sections,
      followUps: params.followUps,
      examples: params.followUps,
      emailDraft,
      actions,
      tone: params.usedWeb ? 'success' : 'info',
    },
  }
}

export const generalAssistAgent: DomainAgent = {
  name: 'GeneralAssist',
  displayName: '通用助手',
  description: '销售话术/邮件/会议准备与通用问答；可选网页 search/fetch',
  intents: ['general_assist'],
  async run(ctx) {
    const fallback = heuristicAssist(ctx.utterance, ctx.memory.accountName)
    const webTools = generalAssistTools()
    const webEnabled = hasWebSearch() || hasWebFetch()

    if (!hasLlm()) {
      return {
        messages: [
          buildMessage({
            ...fallback,
            sources: [],
            usedWeb: false,
            mode: 'heuristic',
          }),
        ],
        mode: 'heuristic',
        fallbackReason: 'LLM 未配置（DeepSeek / OpenAI）',
      }
    }

    const payload = {
      utterance: ctx.utterance,
      now: nowIsoInZone(),
      timezone: 'Asia/Shanghai',
      conversation: {
        accountName: ctx.memory.accountName || null,
        accountId: ctx.memory.accountId || null,
        lastIntent: ctx.memory.lastIntent || null,
        recentTurns: (ctx.history || []).slice(-4).map((turn) => ({
          role: turn.role,
          content: turn.content.slice(0, 200),
        })),
      },
      webToolsEnabled: {
        search: hasWebSearch(),
        fetch: hasWebFetch(),
      },
      crmHint: ctx.memory.accountName || null,
    }

    try {
      if (webTools.length > 0) {
        const { finalText, toolResults, mode: toolMode } = await chatWithTools({
          system: `${GENERAL_ASSIST_SYSTEM}\n\n${GENERAL_ASSIST_TOOL_ADDENDUM}

【输出】工具调用结束后，最终回复必须是单个合法 JSON 对象（不要 Markdown）。字符串内双引号请转义为 \\"。`,
          user: JSON.stringify(payload),
          tools: webTools,
          temperature: 0.4,
          maxTokens: 900,
          maxToolRounds: 3,
        })
        const data = await parseAssistJsonOrRepair(finalText, payload, toolResults)
        const usedWeb =
          data.usedWeb === true ||
          toolResults.some((item) => {
            const result = item.result as { enabled?: boolean; results?: unknown[]; text?: string }
            if (item.name === 'web_search') return Boolean(result?.enabled && result.results?.length)
            if (item.name === 'web_fetch') return Boolean(result?.enabled && result.text)
            return false
          })
        const sources: SourceRef[] = (data.sources || [])
          .filter((s) => s.label)
          .map((s) => ({
            kind: 'other' as const,
            label: s.label,
            ref: s.url,
          }))
        // Also surface tool URLs if model omitted sources.
        if (!sources.length) {
          for (const item of toolResults) {
            if (item.name !== 'web_search') continue
            const results = (item.result as { results?: Array<{ title?: string; url?: string }> })
              ?.results
            for (const row of results || []) {
              if (!row.title && !row.url) continue
              sources.push({
                kind: 'other',
                label: row.title || row.url || '网页',
                ref: row.url,
              })
            }
          }
        }
        const mode = toolMode || llmSuccessMode()
        return {
          messages: [
            buildMessage({
              answer: data.answer,
              title: data.title,
              sections: data.sections,
              followUps: data.followUps,
              emailDraft: normalizeEmailDraft(data.emailDraft),
              confidence: data.confidence ?? 0.75,
              sources: sources.slice(0, 6),
              usedWeb,
              mode,
            }),
          ],
          mode,
        }
      }

      const { data, mode } = await chatStructured({
        system: GENERAL_ASSIST_SYSTEM,
        user: JSON.stringify(payload),
        temperature: 0.4,
        maxTokens: 900,
        schema: generalAssistOutputSchema,
      })
      return {
        messages: [
          buildMessage({
            answer: data.answer,
            title: data.title,
            sections: data.sections,
            followUps: data.followUps,
            emailDraft: normalizeEmailDraft(data.emailDraft),
            confidence: data.confidence ?? 0.72,
            sources: (data.sources || []).map((s) => ({
              kind: 'other' as const,
              label: s.label,
              ref: s.url,
            })),
            usedWeb: false,
            mode,
          }),
        ],
        mode,
      }
    } catch (error) {
      const reason = formatGeneralAssistError(error)
      const failNote = webEnabled
        ? `（模型调用失败：${reason}；已回落模板，联网工具可能未使用。）`
        : `（模型调用失败：${reason}；已回落模板。）`
      return {
        messages: [
          buildMessage({
            ...fallback,
            answer: `${fallback.answer}\n\n${failNote}`,
            sources: [],
            usedWeb: false,
            mode: 'heuristic',
          }),
        ],
        mode: 'heuristic',
        fallbackReason: reason,
      }
    }
  },
}
