import type { AgentInvocationRecord } from '../agents/types'

const STORAGE_KEY = 'salescompanion.invocations.v1'
const MAX = 200

function read(): AgentInvocationRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as AgentInvocationRecord[]
  } catch {
    return []
  }
}

function write(rows: AgentInvocationRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX)))
}

export function listInvocations(): AgentInvocationRecord[] {
  return read()
}

export function logInvocation(
  row: Omit<AgentInvocationRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): AgentInvocationRecord {
  const record: AgentInvocationRecord = {
    id: row.id ?? `inv_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: row.createdAt ?? new Date().toISOString(),
    conversationId: row.conversationId,
    agentName: row.agentName,
    utterance: row.utterance,
    latencyMs: row.latencyMs,
    success: row.success,
    confidence: row.confidence,
    errorMessage: row.errorMessage,
    creditsEstimate: row.creditsEstimate,
  }
  write([record, ...read()])
  return record
}
