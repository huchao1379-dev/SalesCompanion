import type { DraftPayload } from '../agents/types'
import { listMockAccounts } from './accounts'
import { computeHomeMetrics } from './metrics'

export type BriefChapter = {
  title: string
  summary: string
  points: string[]
  metrics: string[]
}

export function buildBriefChapters(drafts: DraftPayload[]): BriefChapter[] {
  const metrics = computeHomeMetrics(drafts)
  const accounts = listMockAccounts()
  const openDrafts = drafts.filter((d) => d.syncStatus === 'Draft')
  const riskOpps = drafts.filter(
    (d) =>
      d.kind === 'opportunity' &&
      d.syncStatus !== 'Discarded' &&
      (d.confidence < 0.7 || d.stage === 'Identify'),
  )
  const failed = drafts.filter((d) => d.syncStatus === 'SyncFailed')

  const focusPoints: string[] = []
  if (openDrafts.length) {
    focusPoints.push(`有 ${openDrafts.length} 条 AI 草稿待确认`)
  }
  accounts.slice(0, 2).forEach((a) => {
    focusPoints.push(
      `${a.accountName} — 近 30 天 ${a.visitCount30d} 次拜访 · 信用 ${a.creditRating}`,
    )
  })
  if (!focusPoints.length) {
    focusPoints.push('今日暂无本地草稿；可从「新拜访录入」开始 Voice-First 路径')
  }

  const riskPoints =
    riskOpps.length > 0
      ? riskOpps.slice(0, 4).map((d) => {
          if (d.kind !== 'opportunity') return ''
          return `${d.accountName} · ${d.productLine} — ${d.stage}（信心度 ${(d.confidence * 100).toFixed(0)}%）`
        })
      : ['暂无风险商机；保持跟进节奏即可']

  const syncPoints =
    failed.length > 0
      ? failed.map((d) => {
          const title = d.kind === 'activity' ? d.subject : d.name
          return `${title} — ${d.syncError ?? '同步失败，可重试'}`
        })
      : metrics.pendingSync > 0
        ? [`待同步 ${metrics.pendingSync} 条，请到「任务」查看进度`]
        : ['同步队列空闲']

  return [
    {
      title: '今日重点',
      summary: `指标分析 Agent：今日拜访 ${metrics.todayVisits} · 待确认草稿 ${metrics.openDrafts} · 风险商机 ${metrics.riskOpportunities}。`,
      points: focusPoints,
      metrics: [
        `拜访 ${metrics.todayVisits}`,
        `风险 ${metrics.riskOpportunities}`,
        `草稿 ${metrics.openDrafts}`,
      ],
    },
    {
      title: '风险商机',
      summary: '商机评估 Agent：识别阶段偏低或信心度下降的开放商机，建议会前核对采购窗口。',
      points: riskPoints.filter(Boolean),
      metrics: [`风险 ${riskOpps.length}`, `待跟进 ${openDrafts.length}`],
    },
    {
      title: '同步与补偿',
      summary: '同步状态机：Confirm 后进入 Syncing；失败可重试，不直写 SAP。',
      points: syncPoints,
      metrics: [`待同步 ${metrics.pendingSync}`, `采纳 ${metrics.draftAdoptionPct}%`],
    },
  ]
}
