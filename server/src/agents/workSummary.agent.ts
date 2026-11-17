/**
 * Template Domain Agent — copy this file to add your own.
 *
 * Steps:
 * 1. Implement `run` (use tools/*, never call other agents).
 * 2. register(workSummaryAgent) in ./catalog.ts
 * 3. Add intent in types + intent.ts (if new route).
 * 4. Wire pipeline in orchestrator PIPELINES.
 * 5. Frontend: no change — still POST /api/orchestrate
 */
import type { DomainAgent } from './agentTypes.js'
import * as tools from '../tools/dataverseTools.js'
import { chatJson, hasDeepSeek } from '../llm/deepseek.js'

export const workSummaryAgent: DomainAgent = {
  name: 'WorkSummary',
  displayName: '工作总结 Agent',
  description: '根据今日活动/草稿生成简短工作总结（DeepSeek 或启发式）',
  intents: ['work_summary'],
  async run(ctx) {
    const drafts = tools.listActivityDrafts().filter((d) => d.syncStatus !== 'Discarded')
    const today = new Date().toISOString().slice(0, 10)
    const todays = drafts.filter((d) => (d.updatedAt || d.createdAt).startsWith(today))
    const list = (todays.length ? todays : drafts).slice(0, 5)

    if (list.length === 0) {
      return {
        messages: [
          {
            id: `msg_${Math.random().toString(36).slice(2, 10)}`,
            role: 'assistant',
            agent_name: '工作总结 Agent',
            content:
              '今天还没有活动草稿。可以说一句拜访结果先录入，再让我帮你写总结。',
            sources: [],
            confidence: 0.7,
            agent_chain: ['Orchestrator', '工作总结 Agent'],
            createdAt: new Date().toISOString(),
          },
        ],
        mode: 'heuristic',
      }
    }

    const facts = list.map((d) => ({
      accountName: d.accountName,
      contactName: d.contactName,
      subject: d.subject,
      summary: d.summary,
      syncStatus: d.syncStatus,
      confidence: d.confidence,
    }))

    let content: string
    let mode: 'deepseek' | 'heuristic' = 'heuristic'
    let confidence = 0.8

    if (hasDeepSeek()) {
      try {
        const { data, mode: m } = await chatJson<{ summary: string; confidence?: number }>({
          system: `你是销售工作总结 Agent。根据活动草稿写简洁中文日报/周报素材（3～6 行），不要编造未给出的事实。只输出 JSON：{"summary":"...","confidence":0-1}`,
          user: JSON.stringify({
            request: ctx.utterance,
            style: ctx.utterance.includes('周报') ? 'weekly' : 'daily',
            activities: facts,
          }),
          temperature: 0.3,
        })
        if (data.summary?.trim()) {
          content = data.summary.trim()
          mode = m
          confidence = Math.max(0, Math.min(1, data.confidence ?? 0.82))
        } else {
          content = heuristicSummary(ctx.utterance, list)
        }
      } catch {
        content = heuristicSummary(ctx.utterance, list)
      }
    } else {
      content = heuristicSummary(ctx.utterance, list)
    }

    return {
      mode,
      messages: [
        {
          id: `msg_${Math.random().toString(36).slice(2, 10)}`,
          role: 'assistant',
          agent_name: '工作总结 Agent',
          content,
          sources: list.slice(0, 3).map((d) => ({
            kind: 'dataverse' as const,
            label: d.subject,
            entity: 'crmai_activity',
            id: d.id,
            ref: d.idempotencyKey,
          })),
          confidence,
          agent_chain: ['Orchestrator', '工作总结 Agent'],
          createdAt: new Date().toISOString(),
        },
      ],
    }
  },
}

function heuristicSummary(
  utterance: string,
  list: Array<{
    accountName: string
    contactName: string
    syncStatus: string
    confidence: number
  }>,
) {
  const lines = list.map(
    (d, i) =>
      `${i + 1}. ${d.accountName} · ${d.contactName} · ${d.syncStatus}（信心 ${(d.confidence * 100).toFixed(0)}%）`,
  )
  return [
    `工作总结（基于 ${list.length} 条活动草稿）：`,
    ...lines,
    utterance.includes('周报') ? '以上可作周报素材，Confirm 前请人工润色。' : '以上可作日报素材。',
  ].join('\n')
}
