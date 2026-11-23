/**
 * Tier-1 Compose — synthesize a short coherent reply from multi-agent results.
 * Template-first for Demo stability; optional LLM polish when DeepSeek is up.
 */
import { z } from 'zod'
import { chatStructured, hasLlm } from '../llm/deepseek.js'
import type { AgentContext } from './agentTypes.js'
import type { AgentMessage, SourceRef } from '../types.js'
import { COMPOSE_SYSTEM, promptVersion } from './prompts/index.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
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

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}

/** Build a 1–2 sentence overview for fan-out account queries. */
export function composeAccountOverview(messages: AgentMessage[], ctx: AgentContext): string {
  const accountName =
    ctx.state.account?.name ||
    ctx.memory.accountName ||
    messages.find((m) => m.ui?.accountKey)?.ui?.title ||
    messages.find((m) => m.agent_id === 'AccountProfile')?.ui?.title ||
    '该客户'

  const profile = messages.find((m) => m.agent_id === 'AccountProfile' || m.ui?.type === 'account_pulse')
  const pulse = messages.find((m) => m.agent_id === 'OpportunityPulse' || m.ui?.type === 'opportunity_list')

  const credit = profile?.ui?.metrics?.find((m) => /信用/.test(m.label))?.value
  const visits = profile?.ui?.metrics?.find((m) => /拜访|近访/.test(m.label))?.value
  const oppCount = pulse?.ui?.metrics?.find((m) => /开放商机|商机/.test(m.label))?.value
  const oppAmount = pulse?.ui?.metrics?.find((m) => /金额|合计/.test(m.label))?.value

  const bits: string[] = [`${accountName}速览：`]
  if (credit) bits.push(`信用 ${credit}`)
  if (visits) bits.push(`近访 ${visits}`)
  if (oppCount) bits.push(`开放商机 ${oppCount}${oppAmount && oppAmount !== '—' ? `（约 ${oppAmount}）` : ''}`)
  if (bits.length === 1) {
    const fallback = [profile?.content, pulse?.content].filter(Boolean).join(' ')
    return fallback.slice(0, 180) || `${accountName} 已查询完毕，详见下方卡片。`
  }
  return `${bits[0]}${bits.slice(1).join('，')}。详情见下方画像与商机卡片。`
}

const composeSchema = z.object({
  overview: z.string().min(1).max(280),
})

/** Optional LLM polish; falls back to template on any failure. */
export async function maybePolishOverview(
  template: string,
  messages: AgentMessage[],
  utterance: string,
): Promise<{ overview: string; mode: 'deepseek' | 'openai' | 'heuristic'; promptVersion: string }> {
  const version = promptVersion('compose')
  if (!hasLlm()) {
    return { overview: template, mode: 'heuristic', promptVersion: version }
  }
  try {
    const snippets = messages
      .map((m) => `${m.agent_name}: ${m.content.slice(0, 160)}`)
      .join('\n')
    const { data, mode } = await chatStructured({
      system: COMPOSE_SYSTEM,
      user: JSON.stringify({ utterance, template, agentSnippets: snippets }),
      temperature: 0.2,
      maxTokens: 220,
      schema: composeSchema,
    })
    return { overview: data.overview.trim() || template, mode, promptVersion: version }
  } catch {
    return { overview: template, mode: 'heuristic', promptVersion: version }
  }
}

/**
 * For query_account fan-out: prepend one Orchestrator compose message,
 * keep detail cards, merge sources/confidence onto the overview.
 */
export async function composeQueryAccountMessages(
  messages: AgentMessage[],
  ctx: AgentContext,
): Promise<{ messages: AgentMessage[]; mode: 'deepseek' | 'openai' | 'heuristic'; promptVersion: string }> {
  if (messages.length === 0) {
    return { messages, mode: 'heuristic', promptVersion: promptVersion('compose') }
  }

  const template = composeAccountOverview(messages, ctx)
  const polished = await maybePolishOverview(template, messages, ctx.utterance)
  const sources = dedupeSources(messages.flatMap((m) => m.sources || []))
  const confidence = clamp(
    messages.reduce((min, m) => Math.min(min, m.confidence > 0 ? m.confidence : 1), 1),
  )
  const chain = [
    'Orchestrator',
    ...messages.map((m) => m.agent_id || m.agent_name).filter(Boolean),
  ]

  const overview: AgentMessage = {
    id: uid('msg'),
    role: 'assistant',
    agent_id: 'Orchestrator',
    agent_name: '销售 Copilot',
    content: polished.overview,
    sources: sources.length
      ? sources
      : [{ kind: 'other', label: '无来源', ref: 'none' }],
    confidence: sources.length ? confidence : Math.min(confidence, 0.45),
    confidence_kind: 'composite',
    agent_chain: [...new Set(chain)],
    createdAt: new Date().toISOString(),
  }

  // Detail cards keep their own agent labels; strip duplicate long prose if identical.
  const details = messages.map((message) => ({
    ...message,
    // Keep card content short when overview already covers the gist.
    content:
      message.content.length > 120 && message.ui
        ? message.content.slice(0, 100).replace(/\s+$/, '') + '…'
        : message.content,
  }))

  return {
    messages: [overview, ...details],
    mode: polished.mode,
    promptVersion: polished.promptVersion,
  }
}
