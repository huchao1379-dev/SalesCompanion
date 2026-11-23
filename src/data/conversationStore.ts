import type { AgentMessage } from '../agents/types'

/** Legacy single-conversation key — migrated into the library on first load. */
const LEGACY_KEY = 'salescompanion.conversation.v1'
const LIBRARY_KEY = 'salescompanion.conversations.v2'

export type ConversationState = {
  conversationId: string
  context: Record<string, string>
  messages: AgentMessage[]
  updatedAt: string
}

export type ConversationSummary = {
  conversationId: string
  title: string
  preview: string
  accountName?: string
  updatedAt: string
  messageCount: number
  active: boolean
}

type ConversationLibrary = {
  activeId: string
  byId: Record<string, ConversationState>
}

function uid() {
  return `conv_${Math.random().toString(36).slice(2, 10)}`
}

function empty(): ConversationState {
  return {
    conversationId: uid(),
    context: {},
    messages: [],
    updatedAt: new Date().toISOString(),
  }
}

function titleFrom(state: ConversationState): string {
  const firstUser = state.messages.find((m) => m.role === 'user')
  const text = firstUser?.content?.replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, 32) + (text.length > 32 ? '…' : '')
  return '新对话'
}

function previewFrom(state: ConversationState): string {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i]
    if (!m?.content?.trim()) continue
    const text = m.content.replace(/\s+/g, ' ').trim()
    return text.slice(0, 48) + (text.length > 48 ? '…' : '')
  }
  return '暂无消息'
}

function readLibrary(): ConversationLibrary {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as ConversationLibrary
      if (parsed?.activeId && parsed.byId && typeof parsed.byId === 'object') {
        if (!parsed.byId[parsed.activeId]) {
          const fresh = empty()
          return { activeId: fresh.conversationId, byId: { ...parsed.byId, [fresh.conversationId]: fresh } }
        }
        return parsed
      }
    }
  } catch {
    /* fall through to migrate / empty */
  }

  // Migrate legacy single conversation if present.
  try {
    const legacyRaw = localStorage.getItem(LEGACY_KEY)
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as ConversationState
      if (legacy?.conversationId) {
        const lib: ConversationLibrary = {
          activeId: legacy.conversationId,
          byId: { [legacy.conversationId]: { ...legacy, updatedAt: legacy.updatedAt || new Date().toISOString() } },
        }
        localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib))
        return lib
      }
    }
  } catch {
    /* ignore */
  }

  const fresh = empty()
  const lib: ConversationLibrary = { activeId: fresh.conversationId, byId: { [fresh.conversationId]: fresh } }
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib))
  return lib
}

function writeLibrary(lib: ConversationLibrary) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib))
  // Keep legacy key in sync for any old readers.
  const active = lib.byId[lib.activeId]
  if (active) localStorage.setItem(LEGACY_KEY, JSON.stringify(active))
}

export function loadConversation(): ConversationState {
  const lib = readLibrary()
  return lib.byId[lib.activeId] || empty()
}

export function saveConversation(state: ConversationState) {
  const next: ConversationState = { ...state, updatedAt: new Date().toISOString() }
  const lib = readLibrary()
  lib.byId[next.conversationId] = next
  lib.activeId = next.conversationId
  writeLibrary(lib)
  return next
}

/** Wipe the active thread in place (kept for compatibility). Prefer createConversation for「新建」. */
export function clearConversation() {
  const lib = readLibrary()
  const fresh = empty()
  delete lib.byId[lib.activeId]
  lib.byId[fresh.conversationId] = fresh
  lib.activeId = fresh.conversationId
  writeLibrary(lib)
  return fresh
}

/** Start a new empty chat; previous non-empty chats remain in the list. */
export function createConversation(): ConversationState {
  const lib = readLibrary()
  const current = lib.byId[lib.activeId]
  // Drop empty shells so the list does not fill with blank「新对话」.
  if (current && current.messages.length === 0) {
    delete lib.byId[current.conversationId]
  }
  const fresh = empty()
  lib.byId[fresh.conversationId] = fresh
  lib.activeId = fresh.conversationId
  writeLibrary(lib)
  return fresh
}

export function switchConversation(conversationId: string): ConversationState | null {
  const lib = readLibrary()
  const target = lib.byId[conversationId]
  if (!target) return null
  // Persist active pointer; caller should have saved current via saveConversation already.
  if (lib.activeId !== conversationId) {
    const current = lib.byId[lib.activeId]
    if (current && current.messages.length === 0 && current.conversationId !== conversationId) {
      delete lib.byId[current.conversationId]
    }
    lib.activeId = conversationId
    writeLibrary(lib)
  }
  return target
}

export function listConversations(): ConversationSummary[] {
  const lib = readLibrary()
  return Object.values(lib.byId)
    .map((state) => ({
      conversationId: state.conversationId,
      title: titleFrom(state),
      preview: previewFrom(state),
      accountName: state.context.accountName?.trim() || undefined,
      updatedAt: state.updatedAt,
      messageCount: state.messages.length,
      active: state.conversationId === lib.activeId,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function deleteConversation(conversationId: string): ConversationState {
  const lib = readLibrary()
  delete lib.byId[conversationId]
  if (lib.activeId === conversationId) {
    const remaining = Object.values(lib.byId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    if (remaining[0]) {
      lib.activeId = remaining[0].conversationId
    } else {
      const fresh = empty()
      lib.byId[fresh.conversationId] = fresh
      lib.activeId = fresh.conversationId
    }
  }
  writeLibrary(lib)
  return lib.byId[lib.activeId]!
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
