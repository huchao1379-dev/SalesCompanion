import './CopilotChat.css'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ApiRequestError } from '../../api/client'
import type {
  AgentMessage,
  DraftPayload,
  MessageFailureKind,
} from '../../agents/types'
import { copilotOrchestrate } from '../../agents/copilotStudioClient'
import { getOrchestratorMode, orchestrate } from '../../agents/orchestratorClient'
import { DraftCard } from '../../components/DraftCard'
import {
  IconBack,
  IconMic,
  IconPaperclip,
  IconSendUp,
  IconStop,
} from '../../components/DashIcons'
import { MessageUiCard } from '../../components/MessageUiCard'
import {
  appendMessages,
  clearConversation,
  loadConversation,
  replaceMessage,
  updateMessage,
  type ConversationState,
} from '../../data/conversationStore'
import { confirmAndSync, discardDraft, upsertDraft } from '../../data/dataverse'
import { useWebSpeech } from '../../speech/useWebSpeech'

type PendingAttachment = {
  id: string
  file: File
  name: string
  sizeLabel: string
  kind: 'image' | 'file'
  previewUrl?: string
}

type GenerationHandle = {
  id: number
  controller: AbortController
  stopped: boolean
  completed: boolean
  assistantId: string
}

const ATTACH_ACCEPT =
  'image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.md'
const ATTACH_MAX_COUNT = 5
const ATTACH_MAX_BYTES = 10 * 1024 * 1024
const BOT_NAME = 'Copilot'
const NEAR_BOTTOM_PX = 96
const TIME_GROUP_MS = 2 * 60 * 1000

const PROGRESS_PHASES = [
  { afterMs: 0, label: '正在理解问题' },
  { afterMs: 1400, label: '正在查询相关信息' },
  { afterMs: 3800, label: '正在整理答复' },
] as const

const HELP_ITEMS = [
  '查询客户信息与商机状态',
  '查看今日日程与待办',
  '分析销售趋势与业绩数据',
]

const QUICK_CHIPS = [
  { label: "Today's tasks", prompt: "What's on my agenda today?" },
  { label: 'Pipeline status', prompt: 'Summarize my current pipeline status.' },
  { label: 'Follow-ups', prompt: 'What follow-ups should I do next?' },
]

type Props = {
  initialPrompt?: string
  onBack?: () => void
  onOpenAccount?: (accountKey: string) => void
  onOpenOpportunity?: () => void
  onOpenTasks?: () => void
}

const CHAT_PROVIDER =
  import.meta.env.VITE_CHAT_PROVIDER?.trim().toLowerCase() === 'deepseek'
    ? 'deepseek'
    : 'copilotstudio'

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatClock(d: Date) {
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatMessageTime(iso: string, now = new Date()) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (isSameDay(d, now)) return formatClock(d)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(d, yesterday)) return `昨天 ${formatClock(d)}`
  return `${d.getMonth() + 1}/${d.getDate()} ${formatClock(d)}`
}

function shouldShowTimestamp(messages: AgentMessage[], index: number) {
  const current = messages[index]
  const next = messages[index + 1]
  if (!current?.createdAt) return false
  if (!next) return true
  if (next.role !== current.role) return true
  const a = new Date(current.createdAt).getTime()
  const b = new Date(next.createdAt).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return true
  return Math.abs(b - a) > TIME_GROUP_MS
}

function mergeSources(a: AgentMessage['sources'] = [], b: AgentMessage['sources'] = []) {
  const out = [...a]
  for (const s of b) {
    if (
      !out.some(
        (x) => x.kind === s.kind && x.label === s.label && (x.ref || '') === (s.ref || ''),
      )
    ) {
      out.push(s)
    }
  }
  return out
}

function mergeAgentChains(a?: string[], b?: string[]) {
  const out: string[] = []
  for (const step of [...(a || []), ...(b || [])]) {
    const t = step.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out.length ? out : undefined
}

/** Collapse same-turn assistant spam (orchestrator + step agents) into one bubble. */
function dedupeAssistantMessages(messages: AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = []
  for (const m of messages) {
    const prev = out[out.length - 1]
    const sameTurnAssistant =
      prev &&
      m.role !== 'user' &&
      prev.role !== 'user' &&
      prev.deliveryStatus !== 'pending' &&
      m.deliveryStatus !== 'pending'

    if (sameTurnAssistant) {
      const prevText = prev.content.trim()
      const nextText = m.content.trim()
      const identical = prevText.length > 0 && prevText === nextText
      const nextIsDraftEcho =
        Boolean(m.draft) &&
        nextText.length > 0 &&
        (prevText.includes(nextText) || nextText.length < 80)

      if (identical || nextIsDraftEcho || Boolean(m.draft)) {
        const mergedContent =
          identical || nextIsDraftEcho || prevText.includes(nextText)
            ? prev.content
            : [prev.content, m.content].filter((t) => t.trim()).join('\n\n')
        out[out.length - 1] = {
          ...prev,
          content: mergedContent,
          sources: mergeSources(prev.sources, m.sources),
          agent_chain: mergeAgentChains(prev.agent_chain, m.agent_chain || [m.agent_name]),
          confidence: Math.max(prev.confidence || 0, m.confidence || 0),
          agent_name: prev.agent_name || m.agent_name,
          ui: prev.ui || m.ui,
        }
        continue
      }
    }

    if (
      prev &&
      m.role !== 'user' &&
      prev.role !== 'user' &&
      prev.content.trim() === m.content.trim() &&
      prev.content.trim().length > 0
    ) {
      out[out.length - 1] = {
        ...prev,
        sources: mergeSources(prev.sources, m.sources),
        agent_chain: mergeAgentChains(prev.agent_chain, m.agent_chain),
        confidence: Math.max(prev.confidence, m.confidence),
        ui: prev.ui || m.ui,
      }
      continue
    }
    out.push(m)
  }
  return out
}

function normalizeAssistantMessages(messages: AgentMessage[], completedAt: string): AgentMessage[] {
  return dedupeAssistantMessages(messages).map((m) => ({
    ...m,
    // Keep backend agent_name for bubble attribution ("来源").
    deliveryStatus: m.deliveryStatus ?? 'complete',
    completedAt: m.completedAt ?? completedAt,
  }))
}

function isAssistantTurnStart(messages: AgentMessage[], index: number) {
  if (messages[index]?.role === 'user') return false
  if (index === 0) return true
  return messages[index - 1]?.role === 'user'
}

function isAssistantTurnEnd(messages: AgentMessage[], index: number) {
  if (messages[index]?.role === 'user') return false
  const next = messages[index + 1]
  return !next || next.role === 'user'
}

function messageOriginLabel(m: AgentMessage) {
  if (m.role === 'user') return '你'
  // Prefer business provenance over internal agent names for sales users.
  if (m.ui?.originLabel?.trim()) return m.ui.originLabel.trim()
  if (m.ui?.type === 'account_pulse' || m.ui?.type === 'order_status') return 'CRM 数据'
  const name = m.agent_name?.trim()
  if (name && !/^you$/i.test(name) && !/Agent$/i.test(name)) return name
  if (name && /画像|订单|总结/.test(name)) return 'CRM 数据'
  const steps = footprintSteps(m)
  if (steps.length) return steps.join(' · ')
  return BOT_NAME
}

function classifyFailure(err: unknown): {
  kind: MessageFailureKind
  content: string
} {
  if (err instanceof ApiRequestError) {
    if (err.kind === 'network') {
      return { kind: 'network', content: '暂时无法连接服务，请检查网络后重试' }
    }
    const detail = `${err.detail || ''} ${err.message}`.toLowerCase()
    if (/query|查询|dataverse|sap|订单|物流/.test(detail)) {
      return { kind: 'query', content: '查询失败，请稍后重试' }
    }
    if (/sync|write|写入|confirm|draft|同步/.test(detail)) {
      return { kind: 'write', content: '业务写入失败，请稍后重试' }
    }
    return { kind: 'generation', content: '回答生成失败，请稍后重试' }
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (/failed to fetch|network|load failed|连接/.test(msg)) {
      return { kind: 'network', content: '暂时无法连接服务，请检查网络后重试' }
    }
  }
  return { kind: 'unknown', content: '回答生成失败，请稍后重试' }
}

function failureLabel(kind?: MessageFailureKind) {
  if (kind === 'network') return '网络错误'
  if (kind === 'query') return '查询失败'
  if (kind === 'write') return '写入失败'
  if (kind === 'generation') return '生成失败'
  return '请求失败'
}

/** Only show "提取置信" after visit-field extraction that needs human review. */
function shouldShowExtractionConfidence(m: AgentMessage) {
  if (!(m.confidence > 0)) return false
  if (m.ui?.type === 'account_pulse' || m.ui?.type === 'order_status') return false
  if (/画像|订单|总结|Orchestrator/i.test(m.agent_name || '')) return false
  // Draft-bearing replies are the visit-capture extraction path.
  if (m.draft) return true
  const chain = m.agent_chain || []
  return chain.some((c) => /EntityExtract|活动创建|商机创建|实体抽取/i.test(c))
}

function footprintSteps(m: AgentMessage) {
  const chain = (m.agent_chain || []).filter(Boolean)
  const unique = [...new Set(chain.map((c) => c.trim()).filter(Boolean))]
  return unique.filter(
    (c) =>
      !/^orchestrator$/i.test(c) &&
      c !== BOT_NAME &&
      c !== m.agent_name &&
      !/Agent$/i.test(c),
  )
}

export function CopilotChat(props: Props) {
  return <NativeChat {...props} />
}

function NativeChat({
  initialPrompt = '',
  onBack,
  onOpenAccount,
  onOpenOpportunity,
  onOpenTasks,
}: Props) {
  const speech = useWebSpeech()
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const draftsStartRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const genRef = useRef<GenerationHandle | null>(null)
  const genSeqRef = useRef(0)
  const prevDraftCountRef = useRef(0)
  const [input, setInput] = useState(initialPrompt)
  const [conversation, setConversation] = useState<ConversationState>(() => loadConversation())
  const conversationRef = useRef(conversation)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [drafts, setDrafts] = useState<DraftPayload[]>([])
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [showNewMsgHint, setShowNewMsgHint] = useState(false)
  const [clearArmed, setClearArmed] = useState(false)

  const messages = useMemo(
    () => dedupeAssistantMessages(conversation.messages),
    [conversation.messages],
  )
  const isEmpty = messages.length === 0
  const hasSendable = Boolean(input.trim() || attachments.length)
  const canSend = hasSendable && !busy && !generating
  const accountKey = conversation.context.accountRef || conversation.context.accountId

  useEffect(() => {
    const isIOS =
      /iP(hone|od|ad)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    if (isIOS) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(t)
  }, [])

  const attachmentsRef = useRef(attachments)
  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
      })
      genRef.current?.controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!clearArmed) return
    const t = window.setTimeout(() => setClearArmed(false), 4000)
    return () => window.clearTimeout(t)
  }, [clearArmed])

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return

    const draftCount = drafts.length
    const draftsJustAppeared = draftCount > prevDraftCountRef.current
    prevDraftCountRef.current = draftCount

    if (!stickToBottomRef.current) {
      setShowNewMsgHint(true)
      return
    }

    // When drafts arrive, pin the draft block under the last message instead of
    // jumping to the card bottom (which made the tall card look like it covered chat).
    const run = () => {
      if (draftsJustAppeared && draftsStartRef.current) {
        draftsStartRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      }
      setShowNewMsgHint(false)
    }

    // Wait a frame so draft layout height is committed before scrolling.
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run)
    })
    return () => window.cancelAnimationFrame(id)
  }, [messages, drafts, generating])

  function onBodyScroll() {
    const el = bodyRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distance < NEAR_BOTTOM_PX
    stickToBottomRef.current = nearBottom
    if (nearBottom) setShowNewMsgHint(false)
  }

  function scrollToLatest() {
    const el = bodyRef.current
    if (!el) return
    stickToBottomRef.current = true
    setShowNewMsgHint(false)
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  function setConversationState(next: ConversationState) {
    conversationRef.current = next
    setConversation(next)
  }

  function clearAttachments(list: PendingAttachment[] = attachments) {
    list.forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
    })
    setAttachments([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onPickFiles(fileList: FileList | null) {
    if (!fileList?.length) return
    const incoming = Array.from(fileList)
    const next: PendingAttachment[] = []
    const errors: string[] = []

    for (const file of incoming) {
      if (attachments.length + next.length >= ATTACH_MAX_COUNT) {
        errors.push(`最多 ${ATTACH_MAX_COUNT} 个附件`)
        break
      }
      if (file.size > ATTACH_MAX_BYTES) {
        errors.push(`${file.name} 超过 10MB`)
        continue
      }
      const isImage = file.type.startsWith('image/')
      next.push({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        sizeLabel: formatBytes(file.size),
        kind: isImage ? 'image' : 'file',
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      })
    }

    if (next.length) setAttachments((prev) => [...prev, ...next])
    if (errors.length) console.warn('[chat] attach', errors[0])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }

  function startProgressTicker(assistantId: string, generationId: number) {
    const timers: number[] = []
    for (const phase of PROGRESS_PHASES) {
      if (phase.afterMs === 0) continue
      const t = window.setTimeout(() => {
        const handle = genRef.current
        if (!handle || handle.id !== generationId || handle.stopped || handle.completed) return
        const next = updateMessage(conversationRef.current, assistantId, {
          progressLabel: phase.label,
        })
        setConversationState(next)
      }, phase.afterMs)
      timers.push(t)
    }
    return () => timers.forEach((t) => window.clearTimeout(t))
  }

  async function runGeneration(utterance: string, opts?: { retryAssistantId?: string }) {
    // Guard with refs to avoid double-submit from stale closures.
    if (genRef.current) return

    const stamp = new Date().toISOString()
    const controller = new AbortController()
    const generationId = ++genSeqRef.current
    const assistantId = opts?.retryAssistantId || uid('asst')

    // Reserve the slot immediately so a second Enter cannot start another turn.
    genRef.current = {
      id: generationId,
      controller,
      stopped: false,
      completed: false,
      assistantId,
    }
    setGenerating(true)
    setClearArmed(false)

    const pendingMsg: AgentMessage = {
      id: assistantId,
      role: 'assistant',
      agent_name: BOT_NAME,
      content: '',
      sources: [],
      confidence: 0,
      createdAt: stamp,
      deliveryStatus: 'pending',
      progressLabel: PROGRESS_PHASES[0].label,
      retryUtterance: utterance,
    }

    let base = conversationRef.current
    if (opts?.retryAssistantId) {
      base = updateMessage(base, assistantId, {
        content: '',
        sources: [],
        confidence: 0,
        createdAt: stamp,
        completedAt: undefined,
        deliveryStatus: 'pending',
        progressLabel: PROGRESS_PHASES[0].label,
        failureKind: undefined,
        retryUtterance: utterance,
        agent_name: BOT_NAME,
        agent_chain: undefined,
      })
    } else {
      base = appendMessages(base, [pendingMsg])
    }
    setConversationState(base)

    const handle = genRef.current!
    const stopTicker = startProgressTicker(assistantId, generationId)

    try {
      const runAgent = CHAT_PROVIDER === 'deepseek' ? orchestrate : copilotOrchestrate
      const res = await runAgent(
        {
          utterance,
          context: {
            ...conversationRef.current.context,
            conversationId: conversationRef.current.conversationId,
          },
        },
        { signal: controller.signal },
      )

      // Superseded by a newer turn — ignore. If stop raced with a finished response,
      // prefer the completed reply over a "stopped" label.
      if (genRef.current?.id !== generationId) return

      handle.completed = true
      handle.stopped = false
      const completedAt = new Date().toISOString()
      res.drafts.forEach((d) => upsertDraft(d))
      setDrafts(res.drafts)

      const normalized = normalizeAssistantMessages(res.messages, completedAt)
      const next = replaceMessage(
        conversationRef.current,
        assistantId,
        normalized.length
          ? normalized
          : [
              {
                id: assistantId,
                role: 'assistant',
                agent_name: BOT_NAME,
                content: '暂时没有可展示的答复。',
                sources: [],
                confidence: 0,
                createdAt: stamp,
                completedAt,
                deliveryStatus: 'complete',
              },
            ],
        res.context,
      )
      setConversationState(next)
      console.info(
        `[chat] ok intent=${res.intent || '—'} mode=${res.mode || getOrchestratorMode()} ${res.latencyMs}ms`,
      )
    } catch (err) {
      if (handle.completed || genRef.current?.id !== generationId) return

      const aborted =
        handle.stopped || (err instanceof ApiRequestError && err.kind === 'abort')
      if (aborted) {
        const stoppedAt = new Date().toISOString()
        const current = conversationRef.current.messages.find((m) => m.id === assistantId)
        const next = updateMessage(conversationRef.current, assistantId, {
          deliveryStatus: 'stopped',
          progressLabel: undefined,
          completedAt: stoppedAt,
          content: current?.content?.trim() ? current.content : '',
        })
        setConversationState(next)
        return
      }

      console.error('[chat] orchestrate failed', err)
      const failure = classifyFailure(err)
      const errAt = new Date().toISOString()
      const next = updateMessage(conversationRef.current, assistantId, {
        deliveryStatus: 'error',
        failureKind: failure.kind,
        content: failure.content,
        progressLabel: undefined,
        completedAt: errAt,
        confidence: 0,
        sources: [],
        retryUtterance: utterance,
      })
      setConversationState(next)
    } finally {
      stopTicker()
      if (genRef.current?.id === generationId) {
        genRef.current = null
      }
      setGenerating(Boolean(genRef.current))
      inputRef.current?.focus()
    }
  }

  async function send(text: string) {
    const trimmed = text.trim()
    const pending = attachments
    if ((!trimmed && pending.length === 0) || busy || generating) return

    const attachLine =
      pending.length === 0
        ? ''
        : `【附件 ${pending.length}】${pending.map((a) => `${a.name}（${a.sizeLabel}）`).join('、')}`
    const utterance = [attachLine, trimmed || '请结合附件帮我处理'].filter(Boolean).join('\n')

    const stamp = new Date().toISOString()
    const userMsg: AgentMessage = {
      id: uid('user'),
      role: 'user',
      agent_name: '你',
      content: utterance,
      sources: pending.map((a) => ({
        kind: 'other' as const,
        label: a.name,
        ref: a.kind,
      })),
      confidence: 1,
      createdAt: stamp,
      deliveryStatus: 'complete',
    }

    clearAttachments(pending)
    setInput('')
    const withUser = appendMessages(conversationRef.current, [userMsg])
    setConversationState(withUser)
    stickToBottomRef.current = true
    await runGeneration(utterance)
  }

  function stopGeneration() {
    const handle = genRef.current
    if (!handle || handle.completed) return
    handle.stopped = true
    handle.controller.abort()
    // Optimistic UI while abort settles; success path may still win the race.
    const current = conversationRef.current.messages.find((m) => m.id === handle.assistantId)
    if (current?.deliveryStatus === 'pending') {
      const next = updateMessage(conversationRef.current, handle.assistantId, {
        deliveryStatus: 'stopped',
        progressLabel: undefined,
        completedAt: new Date().toISOString(),
      })
      setConversationState(next)
    }
  }

  function retryMessage(m: AgentMessage) {
    if (busy || generating || !m.retryUtterance) return
    stickToBottomRef.current = true
    void runGeneration(m.retryUtterance, { retryAssistantId: m.id })
  }

  function updateDraft(next: DraftPayload) {
    setDrafts((prev) => prev.map((d) => (d.idempotencyKey === next.idempotencyKey ? next : d)))
    upsertDraft({ ...next, updatedAt: new Date().toISOString() })
  }

  async function handleConfirm(draft: DraftPayload) {
    setBusy(true)
    try {
      const synced = await confirmAndSync(draft)
      setDrafts((prev) => prev.map((d) => (d.idempotencyKey === synced.idempotencyKey ? synced : d)))
    } catch (err) {
      console.error('[chat] confirm/sync failed', err)
    } finally {
      setBusy(false)
    }
  }

  async function handleDiscard(draft: DraftPayload) {
    setBusy(true)
    try {
      const discarded = await discardDraft(draft)
      setDrafts((prev) =>
        prev.map((d) => (d.idempotencyKey === discarded.idempotencyKey ? discarded : d)),
      )
    } finally {
      setBusy(false)
    }
  }

  function onChip(chip: (typeof QUICK_CHIPS)[number]) {
    if (chip.label === "Today's tasks" && onOpenTasks) {
      onOpenTasks()
      return
    }
    if (chip.label === 'Pipeline status' && onOpenOpportunity) {
      onOpenOpportunity()
      return
    }
    void send(chip.prompt)
  }

  function onClear() {
    if (!clearArmed) {
      setClearArmed(true)
      return
    }
    if (generating) stopGeneration()
    setConversationState(clearConversation())
    setDrafts([])
    setClearArmed(false)
    setShowNewMsgHint(false)
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (busy || generating) return
      void send(input)
    }
  }

  function resizeComposer() {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  useEffect(() => {
    resizeComposer()
  }, [input])

  return (
    <section className={`chat-screen${isEmpty ? ' is-empty' : ''}`} aria-busy={busy || generating}>
      <header className="chat-screen__top">
        {onBack ? (
          <button type="button" className="chat-screen__back" aria-label="返回" onClick={onBack}>
            <IconBack />
          </button>
        ) : (
          <span className="chat-screen__back-spacer" />
        )}
        <h1>Copilot</h1>
        <button
          type="button"
          className={`chat-screen__clear${clearArmed ? ' is-armed' : ''}`}
          onClick={onClear}
          aria-label={clearArmed ? '再次点击确认清空对话' : '清空对话'}
          title={clearArmed ? '再次点击确认清空' : '清空对话'}
        >
          {clearArmed ? '确认清空' : 'Clear'}
        </button>
      </header>

      <div
        className="chat-screen__body"
        ref={bodyRef}
        onScroll={onBodyScroll}
        aria-live="polite"
      >
        {isEmpty && drafts.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty__help">
              <h2>我可以帮你</h2>
              <ol>
                {HELP_ITEMS.map((item, index) => (
                  <li key={item}>
                    <span className="chat-empty__num" aria-hidden>
                      {index + 1}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
            <p className="chat-empty__hint">输入问题，或按住麦克风开始。Enter 发送，Shift+Enter 换行。</p>
          </div>
        ) : (
          <div className="chat-screen__feed">
            {!isEmpty ? (
              <div className="chat__thread" role="log" aria-relevant="additions">
                {messages.map((m, index) => {
                  const isUser = m.role === 'user'
                  const showTime = shouldShowTimestamp(messages, index)
                  const steps = !isUser ? footprintSteps(m) : []
                  const pending = m.deliveryStatus === 'pending'
                  const stopped = m.deliveryStatus === 'stopped'
                  const errored = m.deliveryStatus === 'error'
                  const turnStart = !isUser && isAssistantTurnStart(messages, index)
                  const turnEnd = !isUser && isAssistantTurnEnd(messages, index)
                  const hasUiCard = Boolean(!isUser && !pending && !errored && m.ui)
                  const uiHasAccountAction = Boolean(
                    m.ui?.actions?.some((a) => a.id === 'open_account'),
                  )
                  const showConfidence =
                    !isUser && turnEnd && !pending && shouldShowExtractionConfidence(m)
                  const showAccountLink =
                    Boolean(accountKey && onOpenAccount) &&
                    !isUser &&
                    turnEnd &&
                    !pending &&
                    !errored &&
                    !uiHasAccountAction
                  const originLabel = messageOriginLabel(m)
                  const showSteps =
                    !isUser &&
                    turnEnd &&
                    !pending &&
                    !m.ui &&
                    steps.length > 1
                  const timeLabel = pending
                    ? '正在回复'
                    : isUser
                      ? formatMessageTime(m.createdAt)
                      : stopped
                        ? `已停止 · ${formatMessageTime(m.completedAt || m.createdAt)}`
                        : formatMessageTime(m.completedAt || m.createdAt)
                  const showTimeRow = showTime || pending
                  const showOrigin = !isUser && (turnEnd || pending || errored || stopped)

                  return (
                    <div
                      key={m.id}
                      className={`chat-row chat-row--${isUser ? 'user' : 'assistant'}${turnStart ? ' is-turn-start' : ''}${turnEnd ? ' is-turn-end' : ''}`}
                    >
                      {turnStart ? (
                        <div className="chat-row__identity">
                          <span className="chat-row__bot-name">{BOT_NAME}</span>
                          {pending ? (
                            <span className="chat-row__live" aria-live="polite">
                              正在回复
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      <article
                        className={[
                          'chat-bubble',
                          `chat-bubble--${isUser ? 'user' : 'assistant'}`,
                          pending ? 'is-pending' : '',
                          stopped ? 'is-stopped' : '',
                          errored ? 'is-error' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {pending ? (
                          <div className="chat-progress" role="status">
                            <span className="chat-progress__dot" aria-hidden />
                            <span>{m.progressLabel || '正在处理'}</span>
                          </div>
                        ) : null}

                        {m.content ? (
                          <p
                            className={`chat-bubble__text${errored ? ' is-error-text' : ''}${hasUiCard ? ' is-with-ui' : ''}`}
                          >
                            {m.content}
                          </p>
                        ) : null}

                        {hasUiCard && m.ui ? (
                          <MessageUiCard
                            ui={m.ui}
                            onOpenAccount={onOpenAccount}
                            onOpenOpportunity={onOpenOpportunity}
                          />
                        ) : null}

                        {stopped ? (
                          <p className="chat-bubble__stopped" role="status">
                            已停止生成
                          </p>
                        ) : null}

                        {errored ? (
                          <div className="chat-bubble__error-actions">
                            <span className="chat-bubble__error-kind">
                              {failureLabel(m.failureKind)}
                            </span>
                            <button
                              type="button"
                              className="chat-bubble__retry"
                              onClick={() => retryMessage(m)}
                              disabled={busy || generating || !m.retryUtterance}
                            >
                              重试
                            </button>
                          </div>
                        ) : null}

                        {showSteps ? (
                          <details className="chat-steps">
                            <summary>执行步骤</summary>
                            <ol>
                              {steps.map((step) => (
                                <li key={step}>{step}</li>
                              ))}
                            </ol>
                          </details>
                        ) : null}

                        {showConfidence || showAccountLink ? (
                          <div className="chat-bubble__meta">
                            {showConfidence ? (
                              <span
                                className="confidence"
                                title="来自业务数据源的提取置信，不等于事实准确率"
                              >
                                提取置信 {(m.confidence * 100).toFixed(0)}%
                              </span>
                            ) : null}
                            {showAccountLink && accountKey ? (
                              <button
                                type="button"
                                className="chat-action-link"
                                onClick={() => onOpenAccount?.(accountKey)}
                              >
                                查看客户画像
                                <span aria-hidden>→</span>
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </article>

                      {showOrigin || showTimeRow ? (
                        <div className="chat-row__footer">
                          {showOrigin ? (
                            <div className="chat-row__sources" aria-label="信息来源">
                              <span className="chat-row__agent-chip">{originLabel}</span>
                            </div>
                          ) : null}
                          {showTimeRow ? (
                            <time
                              className="chat-row__time"
                              dateTime={isUser ? m.createdAt : m.completedAt || m.createdAt}
                            >
                              {timeLabel}
                            </time>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : null}

            {drafts.length > 0 ? (
              <section className="chat-drafts" aria-label="本轮草稿">
                <div ref={draftsStartRef} className="chat-drafts__anchor" aria-hidden />
                <div className="chat-drafts__head">
                  <strong>本轮草稿</strong>
                  {drafts.some((d) => d.kind === 'opportunity') && onOpenOpportunity ? (
                    <button type="button" className="chat-action-link" onClick={onOpenOpportunity}>
                      打开商机屏
                      <span aria-hidden>→</span>
                    </button>
                  ) : null}
                </div>
                <div className="chat-drafts__list">
                  {drafts.map((d) => (
                    <DraftCard
                      key={d.idempotencyKey}
                      draft={d}
                      busy={busy || generating}
                      hideSources
                      onChange={updateDraft}
                      onConfirm={(draft) => {
                        void handleConfirm(draft)
                      }}
                      onDiscard={(draft) => {
                        void handleDiscard(draft)
                      }}
                      onRetry={(draft) => {
                        void handleConfirm({ ...draft, syncStatus: 'Draft' })
                      }}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>

      {showNewMsgHint ? (
        <button type="button" className="chat-newmsg" onClick={scrollToLatest}>
          有新消息
        </button>
      ) : null}

      <div className="chat-dock">
        {isEmpty ? (
          <div className="chat-dock__chips">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className="chat-dock__chip"
                disabled={busy || generating}
                onClick={() => onChip(chip)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className="chat-dock__files" aria-label="待发送附件">
            {attachments.map((a) => (
              <span key={a.id} className="chat-dock__file">
                {a.previewUrl ? (
                  <img className="chat-dock__file-thumb" src={a.previewUrl} alt="" />
                ) : null}
                <span className="chat-dock__file-name" title={`${a.name} · ${a.sizeLabel}`}>
                  {a.name}
                </span>
                <button
                  type="button"
                  className="chat-dock__file-remove"
                  aria-label={`移除 ${a.name}`}
                  onClick={() => removeAttachment(a.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          className="visually-hidden"
          accept={ATTACH_ACCEPT}
          multiple
          hidden
          onChange={(e) => onPickFiles(e.target.files)}
        />

        <form
          className="chat-dock__composer"
          onSubmit={(e) => {
            e.preventDefault()
            if (busy || generating) return
            void send(input)
          }}
        >
          <button
            type="button"
            className={`chat-dock__attach${attachments.length ? ' is-active' : ''}`}
            aria-label="添加附件"
            disabled={busy || generating || attachments.length >= ATTACH_MAX_COUNT}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconPaperclip />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            placeholder={generating ? '正在生成回复…' : 'Ask Copilot...'}
            rows={1}
            inputMode="text"
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onComposerKeyDown}
            aria-label="Ask Copilot，Enter 发送，Shift+Enter 换行"
          />
          <button
            type="button"
            className={`chat-dock__mic${speech.listening ? ' is-listening' : ''}`}
            aria-label={speech.listening ? '松开结束语音' : '按住说话'}
            disabled={busy || generating}
            onPointerDown={(e) => {
              e.preventDefault()
              if (busy || generating) return
              speech.start('zh-CN')
            }}
            onPointerUp={() => {
              if (busy || generating) {
                speech.stop()
                return
              }
              const text = speech.stop()
              if (text) void send(text)
            }}
            onPointerCancel={() => {
              speech.stop()
            }}
          >
            <IconMic />
          </button>
          {generating ? (
            <button
              type="button"
              className="chat-dock__send is-stop"
              aria-label="停止生成"
              title="停止生成"
              onClick={stopGeneration}
            >
              <IconStop />
            </button>
          ) : (
            <button
              type="submit"
              className={`chat-dock__send${canSend ? ' is-ready' : ''}`}
              aria-label="发送"
              title="发送"
              disabled={!canSend}
            >
              <IconSendUp />
            </button>
          )}
        </form>
      </div>
    </section>
  )
}
