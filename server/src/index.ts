import cors from 'cors'
import express from 'express'
import { config, hasDeepSeek, hasRemoteDataverse } from './config.js'
import { apiRouter } from './routes/api.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use('/api', apiRouter)

app.listen(config.port, () => {
  console.log(`[SalesCompanion API] http://localhost:${config.port}`)
  console.log(`  DeepSeek: ${hasDeepSeek() ? 'ON (' + config.deepseekModel + ')' : 'OFF → heuristic fallback'}`)
  console.log(
    `  Dataverse: ${hasRemoteDataverse() ? 'remote Web API' : 'in-memory seed (dataverse/seed/seed.json)'}`,
  )
})
