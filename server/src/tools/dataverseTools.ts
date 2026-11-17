/**
 * Tier-3 Skill / Tool layer — reusable by Domain Agents.
 * Keep Dataverse access here so agents stay replaceable when Web API lands.
 */
import { store } from '../store/dataverseStore.js'
import { resolveAccount as resolveAccountImpl } from '../agents/accountProfile.js'
import type {
  AccountRecord,
  ActivityDraft,
  ContactRecord,
  OpportunityDraft,
  OpportunityRecord,
} from '../types.js'

export function searchAccount(query: string): AccountRecord | undefined {
  return resolveAccountImpl(query)
}

export function getAccount(idOrKey: string): AccountRecord | undefined {
  return store.getAccount(idOrKey)
}

export function getContactsForAccount(accountId: string): ContactRecord[] {
  return store.getContactsForAccount(accountId)
}

export function findMatchingOpportunity(
  accountId: string,
  productHint?: string,
): OpportunityRecord | undefined {
  return store.findMatchingOpportunity(accountId, productHint)
}

export function getOpportunitiesForAccount(accountId: string) {
  return store.getOpportunitiesForAccount(accountId)
}

export function getOrdersForAccount(accountId: string) {
  return store.getOrdersForAccount(accountId)
}

export function getShipmentForOrder(orderId: string) {
  return store.getShipmentForOrder(orderId)
}

export function upsertActivityDraft(draft: ActivityDraft): ActivityDraft {
  return store.upsertActivity(draft)
}

export function upsertOpportunityDraft(draft: OpportunityDraft): OpportunityDraft {
  return store.upsertOpportunityDraft(draft)
}

export function listActivityDrafts(): ActivityDraft[] {
  return store.listActivityDrafts()
}

export function listAllDrafts() {
  return store.listAllDrafts()
}
