import cors from 'cors'
import express from 'express'
import { config, hasDeepSeek } from './config.js'
import { apiRouter } from './routes/api.js'
import { repository } from './store/dataverseStore.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use('/api', apiRouter)

app.listen(config.port, config.host, () => {
  console.log(`[SalesCompanion API] http://${config.host}:${config.port}`)
  console.log(`  AI provider: ${config.aiProvider}`)
  console.log(`  DeepSeek: ${hasDeepSeek() ? 'ON (' + config.deepseekModel + ')' : 'OFF → heuristic fallback'}`)
  console.log(
    `  Data repository: ${repository.mode} (dataverse/seed/seed.json)`,
  )
})
