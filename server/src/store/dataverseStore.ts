import { readFileSync } from 'node:fs'
import { config } from '../config.js'
import type { SalesRepository } from './repository.js'
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
 * Seed-backed in-memory implementation of the persistence boundary.
 */
export class SeedMemoryRepository implements SalesRepository {
  readonly mode = 'seed-memory' as const
  accounts: AccountRecord[] = []
  contacts: ContactRecord[] = []
  opportunities: OpportunityRecord[] = []
  orders: OrderRecord[] = []
  shipments: ShipmentRecord[] = []
  activities: ActivityDraft[] = []
  opportunityDrafts: OpportunityDraft[] = []
  logs: InvocationLog[] = []
  conversations = new Map<string, ConversationRecord>()

  constructor() {
    this.loadSeed()
  }

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

  async reloadSeed(): Promise<number> {
    this.loadSeed()
    return this.accounts.length
  }

  async listAccounts(): Promise<AccountRecord[]> {
    return [...this.accounts]
  }

  async listOpportunities(): Promise<OpportunityRecord[]> {
    return [...this.opportunities]
  }

  async listOrders(): Promise<OrderRecord[]> {
    return [...this.orders]
  }

  async listShipments(): Promise<ShipmentRecord[]> {
    return [...this.shipments]
  }

  async searchAccounts(query: string): Promise<AccountRecord[]> {
    const q = query.trim().toLowerCase()
    if (!q) return [...this.accounts]
    return this.accounts.filter(
      (a) => {
        const alias = a.externalKey.split(/[-_]/).at(-1)?.toLowerCase()
        return a.name.toLowerCase().includes(q) ||
          a.externalKey.toLowerCase().includes(q) ||
          q.includes(a.name.toLowerCase()) ||
          Boolean(alias && q.includes(alias))
      },
    )
  }

  async getAccount(idOrKey: string): Promise<AccountRecord | undefined> {
    return this.accounts.find(
      (a) => a.id === idOrKey || a.externalKey === idOrKey || a.name === idOrKey,
    )
  }

  async getContactsForAccount(accountId: string): Promise<ContactRecord[]> {
    return this.contacts.filter((c) => c.accountId === accountId)
  }

  async getOpportunitiesForAccount(accountId: string): Promise<OpportunityRecord[]> {
    return this.opportunities.filter((o) => o.accountId === accountId)
  }

  async findMatchingOpportunity(
    accountId: string,
    productHint?: string,
  ): Promise<OpportunityRecord | undefined> {
    const hint = (productHint || '').toLowerCase()
    const list = this.opportunities.filter((o) => o.accountId === accountId)
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

  async getOrdersForAccount(accountId: string): Promise<OrderRecord[]> {
    return this.orders.filter((o) => o.accountId === accountId)
  }

  async getShipmentForOrder(orderId: string): Promise<ShipmentRecord | undefined> {
    return this.shipments.find((s) => s.orderId === orderId)
  }

  async listActivityDrafts(): Promise<ActivityDraft[]> {
    return [...this.activities].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listOpportunityDrafts(): Promise<OpportunityDraft[]> {
    return [...this.opportunityDrafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listAllDrafts(): Promise<Array<ActivityDraft | OpportunityDraft>> {
    return [
      ...[...this.activities].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ...[...this.opportunityDrafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    ]
  }

  async upsertActivity(draft: ActivityDraft): Promise<ActivityDraft> {
    const idx = this.activities.findIndex((d) => d.idempotencyKey === draft.idempotencyKey)
    const next = { ...draft, updatedAt: now() }
    if (idx >= 0) this.activities[idx] = next
    else this.activities.unshift(next)
    return next
  }

  async upsertOpportunityDraft(draft: OpportunityDraft): Promise<OpportunityDraft> {
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

  async confirmAndSync(
    idempotencyKey: string,
    options?: { fail?: boolean },
  ): Promise<ActivityDraft | OpportunityDraft | null> {
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

  async discardDraft(idempotencyKey: string): Promise<ActivityDraft | OpportunityDraft | null> {
    return this.updateDraftStatus(idempotencyKey, 'Discarded')
  }

  async writeLog(
    row: Omit<InvocationLog, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  ): Promise<InvocationLog> {
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

  async listLogs(limit = 50): Promise<InvocationLog[]> {
    return this.logs.slice(0, limit)
  }

  async saveConversation(
    sessionKey: string,
    context: Record<string, string>,
    messages: unknown[],
  ): Promise<ConversationRecord> {
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

  async getConversation(sessionKey: string): Promise<ConversationRecord | undefined> {
    return this.conversations.get(sessionKey)
  }

  async computeMetrics() {
    const drafts = [
      ...this.activities,
      ...this.opportunityDrafts,
    ]
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

export const repository: SalesRepository = new SeedMemoryRepository()
