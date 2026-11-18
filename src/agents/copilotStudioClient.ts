import { ApiRequestError, api } from '../api/client'
import type { OrchestratorRequest, OrchestratorResponse } from './types'

/** Calls the server-side Microsoft Copilot Studio SDK adapter. */
export async function copilotOrchestrate(
  req: OrchestratorRequest,
  opts?: { signal?: AbortSignal },
): Promise<OrchestratorResponse> {
  try {
    return (await api.copilotMessage(req, { signal: opts?.signal })) as OrchestratorResponse
  } catch (err) {
    if (err instanceof ApiRequestError) throw err
    throw err instanceof Error
      ? err
      : new ApiRequestError('暂时无法连接 Copilot Studio，请稍后重试', 'network')
  }
}
