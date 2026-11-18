import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { z } from 'zod'
import { config } from '../src/config.js'
import { parseStructuredJson } from '../src/llm/deepseek.js'
import type { ChatTool } from '../src/llm/deepseek.js'

const originalFetch = globalThis.fetch
const originalProvider = config.aiProvider
const originalApiKey = config.deepseekApiKey

afterEach(() => {
  globalThis.fetch = originalFetch
  config.aiProvider = originalProvider
  config.deepseekApiKey = originalApiKey
})

test('structured JSON is parsed and validated at runtime', async () => {
  const schema = z.object({ answer: z.string(), confidence: z.number().min(0).max(1) })

  assert.deepEqual(parseStructuredJson('{"answer":"ok","confidence":0.8}', schema), {
    answer: 'ok',
    confidence: 0.8,
  })
  assert.throws(() => parseStructuredJson('{"answer":4,"confidence":2}', schema), z.ZodError)
})

test('tool calls are allow-listed, validated, executed, and returned to the model', async () => {
  config.aiProvider = 'deepseek'
  config.deepseekApiKey = 'test-key'
  const requestBodies: Array<Record<string, unknown>> = []
  const responses = [
    {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_search_1',
            type: 'function',
            function: { name: 'search_accounts', arguments: '{"query":"仁济医院"}' },
          }],
        },
      }],
    },
    { choices: [{ message: { content: '{"answer":"已找到客户","confidence":0.9}' } }] },
  ]
  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    const body = responses.shift()
    assert.ok(body)
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  const { chatWithTools } = await import('../src/llm/deepseek.js')
  let executed = 0
  const tool: ChatTool = {
    name: 'search_accounts',
    description: 'Search accounts',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    inputSchema: z.object({ query: z.string().min(1) }),
    async execute(input) {
      executed += 1
      return { matches: [{ id: 'acc_1', name: (input as { query: string }).query }] }
    },
  }

  const result = await chatWithTools({ system: 'Use the tool.', user: 'Find Renji.', tools: [tool] })

  assert.equal(executed, 1)
  assert.equal(result.finalText, '{"answer":"已找到客户","confidence":0.9}')
  assert.equal(result.toolResults.length, 1)
  const secondMessages = requestBodies[1].messages as Array<Record<string, unknown>>
  assert.ok(secondMessages.some((message) => message.role === 'tool' && message.tool_call_id === 'call_search_1'))
})

test('invalid tool arguments are not passed to the handler', async () => {
  config.aiProvider = 'deepseek'
  config.deepseekApiKey = 'test-key'
  const responses = [
    {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_search_invalid',
            type: 'function',
            function: { name: 'search_accounts', arguments: '{"query":42}' },
          }],
        },
      }],
    },
    { choices: [{ message: { content: 'no result' } }] },
  ]
  globalThis.fetch = (async () => {
    const body = responses.shift()
    assert.ok(body)
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch

  const { chatWithTools } = await import('../src/llm/deepseek.js')
  let executed = false
  const result = await chatWithTools({
    system: 'Use the tool.',
    user: 'Find account.',
    tools: [{
      name: 'search_accounts',
      description: 'Search accounts',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      inputSchema: z.object({ query: z.string().min(1) }),
      async execute() {
        executed = true
        return []
      },
    }],
  })

  assert.equal(executed, false)
  assert.deepEqual(result.toolResults[0]?.result, { error: 'Invalid tool arguments' })
})
