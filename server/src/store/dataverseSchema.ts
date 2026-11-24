/**
 * Dataverse logical names ↔ app types.
 * Prefix via DATAVERSE_PREFIX (this env uses `hc`).
 *
 * Choice option values follow the publisher prefix in Maker.
 * This org uses 122990000+ (not the docs example 100000000).
 * Override with DATAVERSE_CHOICE_BASE if needed.
 */
import type { SyncStatus } from '../types.js'

const CHOICE_BASE = Number(process.env.DATAVERSE_CHOICE_BASE || 122990000)

export type DataversePrefix = string

const PLURALS: Record<string, string> = {
  account: 'accounts',
  contact: 'contacts',
  activity: 'activities',
  opportunity: 'opportunities',
  order: 'orders',
  shipment: 'shipments',
  aiinvocationlog: 'aiinvocationlogs',
  conversation: 'conversations',
}

/** EntitySetName for Web API paths. */
export function entitySet(prefix: string, singular: string): string {
  const plural = PLURALS[singular] ?? `${singular}s`
  return `${prefix}_${plural}`
}

export function col(prefix: string, name: string): string {
  return `${prefix}_${name}`
}

function buildChoiceMaps(base: number) {
  const syncTo: Record<SyncStatus, number> = {
    Draft: base,
    Confirmed: base + 1,
    Syncing: base + 1,
    Synced: base + 2,
    SyncFailed: base + 1,
    Discarded: base + 3,
  }
  const syncFrom: Record<number, SyncStatus> = {
    [base]: 'Draft',
    [base + 1]: 'Confirmed',
    [base + 2]: 'Synced',
    [base + 3]: 'Discarded',
    // Docs example values (fallback read)
    100000000: 'Draft',
    100000001: 'Confirmed',
    100000002: 'Synced',
    100000003: 'Discarded',
    100000004: 'Syncing',
    100000005: 'SyncFailed',
  }
  const activityTo: Record<string, number> = {
    Visit: base,
    Call: base + 1,
    Demo: base + 2,
    FollowUp: base + 3,
  }
  const activityFrom: Record<number, string> = {
    [base]: 'Visit',
    [base + 1]: 'Call',
    [base + 2]: 'Demo',
    [base + 3]: 'FollowUp',
    100000000: 'Visit',
    100000001: 'Call',
    100000002: 'Demo',
    100000003: 'FollowUp',
  }
  const stageTo: Record<string, number> = {
    Identify: base,
    Qualify: base + 1,
    Propose: base + 2,
    Negotiate: base + 3,
    Closed: base + 4,
  }
  const stageFrom: Record<number, string> = {
    [base]: 'Identify',
    [base + 1]: 'Qualify',
    [base + 2]: 'Propose',
    [base + 3]: 'Negotiate',
    [base + 4]: 'Closed',
    100000000: 'Identify',
    100000001: 'Qualify',
    100000002: 'Propose',
    100000003: 'Negotiate',
    100000004: 'Closed',
  }
  return { syncTo, syncFrom, activityTo, activityFrom, stageTo, stageFrom }
}

const maps = buildChoiceMaps(CHOICE_BASE)

export const SYNC_STATUS_TO_CHOICE = maps.syncTo
export const CHOICE_TO_SYNC_STATUS = maps.syncFrom
export const ACTIVITY_TYPE_TO_CHOICE = maps.activityTo
export const CHOICE_TO_ACTIVITY_TYPE = maps.activityFrom
export const OPP_STAGE_TO_CHOICE = maps.stageTo
export const CHOICE_TO_OPP_STAGE = maps.stageFrom

export function syncStatusToChoice(status: SyncStatus): number {
  return SYNC_STATUS_TO_CHOICE[status] ?? CHOICE_BASE
}

export function choiceToSyncStatus(value: unknown): SyncStatus {
  if (typeof value === 'number' && CHOICE_TO_SYNC_STATUS[value]) {
    return CHOICE_TO_SYNC_STATUS[value]
  }
  if (typeof value === 'string') {
    const asNum = Number(value)
    if (!Number.isNaN(asNum) && CHOICE_TO_SYNC_STATUS[asNum]) {
      return CHOICE_TO_SYNC_STATUS[asNum]
    }
    const normalized = value as SyncStatus
    if (normalized in SYNC_STATUS_TO_CHOICE) return normalized
  }
  return 'Draft'
}

export function activityTypeToChoice(type: string): number {
  return ACTIVITY_TYPE_TO_CHOICE[type] ?? CHOICE_BASE
}

export function choiceToActivityType(value: unknown): string {
  if (typeof value === 'number' && CHOICE_TO_ACTIVITY_TYPE[value]) {
    return CHOICE_TO_ACTIVITY_TYPE[value]
  }
  if (typeof value === 'string' && value.trim()) {
    const asNum = Number(value)
    if (!Number.isNaN(asNum) && CHOICE_TO_ACTIVITY_TYPE[asNum]) {
      return CHOICE_TO_ACTIVITY_TYPE[asNum]
    }
    return value
  }
  return 'Visit'
}

export function oppStageToChoice(stage: string): number {
  return OPP_STAGE_TO_CHOICE[stage] ?? CHOICE_BASE
}

export function choiceToOppStage(value: unknown): string {
  if (typeof value === 'number' && CHOICE_TO_OPP_STAGE[value]) {
    return CHOICE_TO_OPP_STAGE[value]
  }
  if (typeof value === 'string' && value.trim()) {
    const asNum = Number(value)
    if (!Number.isNaN(asNum) && CHOICE_TO_OPP_STAGE[asNum]) {
      return CHOICE_TO_OPP_STAGE[asNum]
    }
    return value
  }
  return 'Identify'
}
