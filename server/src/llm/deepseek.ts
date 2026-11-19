import { z } from 'zod'
import { config, hasDeepSeek } from '../config.js'

type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }

export type ChatTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  inputSchema: z.ZodType
  execute: (input: unknown) => Promise<unknown>
}

type CompletionMessage = {
  content?: string | null
  tool_calls?: ToolCall[]
}

type CompletionResponse = {
  choices?: Array<{ message?: CompletionMessage; finish_reason?: string }>
}

type CompletionOptions = {
  temperature: number
  maxTokens?: number
  responseFormat?: { type: 'json_object' }
  tools?: Array<{
    type: 'function'
    function: { name: string; description: string; parameters: Record<string, unknown> }
  }>
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_ATTEMPTS = 2

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postCompletion(body: Record<string, unknown>): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${config.deepseekBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.deepseekApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (res.ok) return res
      // Retry only transient failures; validation errors are deterministic.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
        lastError = new Error(`DeepSeek HTTP ${res.status}`)
        await sleep(350 * (attempt + 1))
        continue
      }
      const text = await res.text()
      throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 200)}`)
    } catch (error) {
      lastError = error
      if (attempt >= MAX_ATTEMPTS - 1) break
      await sleep(350 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('DeepSeek request failed')
}

async function requestCompletion(
  messages: ChatMessage[],
  options: CompletionOptions,
): Promise<CompletionMessage> {
  if (!hasDeepSeek()) throw new Error('DEEPSEEK_UNAVAILABLE')

  const res = await postCompletion({
    model: config.deepseekModel,
    temperature: options.temperature,
    max_tokens: options.maxTokens ?? 800,
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    ...(options.tools?.length
      ? { tools: options.tools, tool_choice: 'auto' }
      : {}),
    messages,
  })

  const body = (await res.json()) as CompletionResponse
  const choice = body.choices?.[0]
  if (!choice?.message) throw new Error('DeepSeek returned no message')
  return choice.message
}

export async function chatStructured<T>(params: {
  system: string
  user: string
  temperature?: number
  maxTokens?: number
  schema: z.ZodType<T>
}): Promise<{ data: T; mode: 'deepseek'; raw: string }> {
  const messages: ChatMessage[] = [
    { role: 'system', content: params.system },
    { role: 'user', content: params.user },
  ]
  const options: CompletionOptions = {
    temperature: params.temperature ?? 0.2,
    maxTokens: params.maxTokens ?? 800,
    responseFormat: { type: 'json_object' },
  }
  const first = await requestCompletion(messages, options)
  const raw = first.content ?? '{}'

  try {
    return { data: parseStructuredJson(raw, params.schema), mode: 'deepseek', raw }
  } catch {
    // One repair attempt with the invalid output kept in context.
    const repaired = await requestCompletion(
      [
        ...messages,
        { role: 'assistant', content: raw },
        {
          role: 'user',
          content:
            '上一次输出不是合法 JSON，或缺少必需字段。请只输出符合要求的 JSON，不要 Markdown、不要解释。',
        },
      ],
      { ...options, temperature: 0 },
    )
    const repairedRaw = repaired.content ?? '{}'
    return {
      data: parseStructuredJson(repairedRaw, params.schema),
      mode: 'deepseek',
      raw: repairedRaw,
    }
  }
}

export function parseStructuredJson<T>(raw: string, schema: z.ZodType<T>): T {
  const json = extractJsonObject(raw)
  const parsed: unknown = JSON.parse(json)
  return schema.parse(parsed)
}

/** Executes only the explicitly supplied tool allow-list and validates every argument. */
export async function chatWithTools(params: {
  system: string
  user: string
  tools: ChatTool[]
  temperature?: number
  maxTokens?: number
  maxToolRounds?: number
}): Promise<{
  mode: 'deepseek'
  finalText: string
  toolResults: Array<{ name: string; result: unknown }>
}> {
  const toolsByName = new Map(params.tools.map((tool) => [tool.name, tool]))
  const messages: ChatMessage[] = [
    { role: 'system', content: params.system },
    { role: 'user', content: params.user },
  ]
  const toolResults: Array<{ name: string; result: unknown }> = []
  const maxToolRounds = Math.max(1, Math.min(params.maxToolRounds ?? 3, 5))

  for (let round = 0; round <= maxToolRounds; round += 1) {
    const message = await requestCompletion(messages, {
      temperature: params.temperature ?? 0.1,
      maxTokens: params.maxTokens ?? 700,
      tools: params.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    })
    const calls = message.tool_calls ?? []
    if (calls.length === 0) {
      return { mode: 'deepseek', finalText: message.content ?? '', toolResults }
    }
    if (round === maxToolRounds) throw new Error('DeepSeek exceeded the tool-call round limit')

    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls })
    for (const call of calls) {
      const tool = toolsByName.get(call.function.name)
      let result: unknown
      if (!tool) {
        result = { error: 'Tool is not available' }
      } else {
        try {
          const args: unknown = JSON.parse(call.function.arguments)
          const validated = tool.inputSchema.parse(args)
          result = await tool.execute(validated)
        } catch (error) {
          result = {
            error: error instanceof z.ZodError
              ? 'Invalid tool arguments'
              : error instanceof Error
                ? error.message
                : 'Tool execution failed',
          }
        }
      }
      toolResults.push({ name: call.function.name, result })
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12000),
      })
    }
  }

  throw new Error('DeepSeek tool loop ended unexpectedly')
}

function stripFences(text: string) {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

/** Extract the first balanced JSON object; tolerates leading/trailing prose. */
function extractJsonObject(text: string) {
  const stripped = stripFences(text)
  const start = stripped.indexOf('{')
  if (start < 0) return stripped
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < stripped.length; i += 1) {
    const char = stripped[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return stripped.slice(start, i + 1)
    }
  }
  return stripped
}

export { hasDeepSeek }
