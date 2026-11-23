/**
 * Work summary Domain Agent.
 *
 * 1. Implement `run` (use tools/*, never call other agents).
 * 2. register(workSummaryAgent) in ./catalog.ts
 * 3. Add intent in types + intent.ts (if new route).
 * 4. Wire pipeline in orchestrator PIPELINES.
 * 5. Frontend: no change — still POST /api/orchestrate
 */
import type { DomainAgent } from './agentTypes.js'
import type { ActivityDraft, MessageUiBlock } from '../types.js'
import * as tools from '../tools/dataverseTools.js'
import { chatStructured, hasLlm } from '../llm/deepseek.js'
import type { LlmSuccessMode } from '../llm/types.js'
import { workSummaryOutputSchema } from '../llm/schemas.js'
import { WORK_SUMMARY_SYSTEM } from './prompts.js'
import { addDays, isoDateInZone, toIsoDate, todayIsoDate, zonedParts } from '../util/datetime.js'

function dateRangeForWeekly(now = new Date()) {
  const p = zonedParts(now)
  const start = addDays(p.year, p.month, p.day, -6)
  return `${toIsoDate(start.year, start.month, start.day)} ~ ${todayIsoDate(now)}`
}

export const workSummaryAgent: DomainAgent = {
  name: 'WorkSummary',
  displayName: '工作总结 Agent',
  description: '根据今日/本周活动草稿生成结构化工作总结（LLM 或启发式）',
  intents: ['work_summary'],
  async run(ctx) {
    const allDrafts = (await tools.listActivityDrafts()).filter(
      (draft) => draft.syncStatus !== 'Discarded',
    )
    const today = todayIsoDate()
    const weekly = /周报|本周|这周/.test(ctx.utterance)
    const rangeStart = weekly
      ? (() => {
          const p = zonedParts()
          const d = addDays(p.year, p.month, p.day, -6)
          return toIsoDate(d.year, d.month, d.day)
        })()
      : today
    const scoped = allDrafts.filter((draft) => {
      const date = isoDateInZone(draft.updatedAt || draft.createdAt)
      return date >= rangeStart && date <= today
    })
    const list = (scoped.length ? scoped : allDrafts).slice(0, 8)

    if (list.length === 0) {
      const message = {
        id: `msg_${Math.random().toString(36).slice(2, 10)}`,
        role: 'assistant' as const,
        agent_id: 'WorkSummary',
        agent_name: '工作总结 Agent',
        content: '今天还没有活动草稿。可以说一句拜访结果先录入，再让我帮你写总结。',
        sources: [],
        confidence: 0.72,
        confidence_kind: 'answer' as const,
        agent_chain: ['Orchestrator', '工作总结 Agent'],
        createdAt: new Date().toISOString(),
        ui: {
          type: 'clarify' as const,
          title: '还没有可总结的活动',
          question: '要先录入一条拜访吗？',
          examples: [
            '刚拜访仁济医院张主任，N17 要 12 台，下周三再约',
            '帮我写今日工作小结',
          ],
          tone: 'info' as const,
        },
      }
      return { messages: [message], mode: 'heuristic' as const }
    }

    const facts = list.map((draft) => ({
      id: draft.id,
      accountName: draft.accountName,
      contactName: draft.contactName,
      subject: draft.subject,
      summary: draft.summary,
      syncStatus: draft.syncStatus,
      confidence: draft.confidence,
      updatedAt: draft.updatedAt,
    }))

    let content: string
    let sections: NonNullable<MessageUiBlock['sections']>
    let mode: LlmSuccessMode | 'heuristic' = 'heuristic'
    let confidence = 0.8

    const fallback = heuristicSummary(ctx.utterance, list, weekly)
    content = fallback.content
    sections = fallback.sections

    if (hasLlm()) {
      try {
        const { data, mode: m } = await chatStructured({
          system: WORK_SUMMARY_SYSTEM,
          user: JSON.stringify({
            request: ctx.utterance,
            style: weekly ? 'weekly' : 'daily',
            dateRange: weekly ? dateRangeForWeekly() : today,
            timezone: 'Asia/Shanghai',
            activities: facts,
            instruction: '按本次请求口吻撰写，避免每次同一段套话；每个要点带活动 ID。',
          }),
          temperature: 0.35,
          maxTokens: 700,
          schema: workSummaryOutputSchema,
        })
        if (data.summary.trim()) {
          content = data.summary.trim()
          sections = (data.sections || []).map((section) => ({
            heading: section.heading,
            bullets: section.bullets.map((bullet) => ({
              text: bullet.text,
              activityId: bullet.activityId,
              status: bullet.status,
            })),
          }))
          mode = m
          confidence = Math.max(0, Math.min(1, data.confidence ?? 0.82))
        }
      } catch {
        content = fallback.content
        sections = fallback.sections
      }
    }

    const message = {
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      role: 'assistant' as const,
      agent_id: 'WorkSummary',
      agent_name: '工作总结 Agent',
      content,
      sources: list.slice(0, 5).map((draft) => ({
        kind: 'dataverse' as const,
        label: draft.subject,
        entity: 'crmai_activity',
        id: draft.id,
        ref: draft.idempotencyKey,
      })),
      confidence,
      confidence_kind: 'answer' as const,
      agent_chain: ['Orchestrator', '工作总结 Agent'],
      createdAt: new Date().toISOString(),
      ui: {
        type: 'work_summary' as const,
        title: weekly ? `本周工作小结 · ${list.length} 条活动` : `今日工作小结 · ${list.length} 条活动`,
        sections,
        footnote: '草稿状态的内容需确认后才算已核实；请提交前人工核对。',
      },
    }

    return {
      mode,
      messages: [message],
    }
  },
}

function heuristicSummary(
  utterance: string,
  list: ActivityDraft[],
  weekly: boolean,
): { content: string; sections: NonNullable<MessageUiBlock['sections']> } {
  const title = weekly
    ? `本周工作小结（基于 ${list.length} 条活动草稿）`
    : `今日工作小结（基于 ${list.length} 条活动草稿）`
  const bullets = list.map((draft) => {
    const focus = draft.summary?.trim() || draft.subject || `${draft.accountName} · ${draft.contactName}`
    const low = draft.confidence < 0.7 ? '（待确认）' : ''
    return {
      text: `${draft.accountName} / ${draft.contactName}：${focus}${low}`,
      activityId: draft.id,
      status: draft.syncStatus,
    }
  })
  return {
    content: [title, ...bullets.map((bullet, index) => `${index + 1}. ${bullet.text}`)].join('\n'),
    sections: [{ heading: weekly ? '本周要点' : '今日要点', bullets }],
  }
}
