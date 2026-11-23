import type { z } from 'zod'

export type LlmSuccessMode = 'deepseek' | 'openai'

export type ToolCall = {
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
