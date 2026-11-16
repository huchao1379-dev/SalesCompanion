import type { AgentMessage } from '../agents/types'

const STORAGE_KEY = 'salescompanion.conversation.v1'

export type ConversationState = {
  conversationId: string
  context: Record<string, string>
  messages: AgentMessage[]
  updatedAt: string
}

function empty(): ConversationState {
  return {
    conversationId: `conv_${Math.random().toString(36).slice(2, 10)}`,
    context: {},
    messages: [],
    updatedAt: new Date().toISOString(),
  }
}

export function loadConversation(): ConversationState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty()
    return JSON.parse(raw) as ConversationState
  } catch {
    return empty()
  }
}

export function saveConversation(state: ConversationState) {
  const next = { ...state, updatedAt: new Date().toISOString() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function clearConversation() {
  const next = empty()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function appendMessages(
  state: ConversationState,
  messages: AgentMessage[],
  context?: Record<string, string>,
): ConversationState {
  return saveConversation({
    ...state,
    messages: [...state.messages, ...messages],
    context: { ...state.context, ...context },
  })
}
