import type { AgentResult, DomainAgent } from './agentTypes.js'
import type { ReviewAction, ReviewFinding } from '../types.js'
import { repository } from '../store/dataverseStore.js'
import * as tools from '../tools/dataverseTools.js'
import { isPastDate, todayIsoDate } from '../util/datetime.js'

function reviewStatus(findings: ReviewFinding[]) {
  if (findings.some((finding) => finding.severity === 'block')) return 'blocked' as const
  if (findings.some((finding) => finding.severity === 'warn')) return 'warn' as const
  return 'passed' as const
}

function uniqueHints(base: string[], findings: ReviewFinding[]) {
  const out = [...base]
  for (const finding of findings) {
    if (!out.includes(finding.message)) out.push(finding.message)
  }
  return out
}

/**
 * Review-Loop: independent supervisor that validates drafts before the user
 * confirms. Rules stay deterministic for the demo; an LLM narrative can be
 * layered later without changing the contract.
 */
export const opportunitySupervisorAgent: DomainAgent = {
  name: 'OpportunitySupervisor',
  displayName: '商机督导 Agent',
  description: '校验客户/重复/数量/阶段/日期，给出非阻断督导建议与推荐动作',
  async run(ctx): Promise<AgentResult> {
    const { activity, opportunity, account, existingOpportunity, extracted } = ctx.state
    if (!activity && !opportunity) return {}

    const findings: ReviewFinding[] = []
    const today = todayIsoDate()

    if (activity) {
      if (!account) {
        findings.push({
          code: 'missing_account',
          severity: 'block',
          field: 'accountName',
          message: '客户未在种子库解析，请先补全客户名称再确认。',
          suggestedAction: 'edit',
        })
      }
      if (!activity.contactName || activity.contactName === '待确认联系人') {
        findings.push({
          code: 'missing_contact',
          severity: 'warn',
          field: 'contactName',
          message: '联系人未确认，建议补全后再提交。',
          suggestedAction: 'edit',
        })
      }
      if (!activity.followUpAt) {
        findings.push({
          code: 'missing_follow_up',
          severity: 'warn',
          field: 'followUpAt',
          message: '未识别到下次跟进时间，建议补充。',
          suggestedAction: 'edit',
        })
      } else if (isPastDate(activity.followUpAt)) {
        findings.push({
          code: 'follow_up_in_past',
          severity: 'warn',
          field: 'followUpAt',
          message: `下次跟进时间 ${activity.followUpAt} 已过去，请改到未来日期。`,
          suggestedAction: 'edit',
        })
      }

      const duplicates = (await repository.listActivityDrafts()).filter((draft) => {
        if (draft.idempotencyKey === activity.idempotencyKey) return false
        if (draft.syncStatus === 'Discarded') return false
        const sameAccount =
          draft.accountName === activity.accountName ||
          (draft.accountId && draft.accountId === activity.accountId)
        const sameContact =
          !activity.contactName ||
          !draft.contactName ||
          draft.contactName === activity.contactName
        const withinDay =
          Math.abs(new Date(draft.createdAt).getTime() - new Date(activity.createdAt).getTime()) <
          24 * 60 * 60 * 1000
        return sameAccount && sameContact && withinDay
      })
      if (duplicates.length > 0) {
        findings.push({
          code: 'duplicate_activity',
          severity: 'warn',
          message: `24 小时内已有 ${duplicates.length} 条同客户/同联系人活动，可能重复录入。`,
          suggestedAction: 'edit',
        })
      }
    }

    if (opportunity) {
      if (opportunity.quantity <= 0) {
        findings.push({
          code: 'missing_quantity',
          severity: 'warn',
          field: 'quantity',
          message: '商机数量未确认，建议补全台数。',
          suggestedAction: 'edit',
        })
      }
      if (opportunity.estimatedValue <= 0) {
        findings.push({
          code: 'missing_amount',
          severity: 'warn',
          field: 'estimatedValue',
          message: '预计金额为空，建议补全或标注待核实。',
          suggestedAction: 'edit',
        })
      }
      if (opportunity.closeDate && opportunity.closeDate < today) {
        findings.push({
          code: 'close_date_in_past',
          severity: 'warn',
          field: 'closeDate',
          message: `预计成交日 ${opportunity.closeDate} 已过去，建议更新。`,
          suggestedAction: 'edit',
        })
      }
      if (existingOpportunity) {
        findings.push({
          code: 'existing_opportunity',
          severity: 'info',
          field: 'existingOpportunityRef',
          message: `已存在商机 ${existingOpportunity.externalKey || existingOpportunity.name}（${existingOpportunity.stage}），确认时将关联活动证据而不是新建重复商机。`,
          suggestedAction: 'link_existing',
        })
        const quantity = opportunity.quantity || existingOpportunity.quantity
        if (
          existingOpportunity.stage === 'Identify' &&
          (quantity >= 8 || account?.creditLevel === 'A')
        ) {
          findings.push({
            code: 'stage_upgrade_hint',
            severity: 'info',
            field: 'stage',
            message: `${quantity} 台 + 信用 ${account?.creditLevel || '?'} → 建议评估升级到 Qualify；仅为建议，不阻断确认。`,
            suggestedAction: 'update_stage',
          })
        }
      } else if (extracted?.productModel || extracted?.productLine) {
        findings.push({
          code: 'new_opportunity',
          severity: 'info',
          message: '未命中既有商机，将创建新商机草稿；请在确认前核对产品与数量。',
          suggestedAction: 'create',
        })
      }
    }

    const status = reviewStatus(findings)
    const recommendedAction: ReviewAction = findings.some((finding) => finding.severity === 'block')
      ? 'edit'
      : existingOpportunity
        ? 'link_existing'
        : 'create'

    const updatedActivity = activity
      ? {
          ...activity,
          reviewStatus: status,
          reviewFindings: findings,
        }
      : undefined
    const updatedOpportunity = opportunity
      ? {
          ...opportunity,
          reviewStatus: status,
          reviewFindings: findings,
          recommendedAction,
          supervisorHints: uniqueHints(opportunity.supervisorHints || [], findings),
        }
      : undefined

    if (updatedActivity) await tools.upsertActivityDraft(updatedActivity)
    if (updatedOpportunity) await tools.upsertOpportunityDraft(updatedOpportunity)

    return {
      drafts: [
        ...(updatedActivity ? [updatedActivity] : []),
        ...(updatedOpportunity ? [updatedOpportunity] : []),
      ],
      statePatch: {
        activity: updatedActivity,
        opportunity: updatedOpportunity,
        review: findings,
      },
      review: findings,
    }
  },
}
