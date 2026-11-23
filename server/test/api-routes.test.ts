import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express from 'express'
import { apiRouter } from '../src/routes/api.js'

test('health advertises the activity and opportunity insight routes', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api', apiRouter)
  const server = app.listen(0, '127.0.0.1')

  try {
    await once(server, 'listening')
    const { port } = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${port}/api`

    const healthResponse = await fetch(`${baseUrl}/health`)
    assert.equal(healthResponse.status, 200)
    const health = await healthResponse.json() as {
      agents?: number
      skills?: number
      capabilities?: { activityInsight?: boolean; opportunityInsight?: boolean }
    }
    assert.equal(health.capabilities?.activityInsight, true)
    assert.equal(health.capabilities?.opportunityInsight, true)
    assert.ok((health.agents ?? 0) > 0)
    assert.ok((health.skills ?? 0) >= 7)

    const agentsResponse = await fetch(`${baseUrl}/agents`)
    assert.equal(agentsResponse.status, 200)
    const agentsBody = await agentsResponse.json() as {
      agents?: unknown[]
      skills?: Array<{ intent?: string }>
    }
    assert.ok((agentsBody.agents?.length ?? 0) > 0)
    assert.ok(agentsBody.skills?.some((s) => s.intent === 'general_assist'))

    const invalidInsightResponse = await fetch(`${baseUrl}/activity-insight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(invalidInsightResponse.status, 400)
    assert.deepEqual(await invalidInsightResponse.json(), {
      error: 'activity.orgName required',
    })

    const invalidOppInsightResponse = await fetch(`${baseUrl}/opportunity-insight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(invalidOppInsightResponse.status, 400)
    assert.deepEqual(await invalidOppInsightResponse.json(), {
      error: 'opportunity.accountName required',
    })
  } finally {
    server.close()
    await once(server, 'close')
  }
})
