/**
 * Tier-3 Skill / Tool layer — reusable by Domain Agents.
 * Keep Dataverse access here so agents stay replaceable when Web API lands.
 */
import { repository } from '../store/dataverseStore.js'
import type {
  AccountRecord,
  ActivityDraft,
  ContactRecord,
  OpportunityDraft,
  OpportunityRecord,
} from '../types.js'

export async function searchAccount(query: string): Promise<AccountRecord | undefined> {
  const hits = await repository.searchAccounts(query)
  return hits[0]
}

export function searchAccounts(query: string): Promise<AccountRecord[]> {
  return repository.searchAccounts(query)
}

export function getAccount(idOrKey: string): Promise<AccountRecord | undefined> {
  return repository.getAccount(idOrKey)
}

export function getContactsForAccount(accountId: string): Promise<ContactRecord[]> {
  return repository.getContactsForAccount(accountId)
}

export function findMatchingOpportunity(
  accountId: string,
  productHint?: string,
): Promise<OpportunityRecord | undefined> {
  return repository.findMatchingOpportunity(accountId, productHint)
}

export function getOpportunitiesForAccount(accountId: string) {
  return repository.getOpportunitiesForAccount(accountId)
}

export function getOrdersForAccount(accountId: string) {
  return repository.getOrdersForAccount(accountId)
}

export function getShipmentForOrder(orderId: string) {
  return repository.getShipmentForOrder(orderId)
}

export function upsertActivityDraft(draft: ActivityDraft): Promise<ActivityDraft> {
  return repository.upsertActivity(draft)
}

export function upsertOpportunityDraft(draft: OpportunityDraft): Promise<OpportunityDraft> {
  return repository.upsertOpportunityDraft(draft)
}

export function listActivityDrafts(): Promise<ActivityDraft[]> {
  return repository.listActivityDrafts()
}

export function listAllDrafts() {
  return repository.listAllDrafts()
}

export async function getAccountProfileData(accountId: string): Promise<{
  account: AccountRecord
  contacts: ContactRecord[]
  opportunities: OpportunityRecord[]
} | undefined> {
  const account = await repository.getAccount(accountId)
  if (!account) return undefined
  const [contacts, opportunities] = await Promise.all([
    repository.getContactsForAccount(accountId),
    repository.getOpportunitiesForAccount(accountId),
  ])
  return { account, contacts, opportunities }
}

export async function getOrderLogistics(accountQuery: string): Promise<{
  account: AccountRecord
  orders: Awaited<ReturnType<typeof repository.getOrdersForAccount>>
  latestOrder?: Awaited<ReturnType<typeof repository.getOrdersForAccount>>[number]
  shipment?: Awaited<ReturnType<typeof repository.getShipmentForOrder>>
} | undefined> {
  const account = await searchAccount(accountQuery)
  if (!account) return undefined
  const orders = await repository.getOrdersForAccount(account.id)
  const latestOrder = [...orders].sort((a, b) => b.orderedAt.localeCompare(a.orderedAt))[0]
  const shipment = latestOrder
    ? await repository.getShipmentForOrder(latestOrder.id)
    : undefined
  return { account, orders, latestOrder, shipment }
}
