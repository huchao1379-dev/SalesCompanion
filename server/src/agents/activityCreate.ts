import { config } from '../config.js'
import type { AccountRecord, ActivityDraft, ContactRecord, ExtractedVisit, SourceRef } from '../types.js'
import { nowIsoInZone } from '../util/datetime.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function endOfVisit(startIso: string) {
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return undefined
  return new Date(start.getTime() + 60 * 60 * 1000).toISOString()
}

export function createActivityDraft(params: {
  utterance: string
  extracted: ExtractedVisit
  account?: AccountRecord
  contact?: ContactRecord
  sessionKey?: string
  idempotencyKey?: string
}): ActivityDraft {
  const { utterance, extracted, account, contact, sessionKey, idempotencyKey } = params
  const stamp = new Date().toISOString()
  const occurredAt = extracted.occurredAt || nowIsoInZone()
  const accountName = account?.name || extracted.accountName || '待确认客户'
  const contactName = contact?.name || extracted.contactName || '待确认联系人'
  const product =
    [extracted.productLine, extracted.productModel].filter(Boolean).join(' ') || '产品待确认'
  const subject = `拜访${accountName} · ${contactName} · ${product}`

  const sources: SourceRef[] = []
  if (account) {
    sources.push({
      kind: 'dataverse',
      label: `${account.name} · Account`,
      ref: account.externalKey,
      entity: 'crmai_account',
      id: account.id,
    })
    sources.push({
      kind: 'dataverse',
      label: `近 30 天拜访 ×${account.visitCount30d}`,
      entity: 'crmai_account',
      id: account.id,
    })
  } else {
    sources.push({ kind: 'other', label: '语音转写', ref: 'speech' })
  }

  return {
    kind: 'activity',
    id: uid('act'),
    subject,
    summary: extracted.summary || utterance,
    visitType: extracted.visitType || 'Visit',
    accountName,
    accountRef: account?.externalKey,
    accountId: account?.id,
    contactName,
    contactId: contact?.id,
    occurredAt,
    scheduledStart: occurredAt,
    scheduledEnd: endOfVisit(occurredAt),
    followUpAt: extracted.followUpAt || '',
    transcript: utterance,
    syncStatus: 'Draft',
    confidence: extracted.confidence,
    sources,
    agentName: '活动创建 Agent',
    idempotencyKey: idempotencyKey || uid('actkey'),
    sessionKey,
    promptVersion: config.promptVersion,
    createdAt: stamp,
    updatedAt: stamp,
  }
}
