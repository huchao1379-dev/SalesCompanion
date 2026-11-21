import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const aiProvider = process.env.AI_PROVIDER?.trim().toLowerCase() === 'copilotstudio'
  ? 'copilotstudio'
  : 'deepseek'

export const config = {
  port: Number(process.env.PORT || 8787),
  /** Local demo: 127.0.0.1. Cloud (Azure etc.): 0.0.0.0 */
  host: (process.env.HOST || '127.0.0.1').trim() || '127.0.0.1',
  aiProvider,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY?.trim() || '',
  deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  /** Optional OpenAI-compatible vision model for image attachments. */
  visionApiKey: process.env.VISION_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || '',
  visionBaseUrl: (
    process.env.VISION_BASE_URL ||
    process.env.DEEPSEEK_BASE_URL ||
    'https://api.deepseek.com'
  ).replace(/\/$/, ''),
  visionModel: process.env.VISION_MODEL?.trim() || '',
  copilotStudioDirectConnectUrl: process.env.COPILOTSTUDIO_DIRECT_CONNECT_URL?.trim() || '',
  copilotStudioAccessToken: process.env.COPILOTSTUDIO_ACCESS_TOKEN?.trim() || '',
  copilotStudioTenantId: process.env.COPILOTSTUDIO_TENANT_ID?.trim() || '',
  copilotStudioClientId: process.env.COPILOTSTUDIO_CLIENT_ID?.trim() || '',
  copilotStudioClientSecret: process.env.COPILOTSTUDIO_CLIENT_SECRET?.trim() || '',
  dataverseUrl: process.env.DATAVERSE_URL?.trim() || '',
  dataverseToken: process.env.DATAVERSE_TOKEN?.trim() || '',
  /** Optional live web search for general_assist (serper | tavily). Off when key empty. */
  webSearchProvider: (process.env.WEB_SEARCH_PROVIDER || 'serper').trim().toLowerCase(),
  webSearchApiKey: process.env.WEB_SEARCH_API_KEY?.trim() || '',
  webSearchBaseUrl: (process.env.WEB_SEARCH_BASE_URL || '').trim().replace(/\/$/, ''),
  /** Allow GeneralAssist to fetch https pages; default on when search key set unless explicitly off. */
  webFetchEnabled: (() => {
    const raw = process.env.WEB_FETCH_ENABLED?.trim().toLowerCase()
    if (raw === '0' || raw === 'false' || raw === 'off') return false
    if (raw === '1' || raw === 'true' || raw === 'on') return true
    return Boolean(process.env.WEB_SEARCH_API_KEY?.trim())
  })(),
  promptVersion: process.env.PROMPT_VERSION || 'demo-deepseek-v3',
  seedPath:
    process.env.SEED_PATH ||
    path.resolve(__dirname, '../../dataverse/seed/seed.json'),
}

export function hasDeepSeek(): boolean {
  return config.aiProvider === 'deepseek' && Boolean(config.deepseekApiKey)
}

/** Vision needs an explicit VISION_MODEL (deepseek-chat is text-only). */
export function hasVisionModel(): boolean {
  return Boolean(config.visionApiKey && config.visionModel)
}

export function hasCopilotStudioConfig(): boolean {
  const staticToken = Boolean(config.copilotStudioAccessToken)
  const clientCredentials = Boolean(
    config.copilotStudioTenantId &&
      config.copilotStudioClientId &&
      config.copilotStudioClientSecret,
  )
  return config.aiProvider === 'copilotstudio' && Boolean(config.copilotStudioDirectConnectUrl) &&
    (staticToken || clientCredentials)
}

export function hasRemoteDataverse(): boolean {
  return Boolean(config.dataverseUrl && config.dataverseToken)
}

/** Live web search is opt-in via WEB_SEARCH_API_KEY. */
export function hasWebSearch(): boolean {
  return Boolean(config.webSearchApiKey)
}

export function hasWebFetch(): boolean {
  return config.webFetchEnabled
}
