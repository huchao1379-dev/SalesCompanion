/**
 * General assistant Domain Agent — sales coaching, writing help, optional web tools.
 */
import type { DomainAgent } from './agentTypes.js'
import type { AgentMessage, MessageUiBlock, SourceRef } from '../types.js'
import { chatStructured, chatWithTools, hasDeepSeek } from '../llm/deepseek.js'
import { generalAssistOutputSchema } from '../llm/schemas.js'
import { GENERAL_ASSIST_SYSTEM, GENERAL_ASSIST_TOOL_ADDENDUM } from './prompts.js'
import { generalAssistTools } from '../tools/webTools.js'
import { hasWebFetch, hasWebSearch } from '../config.js'
import { nowIsoInZone } from '../util/datetime.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function parseAssistJson(raw: string) {
  const trimmed = raw.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence?.[1]?.trim() || trimmed
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('No JSON object in model output')
  return generalAssistOutputSchema.parse(JSON.parse(body.slice(start, end + 1)))
}

function heuristicAssist(utterance: string, accountName?: string): {
  answer: string
  title: string
  sections: NonNullable<MessageUiBlock['sections']>
  followUps: string[]
  confidence: number
} {
  const t = utterance.trim()
  const ctx = accountName ? `（当前对话客户：${accountName}）` : ''

  if (/邮件|email|跟进信|感谢信/i.test(t)) {
    return {
      title: '跟进邮件草稿',
      answer: `下面是一封可直接改写发送的跟进邮件草稿${ctx}。请按真实拜访内容核对后发送——这不是 CRM 里的已确认事实。`,
      sections: [
        {
          heading: '结论',
          bullets: [{ text: '先致谢 → 复述对方兴趣点 → 约定下一步 → 附上你可提供的材料。' }],
        },
        {
          heading: '建议正文',
          bullets: [
            {
              text: `主题：关于监护仪方案的进一步沟通${accountName ? `｜${accountName}` : ''}`,
            },
            {
              text: '张主任您好：感谢今日交流。根据您提到的科室需求，我们整理了对应型号的配置与部署要点，方便您内部讨论。若方便，建议下周安排 30 分钟确认标书细节与交付节奏。我可按您的时间发送材料或约会议。',
            },
          ],
        },
        {
          heading: '建议',
          bullets: [{ text: '发出前补上真实拜访日期、具体型号与你的联系方式。' }],
        },
      ],
      followUps: ['把语气改得更正式一点', '改成微信跟进短消息', '仁济医院最近怎么样？'],
      confidence: 0.7,
    }
  }

  if (/话术|怎么讲|卖点|开场|异议/i.test(t)) {
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
    answer: hasDeepSeekHint()
      ? `我可以帮你写话术/邮件、做会议准备，或（若已配置联网）检索公开网页。你刚才说的「${t.slice(0, 40)}${t.length > 40 ? '…' : ''}」我这边需要更明确一点：是要文案、准备清单，还是查公开资料？`
      : `当前未配置 DeepSeek，我只能给通用销售框架。你可以试：写跟进邮件、N17 开场话术、Demo 议程；查 CRM 客户请用「仁济医院最近怎么样？」`,
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

function hasDeepSeekHint() {
  return hasDeepSeek()
}

function buildMessage(params: {
  answer: string
  title?: string
  sections?: MessageUiBlock['sections']
  followUps?: string[]
  confidence: number
  sources: SourceRef[]
  usedWeb: boolean
  mode: 'deepseek' | 'heuristic'
}): AgentMessage {
  const webOffNote = !hasWebSearch() && !hasWebFetch()
    ? '当前未配置 WEB_SEARCH_API_KEY，无法实时联网检索。'
    : !params.usedWeb
      ? '本次未使用网页检索。'
      : ''
  const footnote = params.usedWeb
    ? '部分内容来自公开网页检索，请自行核实。'
    : params.mode === 'heuristic'
      ? `规则/模板答复（非实时网页，也未写入 CRM）。${webOffNote}`
      : `基于模型知识的助手答复，非 CRM 种子事实。${webOffNote}请核实后再用于对外沟通。`

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
      tone: params.usedWeb ? 'success' : 'info',
      footnote,
      originLabel: params.usedWeb ? '网页 + 助手' : '通用助手',
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

    if (!hasDeepSeek()) {
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
        const { finalText, toolResults } = await chatWithTools({
          system: `${GENERAL_ASSIST_SYSTEM}\n\n${GENERAL_ASSIST_TOOL_ADDENDUM}`,
          user: JSON.stringify(payload),
          tools: webTools,
          temperature: 0.4,
          maxTokens: 900,
          maxToolRounds: 3,
        })
        const data = parseAssistJson(finalText)
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
        return {
          messages: [
            buildMessage({
              answer: data.answer,
              title: data.title,
              sections: data.sections,
              followUps: data.followUps,
              confidence: data.confidence ?? 0.75,
              sources: sources.slice(0, 6),
              usedWeb,
              mode: 'deepseek',
            }),
          ],
          mode: 'deepseek',
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
    } catch {
      return {
        messages: [
          buildMessage({
            ...fallback,
            answer: webEnabled
              ? `${fallback.answer}\n\n（模型调用失败，已回落模板；联网工具可能未使用。）`
              : fallback.answer,
            sources: [],
            usedWeb: false,
            mode: 'heuristic',
          }),
        ],
        mode: 'heuristic',
      }
    }
  },
}
