import {
  ConnectionSettings,
  CopilotStudioClient,
  ScopeHelper,
} from '@microsoft/agents-copilotstudio-client'
import { config, hasCopilotStudioConfig } from './config.js'
import type {
  AgentMessage,
  OrchestratorRequest,
  OrchestratorResponse,
} from './types.js'

type CopilotActivity = Parameters<CopilotStudioClient['executeWithResponse']>[0]
type CopilotResponseActivity = Awaited<
  ReturnType<CopilotStudioClient['executeWithResponse']>
>['activities'][number]

export class CopilotStudioConfigurationError extends Error {
  readonly code = 'COPILOTSTUDIO_NOT_CONFIGURED'

  constructor(message: string) {
    super(message)
    this.name = 'CopilotStudioConfigurationError'
  }
}

function createSettings() {
  if (!config.copilotStudioDirectConnectUrl) {
    throw new CopilotStudioConfigurationError(
      'Copilot Studio 未配置 COPILOTSTUDIO_DIRECT_CONNECT_URL',
    )
  }
  return new ConnectionSettings({
    directConnectUrl: config.copilotStudioDirectConnectUrl,
    enableDiagnostics: false,
  })
}

async function acquireToken(settings: ConnectionSettings): Promise<string> {
  if (config.copilotStudioAccessToken) {
    return config.copilotStudioAccessToken.replace(/^Bearer\s+/i, '')
  }

  const { copilotStudioTenantId: tenantId, copilotStudioClientId: clientId, copilotStudioClientSecret: clientSecret } = config
  if (!tenantId || !clientId || !clientSecret) {
    throw new CopilotStudioConfigurationError(
      'Copilot Studio 未配置访问令牌。请设置 COPILOTSTUDIO_ACCESS_TOKEN，或配置 Entra client credentials。',
    )
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: ScopeHelper.getScopeFromSettings(settings),
  })
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string
    error_description?: string
  }
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Entra token 获取失败（${response.status}）：${payload.error_description || '未返回 access_token'}`,
    )
  }
  return payload.access_token
}

function createMessageActivity(
  utterance: string,
  conversationId: string,
  locale?: string,
): CopilotActivity {
  return {
    type: 'message',
    text: utterance,
    locale,
    conversation: { id: conversationId },
  } as CopilotActivity
}

function activityText(activity: CopilotResponseActivity) {
  return typeof activity.text === 'string' ? activity.text.trim() : ''
}

function responseActivities(activities: CopilotResponseActivity[]) {
  // Streaming responses can contain cumulative message chunks. Keep the last
  // chunk per activity ID so the native UI receives one complete answer.
  const byId = new Map<string, CopilotResponseActivity>()
  const withoutId: CopilotResponseActivity[] = []
  for (const activity of activities) {
    if (activity.type !== 'message' || !activityText(activity)) continue
    if (activity.id) byId.set(activity.id, activity)
    else withoutId.push(activity)
  }
  return [...byId.values(), ...withoutId].filter((activity, index, list) => {
    const text = activityText(activity)
    return list.findIndex((candidate) => activityText(candidate) === text) === index
  })
}

function toAgentMessages(activities: CopilotResponseActivity[]): AgentMessage[] {
  return responseActivities(activities).map((activity, index) => ({
    id: `copilot_${activity.id || `${Date.now()}_${index}`}`,
    role: 'assistant',
    agent_name: activity.from?.name?.trim() || 'SalesAssistant',
    content: activityText(activity),
    sources: [],
    confidence: 0,
    agent_chain: ['SalesAssistant'],
    createdAt:
      activity.timestamp instanceof Date
        ? activity.timestamp.toISOString()
        : typeof activity.timestamp === 'string'
          ? activity.timestamp
          : new Date().toISOString(),
  }))
}

export async function copilotStudioOrchestrate(
  req: OrchestratorRequest,
): Promise<OrchestratorResponse> {
  if (!hasCopilotStudioConfig()) {
    throw new CopilotStudioConfigurationError(
      'Copilot Studio 尚未配置。请检查 AI_PROVIDER、连接 URL 和认证配置。',
    )
  }

  const startedAt = performance.now()
  const settings = createSettings()
  const token = await acquireToken(settings)
  const client = new CopilotStudioClient(settings, token)
  const existingConversationId = req.context?.copilotConversationId?.trim() || ''

  let conversationId = existingConversationId
  let activities: CopilotResponseActivity[] = []
  if (!conversationId) {
    const start = await client.startConversationWithResponse({
      locale: req.locale,
      emitStartConversationEvent: false,
    })
    conversationId = start.conversationId.trim()
    if (!conversationId) {
      throw new Error('Copilot Studio 未返回 conversation ID')
    }
  }

  const response = await client.executeWithResponse(
    createMessageActivity(req.utterance.trim(), conversationId, req.locale),
    conversationId,
  )
  activities = response.activities

  return {
    messages: toAgentMessages(activities),
    drafts: [],
    context: {
      ...(req.context || {}),
      copilotConversationId: conversationId,
    },
    latencyMs: Math.round(performance.now() - startedAt),
    mode: 'copilotstudio',
  }
}
