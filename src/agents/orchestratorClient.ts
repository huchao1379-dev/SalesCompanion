import { api } from '../api/client'
import type { OrchestratorRequest, OrchestratorResponse } from './types'

let lastMode: 'deepseek' | 'heuristic' | 'offline-mock' = 'offline-mock'
let apiReachable: boolean | null = null

export async function pingOrchestrator(): Promise<boolean> {
  try {
    const h = await api.health()
    apiReachable = true
    lastMode = h.deepseek ? 'deepseek' : 'heuristic'
    return true
  } catch {
    apiReachable = false
    lastMode = 'offline-mock'
    return false
  }
}

/**
 * Single entry for all mic / chat intents.
 * Prefer SalesCompanion API (DeepSeek + Dataverse store); fall back to local mock if API down.
 */
export async function orchestrate(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  try {
    const res = (await api.orchestrate(req)) as OrchestratorResponse & {
      mode?: 'deepseek' | 'heuristic'
    }
    apiReachable = true
    lastMode = res.mode || 'heuristic'
    return res
  } catch (err) {
    apiReachable = false
    lastMode = 'offline-mock'
    throw err instanceof Error
      ? err
      : new Error('编排服务不可用：本地请启动 server；线上请配置 VITE_API_BASE 并部署 API')
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
  return lastMode !== 'deepseek'
}
