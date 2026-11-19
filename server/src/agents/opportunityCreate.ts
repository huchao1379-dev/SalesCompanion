import type {
  AccountRecord,
  ActivityDraft,
  ExtractedVisit,
  OpportunityDraft,
  OpportunityRecord,
  SourceRef,
} from '../types.js'
import { addDays, toIsoDate, zonedParts } from '../util/datetime.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function defaultCloseDate() {
  const p = zonedParts()
  const d = addDays(p.year, p.month, p.day, 90)
  return toIsoDate(d.year, d.month, d.day)
}

/** Demo unit price; replace with a product catalog before production. */
const DEMO_UNIT_PRICE = 12000

export function createOpportunityDraft(params: {
  extracted: ExtractedVisit
  account?: AccountRecord
  existing?: OpportunityRecord
  activity: ActivityDraft
  sessionKey?: string
  idempotencyKey?: string
}): OpportunityDraft {
  const { extracted, account, existing, activity, sessionKey, idempotencyKey } = params
  const stamp = new Date().toISOString()
  const accountName = account?.name || extracted.accountName || activity.accountName
  const productLine = extracted.productLine || existing?.productLine || '待确认产品线'
  const productModel = extracted.productModel || existing?.productModel
  const quantity = extracted.quantity || existing?.quantity || 0
  const estimatedValue = existing?.amount || quantity * DEMO_UNIT_PRICE
  const reuseExisting = Boolean(existing)
  const supervisorHints: string[] = []

  if (existing) {
    supervisorHints.push(
      `已存在商机 ${existing.externalKey || existing.name}（${existing.stage}）— 建议追加为本活动证据，不新建商机`,
    )
    if (existing.stage === 'Identify' && (account?.creditLevel === 'A' || quantity >= 8)) {
      supervisorHints.push(
        `${quantity || existing.quantity} 台 + 信用 ${account?.creditLevel || '?'} → 建议升级到 Qualify，下一步发送报价`,
      )
    }
  } else {
    supervisorHints.push('未命中既有商机种子，将创建新商机草稿；Confirm 前请核对产品与数量')
  }

  const sources: SourceRef[] = [...activity.sources]
  if (existing) {
    sources.push({
      kind: 'dataverse',
      label: `${existing.name} · ${existing.stage}`,
      ref: existing.externalKey,
      entity: 'crmai_opportunity',
      id: existing.id,
    })
  }

  return {
    kind: 'opportunity',
    id: uid('opp'),
    name: `${accountName} · ${[productLine, productModel].filter(Boolean).join(' ')}`,
    accountName,
    accountRef: account?.externalKey,
    accountId: account?.id,
    productLine,
    productModel,
    quantity,
    estimatedValue,
    currency: existing?.currencyCode || 'USD',
    stage: existing?.stage || 'Identify',
    closeDate: existing?.closeDate || defaultCloseDate(),
    confidence: Math.min(0.92, (extracted.confidence + (existing?.confidenceScore || 0.7)) / 2),
    reuseExisting,
    existingOpportunityRef: existing?.externalKey || existing?.id,
    supervisorHints,
    syncStatus: 'Draft',
    sources,
    agentName: '商机创建 Agent',
    idempotencyKey: idempotencyKey || uid('oppkey'),
    linkedActivityKey: activity.idempotencyKey,
    linkedActivityId: activity.id,
    sessionKey,
    recommendedAction: reuseExisting ? 'link_existing' : 'create',
    createdAt: stamp,
    updatedAt: stamp,
  }
}
