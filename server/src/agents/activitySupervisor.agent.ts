/**
 * Light ActivitySupervisor — Review-Loop for visit drafts before opportunity
 * rules. Deterministic findings only (Demo-stable).
 */
import type { AgentResult, DomainAgent } from './agentTypes.js'
import type { ReviewFinding } from '../types.js'
import { isPastDate } from '../util/datetime.js'

function reviewStatus(findings: ReviewFinding[]) {
  if (findings.some((f) => f.severity === 'block')) return 'blocked' as const
  if (findings.some((f) => f.severity === 'warn')) return 'warn' as const
  return 'passed' as const
}

export const activitySupervisorAgent: DomainAgent = {
  name: 'ActivitySupervisor',
  displayName: '活动督导 Agent',
  description: '校验活动草稿必填项与跟进日期（非阻断为主）',
  async run(ctx): Promise<AgentResult> {
    const activity = ctx.state.activity
    if (!activity) return {}

    const findings: ReviewFinding[] = []

    if (!activity.accountName || activity.accountName === '待确认客户') {
      findings.push({
        code: 'activity_missing_account',
        severity: 'block',
        field: 'accountName',
        message: '活动草稿缺少客户名称，请补全后再确认。',
        suggestedAction: 'edit',
      })
    }
    if (!activity.summary || activity.summary.length < 4) {
      findings.push({
        code: 'activity_thin_summary',
        severity: 'warn',
        field: 'summary',
        message: '拜访摘要过短，建议补充关键结论后再提交。',
        suggestedAction: 'edit',
      })
    }
    if (activity.followUpAt && isPastDate(activity.followUpAt)) {
      findings.push({
        code: 'activity_follow_up_past',
        severity: 'warn',
        field: 'followUpAt',
        message: `跟进日 ${activity.followUpAt} 已过去，请改到未来日期。`,
        suggestedAction: 'edit',
      })
    }

    const status = reviewStatus(findings)
    const nextActivity = {
      ...activity,
      reviewStatus: status,
      reviewFindings: findings,
    }

    return {
      mode: 'heuristic',
      review: findings,
      statePatch: { activity: nextActivity, review: findings },
      drafts: [nextActivity],
    }
  },
}
