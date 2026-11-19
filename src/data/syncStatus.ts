import type { SyncStatus } from '../agents/types'

export const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  Draft: 'AI 草稿',
  Confirmed: '已确认',
  Syncing: '同步中',
  Synced: '已同步（模拟）',
  SyncFailed: '同步失败',
  Discarded: '已丢弃',
}

export function canEditDraft(status: SyncStatus): boolean {
  return status === 'Draft' || status === 'SyncFailed'
}

export function canConfirm(status: SyncStatus): boolean {
  return status === 'Draft'
}

export function canRetrySync(status: SyncStatus): boolean {
  return status === 'SyncFailed'
}

export function nextAfterConfirm(status: SyncStatus): SyncStatus {
  if (status === 'Draft') return 'Confirmed'
  return status
}
