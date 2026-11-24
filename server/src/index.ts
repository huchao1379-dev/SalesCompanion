import cors from 'cors'
import express from 'express'
import {
  activeLlmModelName,
  config,
  hasDeepSeek,
  hasLlm,
  hasOpenAI,
  hasVisionModel,
} from './config.js'
import { apiRouter } from './routes/api.js'
import { repository } from './store/dataverseStore.js'

const app = express()
app.use(cors())
// Base64 image attachments need headroom beyond the default 1mb.
app.use(express.json({ limit: '16mb' }))
app.use('/api', apiRouter)
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'API route not found',
    method: req.method,
    path: req.path,
  })
})

app.listen(config.port, config.host, () => {
  console.log(`[SalesCompanion API] http://${config.host}:${config.port}`)
  console.log(`  AI provider: ${config.aiProvider}`)
  if (config.aiProvider === 'openai') {
    console.log(
      `  OpenAI: ${hasOpenAI() ? 'ON (' + activeLlmModelName() + ')' : 'OFF → heuristic fallback'}`,
    )
  } else if (config.aiProvider === 'deepseek') {
    console.log(
      `  DeepSeek: ${hasDeepSeek() ? 'ON (' + config.deepseekModel + ')' : 'OFF → heuristic fallback'}`,
    )
  } else {
    console.log(`  LLM chat: ${hasLlm() ? 'ON (' + activeLlmModelName() + ')' : 'OFF'}`)
  }
  console.log(
    `  Vision: ${hasVisionModel() ? 'ON (' + config.visionModel + ')' : 'OFF → image attachments text-only notice'}`,
  )
  console.log(`  Data repository: dataverse-webapi (${config.dataverseUrl})`)
})
