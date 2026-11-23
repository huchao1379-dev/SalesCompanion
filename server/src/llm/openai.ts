/**
 * OpenAI Responses API client — preferred path for gpt-6-luna
 * (reasoning + function calling). Chat Completions tool-calling on Luna
 * only works with reasoning_effort=none; Responses supports both.
 */
import { z } from 'zod'
import { config, hasOpenAI } from '../config.js'
import { wrapLlmFetchError } from './errors.js'
import { parseJsonLenient } from './jsonRepair.js'
import type { ChatMessage, ChatTool } from './types.js'

type FunctionCallItem = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

type ResponseOutputItem =
  | FunctionCallItem
  | {
      type: 'message'
      content?: Array<{ type?: string; text?: string }>
    }
  | { type: string; [key: string]: unknown }

type ResponsesApiResult = {
  id: string
  output_text?: string
  output?: ResponseOutputItem[]
}

const REQUEST_TIMEOUT_MS = 45_000
const MAX_ATTEMPTS = 2

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isFunctionCall(item: ResponseOutputItem): item is FunctionCallItem {
  return item.type === 'function_call' && typeof (item as FunctionCallItem).call_id === 'string'
}

function extractOutputText(result: ResponsesApiResult): string {
  if (typeof result.output_text === 'string' && result.output_text.trim()) {
    return result.output_text
  }
  const chunks: string[] = []
  for (const item of result.output || []) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') chunks.push(part.text)
      else if (typeof part?.text === 'string') chunks.push(part.text)
    }
  }
  return chunks.join('\n').trim()
}

function extractFunctionCalls(result: ResponsesApiResult): FunctionCallItem[] {
  return (result.output || []).filter(isFunctionCall)
}

async function postResponses(body: Record<string, unknown>): Promise<ResponsesApiResult> {
  if (!hasOpenAI()) throw new Error('OPENAI_UNAVAILABLE')

  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${config.openaiBaseUrl}/v1/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (res.ok) {
        return (await res.json()) as ResponsesApiResult
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
        lastError = new Error(`OpenAI HTTP ${res.status}`)
        await sleep(350 * (attempt + 1))
        continue
      }
      const text = await res.text()
      throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 240)}`)
    } catch (error) {
      lastError = error
      if (attempt >= MAX_ATTEMPTS - 1) break
      await sleep(350 * (attempt + 1))
    }
  }
  throw wrapLlmFetchError(
    'OpenAI',
    lastError instanceof Error ? lastError : new Error('OpenAI request failed'),
  )
}

function baseBody(extra: Record<string, unknown>): Record<string, unknown> {
  const effort = config.openaiReasoningEffort
  const body: Record<string, unknown> = {
    model: config.openaiModel,
    reasoning: { effort },
    ...extra,
  }
  // Temperature is most reliable when reasoning is off.
  if (effort === 'none' && typeof extra.temperature === 'number') {
    body.temperature = extra.temperature
  } else {
    delete body.temperature
  }
  return body
}

function toInputFromMessages(messages: ChatMessage[]): unknown[] {
  const input: unknown[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      input.push({ role: 'developer', content: message.content })
      continue
    }
    if (message.role === 'user') {
      input.push({ role: 'user', content: message.content })
      continue
    }
    if (message.role === 'assistant') {
      input.push({
        role: 'assistant',
        content: message.content ?? '',
      })
    }
  }
  return input
}

export async function chatStructured<T>(params: {
  system: string
  user: string
  temperature?: number
  maxTokens?: number
  schema: z.ZodType<T>
}): Promise<{ data: T; mode: 'openai'; raw: string }> {
  const makeRequest = async (messages: ChatMessage[]) => {
    const result = await postResponses(
      baseBody({
        temperature: params.temperature ?? 0.2,
        max_output_tokens: params.maxTokens ?? 800,
        input: toInputFromMessages(messages),
        text: { format: { type: 'json_object' } },
      }),
    )
    return extractOutputText(result) || '{}'
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: params.system },
    { role: 'user', content: params.user },
  ]
  const raw = await makeRequest(messages)

  try {
    return {
      data: params.schema.parse(parseJsonLenient(raw)),
      mode: 'openai',
      raw,
    }
  } catch {
    const repairedRaw = await makeRequest([
      ...messages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content:
          '上一次输出不是合法 JSON，或缺少必需字段。请只输出符合要求的 JSON，不要 Markdown、不要解释。',
      },
    ])
    return {
      data: params.schema.parse(parseJsonLenient(repairedRaw)),
      mode: 'openai',
      raw: repairedRaw,
    }
  }
}

export async function chatWithTools(params: {
  system: string
  user: string
  tools: ChatTool[]
  temperature?: number
  maxTokens?: number
  maxToolRounds?: number
}): Promise<{
  mode: 'openai'
  finalText: string
  toolResults: Array<{ name: string; result: unknown }>
}> {
  const toolsByName = new Map(params.tools.map((tool) => [tool.name, tool]))
  const tools = params.tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }))
  const toolResults: Array<{ name: string; result: unknown }> = []
  const maxToolRounds = Math.max(1, Math.min(params.maxToolRounds ?? 3, 5))

  let previousResponseId: string | undefined
  let input: unknown[] = [
    { role: 'developer', content: params.system },
    { role: 'user', content: params.user },
  ]

  for (let round = 0; round <= maxToolRounds; round += 1) {
    const result = await postResponses(
      baseBody({
        temperature: params.temperature ?? 0.1,
        max_output_tokens: params.maxTokens ?? 700,
        tools,
        tool_choice: 'auto',
        ...(previousResponseId
          ? { previous_response_id: previousResponseId, input }
          : { input }),
      }),
    )
    previousResponseId = result.id

    const calls = extractFunctionCalls(result)
    if (calls.length === 0) {
      return {
        mode: 'openai',
        finalText: extractOutputText(result),
        toolResults,
      }
    }
    if (round === maxToolRounds) {
      throw new Error('OpenAI exceeded the tool-call round limit')
    }

    const outputs: unknown[] = []
    for (const call of calls) {
      const tool = toolsByName.get(call.name)
      let toolResult: unknown
      if (!tool) {
        toolResult = { error: 'Tool is not available' }
      } else {
        try {
          const args: unknown = JSON.parse(call.arguments || '{}')
          const validated = tool.inputSchema.parse(args)
          toolResult = await tool.execute(validated)
        } catch (error) {
          toolResult = {
            error:
              error instanceof z.ZodError
                ? 'Invalid tool arguments'
                : error instanceof Error
                  ? error.message
                  : 'Tool execution failed',
          }
        }
      }
      toolResults.push({ name: call.name, result: toolResult })
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(toolResult).slice(0, 12000),
      })
    }
    input = outputs
  }

  throw new Error('OpenAI tool loop ended unexpectedly')
}
