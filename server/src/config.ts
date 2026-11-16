import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

export const config = {
  port: Number(process.env.PORT || 8787),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY?.trim() || '',
  deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  dataverseUrl: process.env.DATAVERSE_URL?.trim() || '',
  dataverseToken: process.env.DATAVERSE_TOKEN?.trim() || '',
  promptVersion: process.env.PROMPT_VERSION || 'demo-deepseek-v1',
  seedPath:
    process.env.SEED_PATH ||
    path.resolve(__dirname, '../../dataverse/seed/seed.json'),
}

export function hasDeepSeek(): boolean {
  return Boolean(config.deepseekApiKey)
}

export function hasRemoteDataverse(): boolean {
  return Boolean(config.dataverseUrl && config.dataverseToken)
}
