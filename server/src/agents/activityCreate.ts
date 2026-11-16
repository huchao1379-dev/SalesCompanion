import { config } from '../config.js'
import type { AccountRecord, ActivityDraft, ContactRecord, ExtractedVisit, SourceRef } from '../types.js'

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function nextWednesday(): string {
  const d = new Date()
  const day = d.getDay()
  const add = (3 - day + 7) % 7 || 7
  d.setDate(d.getDate() + add)
  return d.toISOString().slice(0, 10)
}

function todayWindow() {
  const start = new Date()
  start.setMinutes(0, 0, 0)
  const end = new Date(start)
  end.setHours(end.getHours() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

export function createActivityDraft(params: {
  utterance: string
  extracted: ExtractedVisit
  account?: AccountRecord
  contact?: ContactRecord
  sessionKey?: string
}): ActivityDraft {
  const { utterance, extracted, account, contact, sessionKey } = params
  const window = todayWindow()
  const stamp = new Date().toISOString()
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
    scheduledStart: window.start,
    scheduledEnd: window.end,
    followUpAt: extracted.followUpHint?.includes('周三') ? nextWednesday() : nextWednesday(),
    transcript: utterance,
    syncStatus: 'Draft',
    confidence: extracted.confidence,
    sources,
    agentName: '活动创建 Agent',
    idempotencyKey: uid('actkey'),
    sessionKey,
    promptVersion: config.promptVersion,
    createdAt: stamp,
    updatedAt: stamp,
  }
}
