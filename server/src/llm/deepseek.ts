import { config, hasDeepSeek } from '../config.js'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function chatJson<T>(params: {
  system: string
  user: string
  temperature?: number
}): Promise<{ data: T; mode: 'deepseek' | 'heuristic'; raw?: string }> {
  if (!hasDeepSeek()) {
    throw new Error('DEEPSEEK_UNAVAILABLE')
  }

  const res = await fetch(`${config.deepseekBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.deepseekApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      temperature: params.temperature ?? 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 200)}`)
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = body.choices?.[0]?.message?.content ?? '{}'
  const data = JSON.parse(stripFences(raw)) as T
  return { data, mode: 'deepseek', raw }
}

function stripFences(text: string) {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

export { hasDeepSeek }
