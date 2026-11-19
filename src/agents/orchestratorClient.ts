import { ApiRequestError, api } from '../api/client'
import type { OrchestratorRequest, OrchestratorResponse } from './types'

let lastMode: 'deepseek' | 'heuristic' | 'mixed' | 'copilotstudio' | 'offline-mock' = 'offline-mock'
let apiReachable: boolean | null = null

export async function pingOrchestrator(): Promise<boolean> {
  try {
    const h = await api.health()
    apiReachable = true
    lastMode = h.aiProvider === 'copilotstudio' ? 'copilotstudio' : h.deepseek ? 'deepseek' : 'heuristic'
    return true
  } catch {
    apiReachable = false
    lastMode = 'offline-mock'
    return false
  }
}

export type OrchestrateOptions = {
  signal?: AbortSignal
}

/**
 * Single entry for all mic / chat intents.
 * Prefer SalesCompanion API (DeepSeek + Dataverse store); fall back to local mock if API down.
 * No client-side streaming — response arrives as one JSON payload. Cancel via AbortSignal.
 */
export async function orchestrate(
  req: OrchestratorRequest,
  opts?: OrchestrateOptions,
): Promise<OrchestratorResponse> {
  try {
    const res = (await api.orchestrate(req, { signal: opts?.signal })) as OrchestratorResponse & {
      mode?: 'deepseek' | 'heuristic' | 'mixed' | 'copilotstudio'
    }
    apiReachable = true
    lastMode = res.mode || 'heuristic'
    return res
  } catch (err) {
    if (err instanceof ApiRequestError && err.kind === 'abort') {
      throw err
    }
    apiReachable = false
    lastMode = 'offline-mock'
    if (err instanceof ApiRequestError) throw err
    throw err instanceof Error
      ? err
      : new ApiRequestError('暂时无法连接服务，请检查网络后重试', 'network')
  }
}

export function getOrchestratorMode() {
  return lastMode
}

export function isApiOrchestrator(): boolean {
  return apiReachable !== false
}

/** @deprecated use getOrchestratorMode */
export function isMockOrchestrator(): boolean {
  return lastMode === 'offline-mock' || lastMode === 'heuristic'
}
