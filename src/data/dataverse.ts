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
    const serverDrafts = res.drafts as DraftPayload[]
    const localDrafts = readLocal().drafts
    const merged = [...serverDrafts]
    for (const local of localDrafts) {
      const index = merged.findIndex((draft) => draft.idempotencyKey === local.idempotencyKey)
      if (index < 0) {
        if (local.syncStatus === 'SyncFailed') merged.push(local)
        continue
      }
      // A local confirm failure must stay visible even if the server still has
      // the pre-confirm Draft row.
      if (local.syncStatus === 'SyncFailed' && merged[index].syncStatus === 'Draft') {
        merged[index] = local
      }
    }
    return mirror(merged)
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

export type ConfirmSyncResult = {
  draft: DraftPayload
  /** true when API confirm succeeded; false when the API was unreachable (draft stays SyncFailed) */
  viaApi: boolean
}

export async function confirmAndSync(
  draft: DraftPayload,
  options?: { fail?: boolean },
): Promise<DraftPayload> {
  const result = await confirmAndSyncDetailed(draft, options)
  return result.draft
}

/** Prefer this when UI needs to distinguish real API sync vs local mock. */
export async function confirmAndSyncDetailed(
  draft: DraftPayload,
  options?: { fail?: boolean },
): Promise<ConfirmSyncResult> {
  upsertDraft({ ...draft, syncStatus: 'Confirmed', syncError: undefined })
  try {
    // Flush the latest edits before confirm; otherwise the server may 404 on
    // an idempotency key it never received.
    await api.upsertDraft({ ...draft, syncStatus: 'Draft', syncError: undefined })
    const synced = (await api.confirmDraft(draft.idempotencyKey, options?.fail)) as DraftPayload
    const store = readLocal()
    const idx = store.drafts.findIndex((d) => d.idempotencyKey === synced.idempotencyKey)
    if (idx >= 0) store.drafts[idx] = synced
    else store.drafts.unshift(synced)
    writeLocal(store)
    return { draft: synced, viaApi: true }
  } catch {
    // Never fake a SAP success. Keep the draft recoverable and surface the
    // failure so the user can retry once the API is reachable.
    const failed =
      updateDraftStatus(draft.idempotencyKey, 'SyncFailed', {
        syncError: '【本地】后端确认接口不可用，草稿未写入；请检查 API 后重试。',
      } as Partial<DraftPayload>) ?? { ...draft, syncStatus: 'SyncFailed' as const }
    return { draft: failed as DraftPayload, viaApi: false }
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
