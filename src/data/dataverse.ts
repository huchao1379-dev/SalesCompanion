import type { DraftPayload, SyncStatus } from '../agents/types'
import { api } from '../api/client'
import { emitDrafts } from './draftStore'

/**
 * Dataverse SoE access — prefers API in-memory / remote DV store.
 * Keeps a local mirror for offline UI reactivity.
 */

const STORAGE_KEY = 'salescompanion.drafts.v1'

type StoredDrafts = { drafts: DraftPayload[] }

function readLocal(): StoredDrafts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { drafts: [] }
    return JSON.parse(raw) as StoredDrafts
  } catch {
    return { drafts: [] }
  }
}

function writeLocal(store: StoredDrafts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  emitDrafts(store.drafts)
}

function mirror(drafts: DraftPayload[]) {
  writeLocal({ drafts })
  return drafts
}

export function listDrafts(): DraftPayload[] {
  return readLocal().drafts
}

export async function refreshDraftsFromApi(): Promise<DraftPayload[]> {
  try {
    const res = await api.listDrafts()
    const drafts = res.drafts as DraftPayload[]
    return mirror(drafts)
  } catch {
    return listDrafts()
  }
}

export function upsertDraft(draft: DraftPayload): DraftPayload {
  const store = readLocal()
  const idx = store.drafts.findIndex((d) => d.idempotencyKey === draft.idempotencyKey)
  if (idx >= 0) store.drafts[idx] = draft
  else store.drafts.unshift(draft)
  writeLocal(store)
  void api.upsertDraft(draft).catch(() => {
    /* local-first if API down */
  })
  return draft
}

export function updateDraftStatus(
  idempotencyKey: string,
  syncStatus: SyncStatus,
  patch?: Partial<DraftPayload>,
): DraftPayload | null {
  const store = readLocal()
  const idx = store.drafts.findIndex((d) => d.idempotencyKey === idempotencyKey)
  if (idx < 0) return null
  const current = store.drafts[idx]
  const next = { ...current, ...patch, syncStatus } as DraftPayload
  store.drafts[idx] = next
  writeLocal(store)
  return next
}

export async function confirmAndSync(
  draft: DraftPayload,
  options?: { fail?: boolean },
): Promise<DraftPayload> {
  upsertDraft({ ...draft, syncStatus: 'Confirmed', syncError: undefined })
  try {
    const synced = (await api.confirmDraft(draft.idempotencyKey, options?.fail)) as DraftPayload
    const store = readLocal()
    const idx = store.drafts.findIndex((d) => d.idempotencyKey === synced.idempotencyKey)
    if (idx >= 0) store.drafts[idx] = synced
    else store.drafts.unshift(synced)
    writeLocal(store)
    return synced
  } catch {
    // Local simulation fallback
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
}

export async function discardDraft(draft: DraftPayload): Promise<DraftPayload> {
  try {
    const discarded = (await api.discardDraft(draft.idempotencyKey)) as DraftPayload
    upsertDraft(discarded)
    return discarded
  } catch {
    return upsertDraft({ ...draft, syncStatus: 'Discarded' })
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
