import { readFileSync } from 'node:fs'
import { config } from '../config.js'
import type {
  AccountRecord,
  ActivityDraft,
  ContactRecord,
  ConversationRecord,
  InvocationLog,
  OpportunityDraft,
  OpportunityRecord,
  OrderRecord,
  ShipmentRecord,
  SyncStatus,
} from '../types.js'

type SeedFile = {
  accounts: AccountRecord[]
  contacts: ContactRecord[]
  opportunities: OpportunityRecord[]
  orders: OrderRecord[]
  shipments: ShipmentRecord[]
  activities: ActivityDraft[]
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function now() {
  return new Date().toISOString()
}

/**
 * In-memory Dataverse stand-in (普通表 VT 替身).
 * When DATAVERSE_URL is set, the same method names can later call Web API.
 */
export class DataverseStore {
  accounts: AccountRecord[] = []
  contacts: ContactRecord[] = []
  opportunities: OpportunityRecord[] = []
  orders: OrderRecord[] = []
  shipments: ShipmentRecord[] = []
  activities: ActivityDraft[] = []
  opportunityDrafts: OpportunityDraft[] = []
  logs: InvocationLog[] = []
  conversations = new Map<string, ConversationRecord>()

  loadSeed(seedPath = config.seedPath) {
    const raw = readFileSync(seedPath, 'utf-8')
    const seed = JSON.parse(raw) as SeedFile
    this.accounts = seed.accounts
    this.contacts = seed.contacts
    this.opportunities = seed.opportunities
    this.orders = seed.orders
    this.shipments = seed.shipments
    this.activities = seed.activities ?? []
    this.opportunityDrafts = []
    this.logs = []
    this.conversations.clear()
  }

  searchAccounts(query: string): AccountRecord[] {
    const q = query.trim().toLowerCase()
    if (!q) return [...this.accounts]
    return this.accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.externalKey.toLowerCase().includes(q) ||
        q.includes(a.name.toLowerCase()) ||
        (q.includes('仁济') && a.externalKey.includes('RENJI')) ||
        (q.includes('alpha') && a.externalKey.includes('ALPHA')),
    )
  }

  getAccount(idOrKey: string): AccountRecord | undefined {
    return this.accounts.find(
      (a) => a.id === idOrKey || a.externalKey === idOrKey || a.name === idOrKey,
    )
  }

  getContactsForAccount(accountId: string): ContactRecord[] {
    return this.contacts.filter((c) => c.accountId === accountId)
  }

  getOpportunitiesForAccount(accountId: string): OpportunityRecord[] {
    return this.opportunities.filter((o) => o.accountId === accountId)
  }

  findMatchingOpportunity(accountId: string, productHint?: string): OpportunityRecord | undefined {
    const hint = (productHint || '').toLowerCase()
    const list = this.getOpportunitiesForAccount(accountId)
    if (!hint) return list[0]
    return (
      list.find(
        (o) =>
          o.productModel?.toLowerCase().includes(hint) ||
          o.productLine.toLowerCase().includes(hint) ||
          hint.includes((o.productModel || '').toLowerCase()) ||
          o.name.toLowerCase().includes(hint),
      ) || list[0]
    )
  }

  getOrdersForAccount(accountId: string): OrderRecord[] {
    return this.orders.filter((o) => o.accountId === accountId)
  }

  getShipmentForOrder(orderId: string): ShipmentRecord | undefined {
    return this.shipments.find((s) => s.orderId === orderId)
  }

  listActivityDrafts(): ActivityDraft[] {
    return [...this.activities].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  listOpportunityDrafts(): OpportunityDraft[] {
    return [...this.opportunityDrafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  listAllDrafts() {
    return [...this.listActivityDrafts(), ...this.listOpportunityDrafts()]
  }

  upsertActivity(draft: ActivityDraft): ActivityDraft {
    const idx = this.activities.findIndex((d) => d.idempotencyKey === draft.idempotencyKey)
    const next = { ...draft, updatedAt: now() }
    if (idx >= 0) this.activities[idx] = next
    else this.activities.unshift(next)
    return next
  }

  upsertOpportunityDraft(draft: OpportunityDraft): OpportunityDraft {
    const idx = this.opportunityDrafts.findIndex((d) => d.idempotencyKey === draft.idempotencyKey)
    const next = { ...draft, updatedAt: now() }
    if (idx >= 0) this.opportunityDrafts[idx] = next
    else this.opportunityDrafts.unshift(next)
    return next
  }

  getDraftByKey(idempotencyKey: string): ActivityDraft | OpportunityDraft | undefined {
    return (
      this.activities.find((d) => d.idempotencyKey === idempotencyKey) ||
      this.opportunityDrafts.find((d) => d.idempotencyKey === idempotencyKey)
    )
  }

  updateDraftStatus(
    idempotencyKey: string,
    syncStatus: SyncStatus,
    patch?: {
      syncError?: string
      sapExternalId?: string
    },
  ): ActivityDraft | OpportunityDraft | null {
    const actIdx = this.activities.findIndex((d) => d.idempotencyKey === idempotencyKey)
    if (actIdx >= 0) {
      const current = this.activities[actIdx]
      const next: ActivityDraft = {
        ...current,
        syncStatus,
        updatedAt: now(),
        syncError: patch && 'syncError' in patch ? patch.syncError : current.syncError,
        sapExternalId: patch?.sapExternalId ?? current.sapExternalId,
      }
      this.activities[actIdx] = next
      return next
    }
    const oppIdx = this.opportunityDrafts.findIndex((d) => d.idempotencyKey === idempotencyKey)
    if (oppIdx >= 0) {
      const current = this.opportunityDrafts[oppIdx]
      const next: OpportunityDraft = {
        ...current,
        syncStatus,
        updatedAt: now(),
        syncError: patch && 'syncError' in patch ? patch.syncError : current.syncError,
        sapExternalId: patch?.sapExternalId ?? current.sapExternalId,
      }
      this.opportunityDrafts[oppIdx] = next
      return next
    }
    return null
  }

  async confirmAndSync(idempotencyKey: string, options?: { fail?: boolean }) {
    const draft = this.getDraftByKey(idempotencyKey)
    if (!draft) throw new Error('Draft not found')
    this.updateDraftStatus(idempotencyKey, 'Confirmed', { syncError: undefined })
    this.updateDraftStatus(idempotencyKey, 'Syncing')
    await delay(700)
    if (options?.fail) {
      return this.updateDraftStatus(idempotencyKey, 'SyncFailed', {
        syncError: 'SAP 校验失败（模拟）：请检查数量与客户信用后重试',
      })
    }
    return this.updateDraftStatus(idempotencyKey, 'Synced', {
      sapExternalId: `SAP-${Date.now().toString(36).toUpperCase()}`,
      syncError: undefined,
    })
  }

  discardDraft(idempotencyKey: string) {
    return this.updateDraftStatus(idempotencyKey, 'Discarded')
  }

  writeLog(row: Omit<InvocationLog, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) {
    const record: InvocationLog = {
      id: row.id ?? uid('log'),
      createdAt: row.createdAt ?? now(),
      sessionId: row.sessionId,
      agentName: row.agentName,
      inputSummary: row.inputSummary,
      outputEnvelope: row.outputEnvelope,
      latencyMs: row.latencyMs,
      success: row.success,
      confidence: row.confidence,
      errorMessage: row.errorMessage,
      promptVersion: row.promptVersion ?? config.promptVersion,
      modelName: row.modelName,
    }
    this.logs.unshift(record)
    this.logs = this.logs.slice(0, 300)
    return record
  }

  saveConversation(sessionKey: string, context: Record<string, string>, messages: unknown[]) {
    const existing = this.conversations.get(sessionKey)
    const record: ConversationRecord = {
      id: existing?.id ?? uid('conv'),
      sessionKey,
      contextJson: JSON.stringify(context),
      messagesJson: JSON.stringify(messages),
      lastMessageAt: now(),
    }
    this.conversations.set(sessionKey, record)
    return record
  }

  getConversation(sessionKey: string) {
    return this.conversations.get(sessionKey)
  }

  computeMetrics() {
    const drafts = this.listAllDrafts()
    const openDrafts = drafts.filter((d) => d.syncStatus === 'Draft').length
    const pendingSync = drafts.filter((d) =>
      ['Confirmed', 'Syncing', 'SyncFailed'].includes(d.syncStatus),
    ).length
    const decided = drafts.filter((d) => d.syncStatus !== 'Draft')
    const adopted = drafts.filter((d) =>
      ['Synced', 'Confirmed', 'Syncing', 'SyncFailed'].includes(d.syncStatus),
    )
    const riskOpportunities = [
      ...this.opportunities.filter((o) => o.confidenceScore < 0.7 || o.stage === 'Identify'),
      ...this.opportunityDrafts.filter(
        (o) => o.syncStatus !== 'Discarded' && (o.confidence < 0.7 || o.stage === 'Identify'),
      ),
    ].length
    const todayVisits = this.activities.filter((a) => a.syncStatus !== 'Discarded').length
    return {
      todayVisits,
      riskOpportunities,
      pendingSync,
      openDrafts,
      draftAdoptionPct:
        decided.length === 0 ? 0 : Math.round((adopted.length / Math.max(decided.length, 1)) * 100),
      accountCount: this.accounts.length,
      seedOpportunityCount: this.opportunities.filter((o) => o.isSeed).length,
    }
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export const store = new DataverseStore()
store.loadSeed()
