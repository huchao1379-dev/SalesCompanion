import type { DraftPayload, SyncStatus } from '../agents/types'
import { emitDrafts } from './draftStore'

/**
 * Local SoE store for Phase 1 mock.
 * Swap body with Dataverse / Power Apps SDK calls later; keep the same surface.
 */

const STORAGE_KEY = 'salescompanion.drafts.v1'

type StoredDrafts = {
  drafts: DraftPayload[]
}

function readStore(): StoredDrafts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { drafts: [] }
    return JSON.parse(raw) as StoredDrafts
  } catch {
    return { drafts: [] }
  }
}

function writeStore(store: StoredDrafts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  emitDrafts(store.drafts)
}

export function listDrafts(): DraftPayload[] {
  return readStore().drafts
}

export function upsertDraft(draft: DraftPayload): DraftPayload {
  const store = readStore()
  const idx = store.drafts.findIndex((d) => d.idempotencyKey === draft.idempotencyKey)
  if (idx >= 0) {
    store.drafts[idx] = draft
  } else {
    store.drafts.unshift(draft)
  }
  writeStore(store)
  return draft
}

export function updateDraftStatus(
  idempotencyKey: string,
  syncStatus: SyncStatus,
  patch?: Partial<DraftPayload>,
): DraftPayload | null {
  const store = readStore()
  const idx = store.drafts.findIndex((d) => d.idempotencyKey === idempotencyKey)
  if (idx < 0) return null
  const current = store.drafts[idx]
  const next = { ...current, ...patch, syncStatus } as DraftPayload
  store.drafts[idx] = next
  writeStore(store)
  return next
}

/** Confirm then simulate Service Bus → SAP sync (gray-ok for Phase 1). */
export async function confirmAndSync(
  draft: DraftPayload,
  options?: { fail?: boolean },
): Promise<DraftPayload> {
  upsertDraft({ ...draft, syncStatus: 'Confirmed', syncError: undefined })
  updateDraftStatus(draft.idempotencyKey, 'Syncing')

  await delay(900)

  if (options?.fail) {
    return (
      updateDraftStatus(draft.idempotencyKey, 'SyncFailed', {
        syncError: 'SAP 校验失败（模拟）：请检查数量与客户信用后重试',
      } as Partial<DraftPayload>) ?? draft
    )
  }

  return (
    updateDraftStatus(draft.idempotencyKey, 'Synced', {
      sapExternalId: `SAP-${Date.now().toString(36).toUpperCase()}`,
      syncError: undefined,
    } as Partial<DraftPayload>) ?? draft
  )
}

export async function discardDraft(draft: DraftPayload): Promise<DraftPayload> {
  return upsertDraft({ ...draft, syncStatus: 'Discarded' })
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
