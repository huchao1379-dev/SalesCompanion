import type { AIMetadataRecord } from '../agents/types'

const STORAGE_KEY = 'salescompanion.aimetadata.v1'
const MAX = 200

function read(): AIMetadataRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as AIMetadataRecord[]
  } catch {
    return []
  }
}

function write(rows: AIMetadataRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX)))
}

export function listAIMetadata(): AIMetadataRecord[] {
  return read()
}

export function saveAIMetadata(
  row: Omit<AIMetadataRecord, 'id' | 'createdAt' | 'tags'> & {
    id?: string
    createdAt?: string
    tags?: string[]
  },
): AIMetadataRecord {
  const record: AIMetadataRecord = {
    id: row.id ?? `meta_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: row.createdAt ?? new Date().toISOString(),
    regardingKey: row.regardingKey,
    regardingKind: row.regardingKind,
    summary: row.summary,
    tags: row.tags ?? [],
    promptVersion: row.promptVersion ?? 'phase1-mock-v1',
    modelName: row.modelName ?? 'mock-orchestrator',
    confidence: row.confidence,
  }
  write([record, ...read()])
  return record
}
