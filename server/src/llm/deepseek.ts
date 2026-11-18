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

async function requestCompletion(
  messages: ChatMessage[],
  options: {
    temperature: number
    responseFormat?: { type: 'json_object' }
    tools?: Array<{
      type: 'function'
      function: { name: string; description: string; parameters: Record<string, unknown> }
    }>
  },
): Promise<CompletionMessage> {
  if (!hasDeepSeek()) throw new Error('DEEPSEEK_UNAVAILABLE')

  const res = await fetch(`${config.deepseekBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.deepseekApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      temperature: options.temperature,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      ...(options.tools?.length
        ? { tools: options.tools, tool_choice: 'auto' }
        : {}),
      messages,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 200)}`)
  }

  const body = (await res.json()) as CompletionResponse
  const choice = body.choices?.[0]
  if (!choice?.message) throw new Error('DeepSeek returned no message')
  return choice.message
}

export async function chatStructured<T>(params: {
  system: string
  user: string
  temperature?: number
  schema: z.ZodType<T>
}): Promise<{ data: T; mode: 'deepseek'; raw: string }> {
  const message = await requestCompletion(
    [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    {
      temperature: params.temperature ?? 0.2,
      responseFormat: { type: 'json_object' },
    },
  )
  const raw = message.content ?? '{}'
  return { data: parseStructuredJson(raw, params.schema), mode: 'deepseek', raw }
}

export function parseStructuredJson<T>(raw: string, schema: z.ZodType<T>): T {
  const parsed: unknown = JSON.parse(stripFences(raw))
  return schema.parse(parsed)
}

/** Executes only the explicitly supplied tool allow-list and validates every argument. */
export async function chatWithTools(params: {
  system: string
  user: string
  tools: ChatTool[]
  temperature?: number
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

export { hasDeepSeek }
