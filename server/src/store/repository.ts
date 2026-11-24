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
} from '../types.js'

export type InvocationLogInput = Omit<InvocationLog, 'id' | 'createdAt'> & {
  id?: string
  createdAt?: string
}

export type MetricsSnapshot = {
  todayVisits: number
  riskOpportunities: number
  pendingSync: number
  openDrafts: number
  draftAdoptionPct: number
  accountCount: number
  opportunityCount: number
}

export type DraftSnapshot = {
  activities: ActivityDraft[]
  opportunityDrafts: OpportunityDraft[]
}

/** Async persistence boundary — live Dataverse Web API. */
export interface SalesRepository {
  readonly mode: 'dataverse-webapi'
  listAccounts(): Promise<AccountRecord[]>
  listOpportunities(): Promise<OpportunityRecord[]>
  listOrders(): Promise<OrderRecord[]>
  listShipments(): Promise<ShipmentRecord[]>
  searchAccounts(query: string): Promise<AccountRecord[]>
  getAccount(idOrKey: string): Promise<AccountRecord | undefined>
  getContactsForAccount(accountId: string): Promise<ContactRecord[]>
  getOpportunitiesForAccount(accountId: string): Promise<OpportunityRecord[]>
  findMatchingOpportunity(accountId: string, productHint?: string): Promise<OpportunityRecord | undefined>
  getOrdersForAccount(accountId: string): Promise<OrderRecord[]>
  getShipmentForOrder(orderId: string): Promise<ShipmentRecord | undefined>
  listActivityDrafts(): Promise<ActivityDraft[]>
  listOpportunityDrafts(): Promise<OpportunityDraft[]>
  listAllDrafts(): Promise<Array<ActivityDraft | OpportunityDraft>>
  upsertActivity(draft: ActivityDraft): Promise<ActivityDraft>
  upsertOpportunityDraft(draft: OpportunityDraft): Promise<OpportunityDraft>
  confirmAndSync(idempotencyKey: string, options?: { fail?: boolean }): Promise<ActivityDraft | OpportunityDraft | null>
  discardDraft(idempotencyKey: string): Promise<ActivityDraft | OpportunityDraft | null>
  writeLog(row: InvocationLogInput): Promise<InvocationLog>
  listLogs(limit?: number): Promise<InvocationLog[]>
  saveConversation(sessionKey: string, context: Record<string, string>, messages: unknown[]): Promise<ConversationRecord>
  getConversation(sessionKey: string): Promise<ConversationRecord | undefined>
  computeMetrics(): Promise<MetricsSnapshot>
  /** Optional draft rollback helpers (Web API uses idempotent upserts instead). */
  snapshotDrafts?(): DraftSnapshot
  restoreDrafts?(snapshot: DraftSnapshot): void
}
