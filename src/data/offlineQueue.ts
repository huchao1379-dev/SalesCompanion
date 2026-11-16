import type { OfflineUtterance } from '../agents/types'

const STORAGE_KEY = 'salescompanion.offline.utterances.v1'

function read(): OfflineUtterance[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as OfflineUtterance[]
  } catch {
    return []
  }
}

function write(rows: OfflineUtterance[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, 100)))
}

export function listOfflineUtterances(): OfflineUtterance[] {
  return read()
}

export function enqueueOfflineUtterance(utterance: string, locale = 'zh-CN'): OfflineUtterance {
  const row: OfflineUtterance = {
    id: `off_${Math.random().toString(36).slice(2, 10)}`,
    utterance: utterance.trim(),
    locale,
    createdAt: new Date().toISOString(),
    synced: false,
  }
  write([row, ...read()])
  return row
}

export function markOfflineSynced(id: string) {
  write(read().map((r) => (r.id === id ? { ...r, synced: true } : r)))
}

export function clearSyncedOffline() {
  write(read().filter((r) => !r.synced))
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}
