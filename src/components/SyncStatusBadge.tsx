import type { SyncStatus } from '../agents/types'
import { SYNC_STATUS_LABEL } from '../data/syncStatus'

type Props = {
  status: SyncStatus
}

export function SyncStatusBadge({ status }: Props) {
  return (
    <span className={`sync-badge sync-badge--${status.toLowerCase()}`} data-status={status}>
      {SYNC_STATUS_LABEL[status]}
    </span>
  )
}
