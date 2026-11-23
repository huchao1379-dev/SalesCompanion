import type { DraftPayload } from '../agents/types'
import { api } from '../api/client'
import { listDrafts } from './dataverse'

export type HomeMetrics = {
  todayVisits: number
  riskOpportunities: number
  pendingSync: number
  draftAdoptionPct: number
  openDrafts: number
}

function isToday(iso?: string): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

export function computeHomeMetrics(drafts: DraftPayload[] = listDrafts()): HomeMetrics {
  const activities = drafts.filter((d) => d.kind === 'activity' && d.syncStatus !== 'Discarded')
  const opportunities = drafts.filter((d) => d.kind === 'opportunity' && d.syncStatus !== 'Discarded')
  const pendingSync = drafts.filter((d) =>
    ['Confirmed', 'Syncing', 'SyncFailed'].includes(d.syncStatus),
  ).length
  const openDrafts = drafts.filter((d) => d.syncStatus === 'Draft').length
  const decided = drafts.filter((d) =>
    ['Synced', 'Discarded', 'Confirmed', 'Syncing', 'SyncFailed'].includes(d.syncStatus),
  )
  const adopted = drafts.filter((d) =>
    ['Synced', 'Confirmed', 'Syncing', 'SyncFailed'].includes(d.syncStatus),
  )
  const draftAdoptionPct =
    decided.length === 0 ? 0 : Math.round((adopted.length / Math.max(decided.length, 1)) * 100)

  const riskOpportunities = opportunities.filter(
    (d) => d.kind === 'opportunity' && (d.confidence < 0.7 || d.stage === 'Identify'),
  ).length

  const todayVisits = activities.filter(
    (d) =>
      d.kind === 'activity' &&
      (isToday(d.createdAt) || isToday(d.scheduledStart) || d.syncStatus === 'Synced'),
  ).length

  return {
    todayVisits,
    riskOpportunities,
    pendingSync,
    draftAdoptionPct,
    openDrafts,
  }
}

export async function fetchHomeMetrics(): Promise<HomeMetrics> {
  try {
    const m = await api.metrics()
    const business = m.business ?? (m as unknown as HomeMetrics)
    return {
      todayVisits: business.todayVisits,
      riskOpportunities: business.riskOpportunities,
      pendingSync: business.pendingSync,
      draftAdoptionPct: business.draftAdoptionPct,
      openDrafts: business.openDrafts,
    }
  } catch {
    return computeHomeMetrics()
  }
}
