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
  copilotStudioDirectConnectUrl: process.env.COPILOTSTUDIO_DIRECT_CONNECT_URL?.trim() || '',
  copilotStudioAccessToken: process.env.COPILOTSTUDIO_ACCESS_TOKEN?.trim() || '',
  copilotStudioTenantId: process.env.COPILOTSTUDIO_TENANT_ID?.trim() || '',
  copilotStudioClientId: process.env.COPILOTSTUDIO_CLIENT_ID?.trim() || '',
  copilotStudioClientSecret: process.env.COPILOTSTUDIO_CLIENT_SECRET?.trim() || '',
  dataverseUrl: process.env.DATAVERSE_URL?.trim() || '',
  dataverseToken: process.env.DATAVERSE_TOKEN?.trim() || '',
  promptVersion: process.env.PROMPT_VERSION || 'demo-deepseek-v2',
  seedPath:
    process.env.SEED_PATH ||
    path.resolve(__dirname, '../../dataverse/seed/seed.json'),
}

export function hasDeepSeek(): boolean {
  return config.aiProvider === 'deepseek' && Boolean(config.deepseekApiKey)
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
