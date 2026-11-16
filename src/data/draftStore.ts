import type { DraftPayload } from '../agents/types'

type Listener = (drafts: DraftPayload[]) => void

const listeners = new Set<Listener>()

export function subscribeDrafts(listener: Listener): () => void {
  listeners.add(listener)
  // Immediate snapshot so late subscribers stay in sync with local SoE.
  try {
    const raw = localStorage.getItem('salescompanion.drafts.v1')
    if (raw) {
      const parsed = JSON.parse(raw) as { drafts?: Parameters<Listener>[0] }
      if (parsed.drafts) listener(parsed.drafts)
    }
  } catch {
    /* ignore hydrate errors */
  }
  return () => {
    listeners.delete(listener)
  }
}

export function emitDrafts(drafts: DraftPayload[]) {
  listeners.forEach((l) => l(drafts))
}
