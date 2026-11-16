import type { DraftPayload } from '../agents/types'

type Listener = (drafts: DraftPayload[]) => void

const listeners = new Set<Listener>()

export function subscribeDrafts(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitDrafts(drafts: DraftPayload[]) {
  listeners.forEach((l) => l(drafts))
}
