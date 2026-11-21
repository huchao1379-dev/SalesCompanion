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

/** Drop active-account memory so follow-up pronouns do not stick to the wrong hospital. */
export function clearAccountContext(state: ConversationState): ConversationState {
  const context = { ...state.context }
  delete context.accountId
  delete context.accountName
  delete context.accountRef
  delete context.opportunityId
  delete context.lastActivityKey
  delete context.lastOpportunityKey
  return saveConversation({ ...state, context })
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

export function updateMessage(
  state: ConversationState,
  messageId: string,
  patch: Partial<AgentMessage>,
): ConversationState {
  return saveConversation({
    ...state,
    messages: state.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
  })
}

export function replaceMessage(
  state: ConversationState,
  messageId: string,
  nextMessages: AgentMessage[],
  context?: Record<string, string>,
): ConversationState {
  const idx = state.messages.findIndex((m) => m.id === messageId)
  if (idx < 0) {
    return appendMessages(state, nextMessages, context)
  }
  return saveConversation({
    ...state,
    messages: [...state.messages.slice(0, idx), ...nextMessages, ...state.messages.slice(idx + 1)],
    context: { ...state.context, ...context },
  })
}
