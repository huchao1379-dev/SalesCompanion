import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

function resolveAiProvider(): 'deepseek' | 'openai' | 'copilotstudio' {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase()
  if (raw === 'copilotstudio') return 'copilotstudio'
  if (raw === 'openai') return 'openai'
  return 'deepseek'
}

/** Accept gpt6-luna / gpt-6-luna style aliases from env. */
function normalizeOpenAiModel(raw: string | undefined): string {
  const value = (raw || 'gpt-6-luna').trim()
  if (/^gpt[-_]?6[-_]?luna$/i.test(value)) return 'gpt-6-luna'
  return value || 'gpt-6-luna'
}

type OpenAiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

function resolveOpenAiReasoningEffort(raw: string | undefined): OpenAiReasoningEffort {
  const value = (raw || 'low').trim().toLowerCase()
  if (
    value === 'none' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  ) {
    return value
  }
  return 'low'
}

const aiProvider = resolveAiProvider()

const openaiApiKey = process.env.OPENAI_API_KEY?.trim() || ''
const openaiBaseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '')
const openaiModel = normalizeOpenAiModel(process.env.OPENAI_MODEL)
const openaiReasoningEffort = resolveOpenAiReasoningEffort(process.env.OPENAI_REASONING_EFFORT)

const deepseekApiKey = process.env.DEEPSEEK_API_KEY?.trim() || ''
const deepseekBaseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(
  /\/$/,
  '',
)
const deepseekModel = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

/** Chat LLM defaults for vision when provider already supports images (gpt-6-luna). */
const defaultVisionApiKey =
  aiProvider === 'openai' ? openaiApiKey : deepseekApiKey
const defaultVisionBaseUrl = aiProvider === 'openai' ? openaiBaseUrl : deepseekBaseUrl
const defaultVisionModel = aiProvider === 'openai' ? openaiModel : ''

export const config = {
  port: Number(process.env.PORT || 8787),
  /** Local demo: 127.0.0.1. Cloud (Azure etc.): 0.0.0.0 */
  host: (process.env.HOST || '127.0.0.1').trim() || '127.0.0.1',
  aiProvider,
  deepseekApiKey,
  deepseekBaseUrl,
  deepseekModel,
  openaiApiKey,
  openaiBaseUrl,
  openaiModel,
  openaiReasoningEffort,
  /** Optional OpenAI-compatible vision model for image attachments. */
  visionApiKey: process.env.VISION_API_KEY?.trim() || defaultVisionApiKey,
  visionBaseUrl: (
    process.env.VISION_BASE_URL ||
    defaultVisionBaseUrl ||
    'https://api.deepseek.com'
  ).replace(/\/$/, ''),
  visionModel: process.env.VISION_MODEL?.trim() || defaultVisionModel,
  copilotStudioDirectConnectUrl: process.env.COPILOTSTUDIO_DIRECT_CONNECT_URL?.trim() || '',
  copilotStudioAccessToken: process.env.COPILOTSTUDIO_ACCESS_TOKEN?.trim() || '',
  copilotStudioTenantId: process.env.COPILOTSTUDIO_TENANT_ID?.trim() || '',
  copilotStudioClientId: process.env.COPILOTSTUDIO_CLIENT_ID?.trim() || '',
  copilotStudioClientSecret: process.env.COPILOTSTUDIO_CLIENT_SECRET?.trim() || '',
  dataverseUrl: process.env.DATAVERSE_URL?.trim() || '',
  dataverseToken: process.env.DATAVERSE_TOKEN?.trim() || '',
  /** App registration (preferred over static DATAVERSE_TOKEN). */
  dataverseTenantId: process.env.DATAVERSE_TENANT_ID?.trim() || '',
  dataverseClientId: process.env.DATAVERSE_CLIENT_ID?.trim() || '',
  dataverseClientSecret: process.env.DATAVERSE_CLIENT_SECRET?.trim() || '',
  /** Publisher prefix for logical names, e.g. crmai → crmai_account */
  dataversePrefix: (process.env.DATAVERSE_PREFIX || 'crmai').trim().replace(/_$/g, ''),
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

  /** 讯飞语音听写（流式版）— Key 仅服务端持有，前端通过 /api/speech/iat/ticket 取短时签票。 */
  iflytekAppId: process.env.IFLYTEK_APP_ID?.trim() || '',
  iflytekApiKey: process.env.IFLYTEK_API_KEY?.trim() || '',
  iflytekApiSecret: process.env.IFLYTEK_API_SECRET?.trim() || '',
  iflytekLanguage: (process.env.IFLYTEK_LANGUAGE || 'zh_cn').trim(),
  iflytekDomain: (process.env.IFLYTEK_DOMAIN || 'iat').trim(),
  iflytekAccent: (process.env.IFLYTEK_ACCENT || 'mandarin').trim(),
  /** wpgs = 动态修正（中文）；空字符串关闭 */
  iflytekDwa: (process.env.IFLYTEK_DWA ?? 'wpgs').trim(),
  iflytekVadEos: Number(process.env.IFLYTEK_VAD_EOS || 3000),
  /**
   * Speech provider preference:
   * - auto: 有讯飞密钥则 iflytek，否则 webspeech
   * - iflytek / webspeech: 强制
   */
  speechProvider: (() => {
    const raw = (process.env.SPEECH_PROVIDER || 'auto').trim().toLowerCase()
    if (raw === 'iflytek' || raw === 'webspeech' || raw === 'auto') return raw
    return 'auto'
  })(),
}

export function hasDeepSeek(): boolean {
  return config.aiProvider === 'deepseek' && Boolean(config.deepseekApiKey)
}

export function hasOpenAI(): boolean {
  return config.aiProvider === 'openai' && Boolean(config.openaiApiKey)
}

/** Active chat LLM for Domain Agents (DeepSeek or OpenAI). */
export function hasLlm(): boolean {
  return hasDeepSeek() || hasOpenAI()
}

export function llmSuccessMode(): 'deepseek' | 'openai' {
  return config.aiProvider === 'openai' ? 'openai' : 'deepseek'
}

export function activeLlmModelName(): string {
  if (config.aiProvider === 'openai') return config.openaiModel
  return config.deepseekModel
}

/** Vision needs an explicit VISION_MODEL (deepseek-chat is text-only; openai defaults to gpt-6-luna). */
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
  if (!config.dataverseUrl) return false
  if (config.dataverseToken) return true
  return Boolean(
    config.dataverseTenantId && config.dataverseClientId && config.dataverseClientSecret,
  )
}

/** Live web search is opt-in via WEB_SEARCH_API_KEY. */
export function hasWebSearch(): boolean {
  return Boolean(config.webSearchApiKey)
}

export function hasWebFetch(): boolean {
  return config.webFetchEnabled
}

export function hasIFlytek(): boolean {
  return Boolean(config.iflytekAppId && config.iflytekApiKey && config.iflytekApiSecret)
}

/** Effective speech ASR provider for clients. */
export function resolveSpeechProvider(): 'iflytek' | 'webspeech' {
  if (config.speechProvider === 'webspeech') return 'webspeech'
  if (config.speechProvider === 'iflytek') return hasIFlytek() ? 'iflytek' : 'webspeech'
  return hasIFlytek() ? 'iflytek' : 'webspeech'
}
