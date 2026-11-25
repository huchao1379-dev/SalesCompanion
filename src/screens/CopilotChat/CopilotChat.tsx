import './CopilotChat.css'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ApiRequestError } from '../../api/client'
import type {
  AgentMessage,
  AgentStep,
  DraftPayload,
  MessageFailureKind,
  OrchestratorAttachment,
} from '../../agents/types'
import { copilotOrchestrate } from '../../agents/copilotStudioClient'
import { getOrchestratorMode, orchestrate } from '../../agents/orchestratorClient'
import { DraftCard } from '../../components/DraftCard'
import {
  IconBack,
  IconChevronDown,
  IconKeyboard,
  IconMic,
  IconPaperclip,
  IconPlus,
  IconSendUp,
  IconSpark,
  IconStop,
  IconTrash,
} from '../../components/DashIcons'
import { IconButton } from '../../components/IconButton'
import { MessageUiCard } from '../../components/MessageUiCard'
import { SourceChips } from '../../components/SourceChips'
import {
  appendMessages,
  clearAccountContext,
  createConversation,
  deleteConversation,
  listConversations,
  loadConversation,
  replaceMessage,
  switchConversation,
  updateMessage,
  type ConversationState,
  type ConversationSummary,
} from '../../data/conversationStore'
import { api } from '../../api/client'
import {
  confirmAndSyncDetailed,
  discardDraft,
  listDrafts,
  refreshDraftsFromApi,
  upsertDraft,
} from '../../data/dataverse'
import { canConfirmDraft } from '../../data/syncStatus'
import { useSpeechRecognition } from '../../speech/useSpeechRecognition'
import {
  armSpeechGate,
  cancelSpeech,
  disarmSpeechGate,
  speakText,
  unlockSpeech,
} from '../../speech/tts'

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
/** Fallback display only when envelope lacks agent_name — never mask a real agent. */
const BOT_NAME = '销售 Copilot'
const NEAR_BOTTOM_PX = 96
const TIME_GROUP_MS = 2 * 60 * 1000

/** Honest pending labels — replaced by server `steps` when the turn completes. */
const PROGRESS_PHASES = [
  { afterMs: 0, label: '正在理解你的问题' },
  { afterMs: 1600, label: '正在编排相关 Agent' },
  { afterMs: 4200, label: '正在汇总答复' },
] as const

function progressPhasesFor(utterance: string, hasAttachments: boolean) {
  if (hasAttachments) {
    return [
      { afterMs: 0, label: '正在理解附件与问题' },
      { afterMs: 1800, label: '正在编排相关 Agent' },
      { afterMs: 4500, label: '正在汇总答复' },
    ]
  }
  const t = utterance.trim()
  if (/写.*(邮件|信|话术|开场)|会议准备|卖点|异议|翻译|搜索|搜一下|查一下网上|https?:\/\//i.test(t)) {
    return [
      { afterMs: 0, label: '正在理解助手请求' },
      { afterMs: 1500, label: '正在检索或起草内容' },
      { afterMs: 4000, label: '正在汇总助手答复' },
    ]
  }
  if (/拜访|录入|记一下|建草稿|刚见|刚拜访/.test(t)) {
    return [
      { afterMs: 0, label: '正在抽取拜访要素' },
      { afterMs: 1600, label: '正在生成活动与商机草稿' },
      { afterMs: 4200, label: '正在督导核对' },
    ]
  }
  if (/订单|物流|发货|清关|运单|ETA/i.test(t)) {
    return [
      { afterMs: 0, label: '正在识别订单问题' },
      { afterMs: 1500, label: '正在查询订单与物流' },
      { afterMs: 3800, label: '正在整理物流答复' },
    ]
  }
  if (/日报|周报|工作总结|工作小结|今日小结/.test(t)) {
    return [
      { afterMs: 0, label: '正在汇总今日跟进' },
      { afterMs: 1600, label: '正在整理工作小结' },
      { afterMs: 3800, label: '正在生成总结文案' },
    ]
  }
  if (/怎么样|画像|信用|商机|近访|客户|医院/.test(t)) {
    return [
      { afterMs: 0, label: '正在识别客户' },
      { afterMs: 1400, label: '正在并行查询画像与商机' },
      { afterMs: 3800, label: '正在合成客户速览' },
    ]
  }
  return [...PROGRESS_PHASES]
}

const HELP_ITEMS = [
  '一句话录入拜访，生成活动与商机草稿',
  '查询客户画像、信用与开放商机（带来源）',
  '查询订单物流，或把今日跟进写成日报素材',
  '写话术/跟进邮件、会议准备；可检索公开网页资料（需配置联网）',
]

const QUICK_CHIPS = [
  {
    label: '仁济拜访录入',
    prompt:
      '刚拜访完上海仁济医院张主任，他对监护仪 N17 感兴趣，要 12 台，下周三再约一次定标书细节。',
  },
  { label: '仁济客户速览', prompt: '仁济医院最近怎么样？' },
  { label: '查订单物流', prompt: '查一下仁济医院上个订单的物流' },
  { label: '写跟进邮件', prompt: '帮我写一封拜访后的跟进邮件，语气专业简洁。' },
  { label: '那它的商机呢', prompt: '那它的商机呢？' },
  { label: '写今日小结', prompt: '帮我写今日工作小结' },
] as const

type Props = {
  initialPrompt?: string
  onBack?: () => void
  onOpenAccount?: (accountKey: string) => void
  onOpenOpportunity?: () => void
  onOpenTasks?: () => void
}

/** DeepSeek is the demo default; Copilot Studio remains available behind an explicit flag. */
const CHAT_PROVIDER =
  import.meta.env.VITE_CHAT_PROVIDER?.trim().toLowerCase() === 'copilotstudio'
    ? 'copilotstudio'
    : 'deepseek'

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

async function toOrchestratorAttachments(
  list: PendingAttachment[],
): Promise<OrchestratorAttachment[]> {
  const out: OrchestratorAttachment[] = []
  for (const item of list) {
    try {
      out.push({
        name: item.name,
        mimeType: item.file.type || (item.kind === 'image' ? 'image/jpeg' : 'application/octet-stream'),
        dataBase64: await fileToBase64(item.file),
      })
    } catch {
      /* Skip unreadable files; user still sees the name in the bubble. */
    }
  }
  return out
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

function normalizeAssistantMessages(messages: AgentMessage[], completedAt: string): AgentMessage[] {
  return messages.map((m) => ({
    ...m,
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

function messageAgentName(m: AgentMessage) {
  return m.agent_name?.trim() || BOT_NAME
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

function confidenceLabel(m: AgentMessage) {
  if (!(m.confidence > 0)) return ''
  if (m.confidence_kind === 'extraction') return '提取置信'
  if (m.confidence_kind === 'composite') return '综合置信'
  return '回答置信'
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

function stepStatusLabel(status: AgentStep['status']) {
  if (status === 'fallback') return '规则兜底'
  if (status === 'error') return '失败'
  if (status === 'skipped') return '跳过'
  return '完成'
}

/** Plain text for mobile TTS — strip markdown noise from assistant replies. */
function stripSpeakable(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function CopilotChat(props: Props) {
  return <NativeChat {...props} />
}

function NativeChat({
  initialPrompt = '',
  onBack,
  onOpenAccount,
  onOpenOpportunity,
}: Props) {
  const speech = useSpeechRecognition()
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
  const [drafts, setDrafts] = useState<DraftPayload[]>(() =>
    listDrafts()
      .filter((draft) => draft.syncStatus !== 'Discarded')
      .slice(0, 6),
  )
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [showNewMsgHint, setShowNewMsgHint] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [conversationList, setConversationList] = useState<ConversationSummary[]>(() =>
    listConversations(),
  )
  const [composerMode, setComposerMode] = useState<'text' | 'voice'>('text')
  const [voiceHint, setVoiceHint] = useState('')
  /** When auto-TTS is blocked, keep reply text for one-tap replay inside a user gesture. */
  const [pendingSpeakText, setPendingSpeakText] = useState('')
  const [syncNotice, setSyncNotice] = useState('')
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const voicePreferredRef = useRef(false)
  /** After a voice turn, auto-speak the assistant reply (needs unlockSpeech in the mic gesture). */
  const speakReplyAfterTurnRef = useRef(false)
  const stopSpeakRef = useRef<(() => void) | null>(null)
  const composerModeRef = useRef(composerMode)
  const historyPanelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    composerModeRef.current = composerMode
  }, [composerMode])

  const messages = useMemo(() => conversation.messages, [conversation.messages])
  const isEmpty = messages.length === 0
  const hasSendable = Boolean(input.trim() || attachments.length)
  const canSend = hasSendable && !busy && !generating && composerMode === 'text'
  const accountKey = conversation.context.accountRef || conversation.context.accountId
  const activeAccountName = conversation.context.accountName?.trim() || ''

  useEffect(() => {
    const isIOS =
      /iP(hone|od|ad)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    if (isIOS) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    let cancelled = false
    void api
      .health()
      .then((health) => {
        if (!cancelled) setWebSearchEnabled(Boolean(health.capabilities?.webSearch))
      })
      .catch(() => {
        if (!cancelled) setWebSearchEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Voice-First: prefer mic when ASR is available (讯飞或浏览器 Web Speech)。
  useEffect(() => {
    if (voicePreferredRef.current) return
    if (!speech.supported) return
    voicePreferredRef.current = true
    setComposerMode('voice')
    setVoiceHint(
      speech.provider === 'iflytek'
        ? '点按开始录音（讯飞）；再次点按结束并发送'
        : '点按开始录音；再次点按结束并发送',
    )
  }, [speech.supported, speech.provider])

  // Avoid speaking into a cold engine — first syllables are often dropped before ready.
  useEffect(() => {
    if (composerMode !== 'voice' || !speech.listening) return
    setVoiceHint(
      speech.ready ? '正在听你说话…点按结束并发送' : '准备中，请稍等再开口…',
    )
  }, [composerMode, speech.listening, speech.ready])

  useEffect(() => {
    return () => {
      stopSpeakRef.current?.()
      stopSpeakRef.current = null
      disarmSpeechGate()
      cancelSpeech()
    }
  }, [])

  // Hydrate drafts from API on mount; merge with local mirror.
  useEffect(() => {
    let cancelled = false
    void refreshDraftsFromApi()
      .then((serverDrafts) => {
        if (cancelled) return
        setDrafts(
          serverDrafts.filter((draft) => draft.syncStatus !== 'Discarded').slice(0, 8),
        )
      })
      .catch(() => {
        /* keep local listDrafts() seed */
      })
    return () => {
      cancelled = true
    }
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
    if (!historyOpen) return
    setConversationList(listConversations())
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (historyPanelRef.current?.contains(target)) return
      const actions = (event.target as HTMLElement | null)?.closest?.('.chat-screen__actions')
      if (actions) return
      setHistoryOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [historyOpen])

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
    setConversationList(listConversations())
  }

  function formatConversationTime(iso: string) {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    const now = new Date()
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    if (sameDay) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
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

  function startProgressTicker(
    assistantId: string,
    generationId: number,
    utterance: string,
    hasAttachments: boolean,
  ) {
    const timers: number[] = []
    const phases = progressPhasesFor(utterance, hasAttachments)
    for (const phase of phases) {
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

  async function runGeneration(
    utterance: string,
    opts?: { retryAssistantId?: string; attachments?: OrchestratorAttachment[] },
  ) {
    // Guard with refs to avoid double-submit from stale closures.
    if (genRef.current) return

    const stamp = new Date().toISOString()
    const controller = new AbortController()
    const generationId = ++genSeqRef.current
    const assistantId = opts?.retryAssistantId || uid('asst')
    const requestAttachments = opts?.attachments?.length ? opts.attachments : undefined
    const hasAttachments = Boolean(requestAttachments?.length)

    // Reserve the slot immediately so a second Enter cannot start another turn.
    genRef.current = {
      id: generationId,
      controller,
      stopped: false,
      completed: false,
      assistantId,
    }
    setGenerating(true)
    setHistoryOpen(false)
    setSyncNotice('')

    const pendingMsg: AgentMessage = {
      id: assistantId,
      role: 'assistant',
      agent_id: 'Orchestrator',
      agent_name: BOT_NAME,
      content: '',
      sources: [],
      confidence: 0,
      createdAt: stamp,
      deliveryStatus: 'pending',
      progressLabel: progressPhasesFor(utterance, hasAttachments)[0]?.label || PROGRESS_PHASES[0].label,
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
        progressLabel: progressPhasesFor(utterance, hasAttachments)[0]?.label || PROGRESS_PHASES[0].label,
        failureKind: undefined,
        retryUtterance: utterance,
        agent_id: 'Orchestrator',
        agent_name: BOT_NAME,
        agent_chain: undefined,
      })
    } else {
      base = appendMessages(base, [pendingMsg])
    }
    setConversationState(base)

    const handle = genRef.current!
    const stopTicker = startProgressTicker(assistantId, generationId, utterance, hasAttachments)

    try {
      const runAgent = CHAT_PROVIDER === 'deepseek' ? orchestrate : copilotOrchestrate
      const res = await runAgent(
        {
          utterance,
          turnId: assistantId,
          attachments: requestAttachments,
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
      setDrafts((prev) => {
        const next = [...prev]
        for (const draft of res.drafts) {
          const index = next.findIndex((item) => item.idempotencyKey === draft.idempotencyKey)
          if (index >= 0) next[index] = draft
          else next.unshift(draft)
        }
        // Keep confirmed/synced cards; drop discarded; cap list.
        return next
          .filter((draft) => draft.syncStatus !== 'Discarded')
          .slice(0, 8)
      })
      const fallbackSteps = (res.steps || []).filter(
        (step) => step.status === 'fallback' || step.status === 'error',
      )
      setSyncNotice(
        res.degraded_reason ||
          (res.mode === 'heuristic'
            ? '当前为规则兜底模式（模型未成功调用；请检查 API Key / 网络或 OPENAI_BASE_URL 代理）。'
            : '') ||
          (fallbackSteps.length
            ? `部分步骤规则兜底：${fallbackSteps.map((s) => s.agentName).join('、')}`
            : ''),
      )

      const normalized = normalizeAssistantMessages(res.messages, completedAt)
      const withSteps = normalized.map((message, index) =>
        index === normalized.length - 1 && res.steps?.length
          ? {
              ...message,
              steps: res.steps,
              progressLabel: undefined,
              agent_name: message.agent_name?.trim() || BOT_NAME,
            }
          : {
              ...message,
              agent_name: message.agent_name?.trim() || BOT_NAME,
            },
      )
      const next = replaceMessage(
        conversationRef.current,
        assistantId,
        withSteps.length
          ? withSteps
          : [
              {
                id: assistantId,
                role: 'assistant',
                agent_id: 'Orchestrator',
                agent_name: BOT_NAME,
                content: '暂时没有可展示的答复。',
                sources: [{ kind: 'other', label: '无来源', ref: 'none' }],
                confidence: 0.4,
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

      // Voice turn → auto-speak reply. Gate must stay armed from mic stop gesture.
      if (speakReplyAfterTurnRef.current) {
        speakReplyAfterTurnRef.current = false
        const spoken = stripSpeakable(
          (withSteps.length ? withSteps : next.messages.filter((m) => m.id === assistantId))
            .map((m) => m.content || '')
            .join('。'),
        )
        if (spoken) {
          stopSpeakRef.current?.()
          stopSpeakRef.current = speakText(spoken, {
            lang: 'zh-CN',
            onEnd: () => {
              stopSpeakRef.current = null
            },
            onError: () => {
              stopSpeakRef.current = null
              setPendingSpeakText(spoken)
              setVoiceHint('自动播报被拦截，点此播报回复，或继续点按麦克风。')
            },
          })
        } else {
          disarmSpeechGate()
        }
      } else {
        disarmSpeechGate()
      }
    } catch (err) {
      speakReplyAfterTurnRef.current = false
      disarmSpeechGate()
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
      // Voice mode keeps the soft keyboard closed on mobile.
      if (composerModeRef.current !== 'voice') inputRef.current?.focus()
    }
  }

  function enterVoiceMode() {
    if (busy || generating) return
    if (!speech.supported) {
      setVoiceHint('当前浏览器不支持语音识别，请继续用键盘输入。')
      return
    }
    // Arm TTS inside this tap so later auto-speak after a voice turn is allowed.
    unlockSpeech()
    setPendingSpeakText('')
    setComposerMode('voice')
    setVoiceHint(
      speech.provider === 'iflytek'
        ? '点按开始录音（讯飞）；再次点按结束并发送'
        : '点按开始录音；再次点按结束并发送',
    )
    inputRef.current?.blur()
  }

  function exitVoiceMode() {
    speakReplyAfterTurnRef.current = false
    disarmSpeechGate()
    if (speech.listening) void speech.stop({ graceMs: 0 })
    setComposerMode('text')
    setVoiceHint('')
    setPendingSpeakText('')
    window.setTimeout(() => inputRef.current?.focus(), 40)
  }

  /** Same tap-to-toggle pattern as 新建拜访 MicButton — avoids Android system ASR / long-press menus. */
  function toggleVoicePad() {
    if (busy || generating || !speech.supported) return
    if (pendingSpeakText) {
      replayPendingSpeak()
      return
    }
    if (speech.listening) {
      void finishVoiceTurn()
      return
    }
    beginVoiceTurn()
  }

  function replayPendingSpeak() {
    const text = pendingSpeakText.trim()
    if (!text) return
    unlockSpeech()
    setPendingSpeakText('')
    stopSpeakRef.current?.()
    stopSpeakRef.current = speakText(text, {
      lang: 'zh-CN',
      onEnd: () => {
        stopSpeakRef.current = null
        setVoiceHint(
          speech.provider === 'iflytek'
            ? '点按开始录音（讯飞）；再次点按结束并发送'
            : '点按开始录音；再次点按结束并发送',
        )
      },
      onError: () => {
        stopSpeakRef.current = null
        setPendingSpeakText(text)
        setVoiceHint('播报失败，请再点一次或检查系统语音权限。')
      },
    })
    setVoiceHint('正在播报回复…')
  }

  function beginVoiceTurn() {
    stopSpeakRef.current?.()
    stopSpeakRef.current = null
    cancelSpeech()
    setPendingSpeakText('')
    // Prime TTS inside this tap; keep-alive starts only after stop (mic must stay free).
    unlockSpeech()
    speakReplyAfterTurnRef.current = true
    setVoiceHint('准备中，请稍等再开口…')
    speech.start('zh-CN')
  }

  async function finishVoiceTurn() {
    // Re-arm inside this tap — most recent gesture before async settle + orchestrate.
    unlockSpeech()
    armSpeechGate()
    speakReplyAfterTurnRef.current = true
    setVoiceHint('正在收尾识别…')
    const text = await speech.stop()
    if (text.trim()) {
      setVoiceHint(
        speech.provider === 'iflytek'
          ? '点按开始录音（讯飞）；再次点按结束并发送'
          : '点按开始录音；再次点按结束并发送',
      )
      void send(text)
    } else {
      speakReplyAfterTurnRef.current = false
      disarmSpeechGate()
      setVoiceHint(speech.error || '没有识别到语音，可以再说一次，或切回键盘输入。')
    }
  }

  async function send(text: string) {
    const trimmed = text.trim()
    const pending = attachments
    if ((!trimmed && pending.length === 0) || busy || generating) return

    stopSpeakRef.current?.()
    stopSpeakRef.current = null
    // Keep the mobile TTS gate if this send came from a voice turn (auto-speak reply).
    cancelSpeech({ keepGate: speakReplyAfterTurnRef.current })

    const attachLine =
      pending.length === 0
        ? ''
        : `【附件 ${pending.length}】${pending.map((a) => `${a.name}（${a.sizeLabel}）`).join('、')}`
    const utterance = [attachLine, trimmed || '请结合附件帮我处理'].filter(Boolean).join('\n')

    let payloadAttachments: OrchestratorAttachment[] = []
    if (pending.length) {
      try {
        payloadAttachments = await toOrchestratorAttachments(pending)
      } catch {
        setVoiceHint('附件读取失败，请重试或改用文字说明。')
        return
      }
    }

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
    await runGeneration(utterance, {
      attachments: payloadAttachments.length ? payloadAttachments : undefined,
    })
  }

  function stopGeneration() {
    speakReplyAfterTurnRef.current = false
    disarmSpeechGate()
    stopSpeakRef.current?.()
    stopSpeakRef.current = null
    cancelSpeech()
    setPendingSpeakText('')
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
    if (!canConfirmDraft(draft)) {
      setSyncNotice('督导存在阻断项，请先补全必填信息后再确认同步。')
      return
    }
    setBusy(true)
    setSyncNotice('')
    try {
      const { draft: synced, viaApi } = await confirmAndSyncDetailed(draft)
      setDrafts((prev) => prev.map((d) => (d.idempotencyKey === synced.idempotencyKey ? synced : d)))
      if (!viaApi) {
        setSyncNotice(
          '后端确认接口不可用：草稿已保留为同步失败，不会伪造 SAP 成功。请检查 API 后重试。',
        )
      } else if (synced.syncStatus === 'SyncFailed') {
        setSyncNotice(synced.syncError || '同步失败，请修改后重试。')
      } else if (synced.syncStatus === 'Synced' && synced.kind === 'opportunity' && synced.confirmedAction === 'link_existing') {
        setSyncNotice('已按督导建议关联既有商机，并追加本次拜访证据。')
      }
    } catch (err) {
      console.error('[chat] confirm/sync failed', err)
      setSyncNotice('确认失败，请检查网络后重试。')
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
    void send(chip.prompt)
  }

  function onNewConversation() {
    if (generating) stopGeneration()
    clearAttachments()
    setConversationState(createConversation())
    setDrafts([])
    setShowNewMsgHint(false)
    setHistoryOpen(false)
    setInput('')
    setSyncNotice('')
  }

  function onToggleHistory() {
    setHistoryOpen((open) => {
      if (!open) setConversationList(listConversations())
      return !open
    })
  }

  function onSelectConversation(conversationId: string) {
    if (conversationId === conversationRef.current.conversationId) {
      setHistoryOpen(false)
      return
    }
    if (generating) stopGeneration()
    clearAttachments()
    const next = switchConversation(conversationId)
    if (!next) return
    setConversationState(next)
    setDrafts([])
    setShowNewMsgHint(false)
    setHistoryOpen(false)
    setInput('')
    setSyncNotice('')
  }

  function onDeleteConversation(conversationId: string) {
    const deletingActive = conversationId === conversationRef.current.conversationId
    if (generating && deletingActive) stopGeneration()
    const next = deleteConversation(conversationId)
    setConversationState(next)
    if (deletingActive) {
      clearAttachments()
      setDrafts([])
      setInput('')
      setSyncNotice('')
      setShowNewMsgHint(false)
    }
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
          <IconButton
            className="chat-screen__back"
            squared
            aria-label="返回"
            onClick={onBack}
          >
            <IconBack />
          </IconButton>
        ) : (
          <span className="chat-screen__back-spacer" />
        )}
        <h1>销售 Copilot</h1>
        <div className="chat-screen__actions">
          <IconButton
            className="chat-screen__action-btn"
            squared
            variant="ghost"
            aria-label="新建对话"
            title="新建对话"
            onClick={onNewConversation}
          >
            <IconPlus />
          </IconButton>
          <IconButton
            className={`chat-screen__action-btn chat-screen__history-toggle${historyOpen ? ' is-open' : ''}`}
            squared
            variant="ghost"
            aria-label={historyOpen ? '收起对话列表' : '展开对话列表'}
            aria-expanded={historyOpen}
            title={historyOpen ? '收起对话列表' : '对话列表'}
            onClick={onToggleHistory}
          >
            <IconChevronDown />
          </IconButton>
        </div>
        {historyOpen ? (
          <div className="chat-history-panel" ref={historyPanelRef} role="listbox" aria-label="对话列表">
            <div className="chat-history-panel__head">
              <strong>对话列表</strong>
              <span>{conversationList.length} 条</span>
            </div>
            {conversationList.length === 0 ? (
              <p className="chat-history-panel__empty">还没有历史对话</p>
            ) : (
              <ul className="chat-history-panel__list">
                {conversationList.map((item) => (
                  <li key={item.conversationId}>
                    <button
                      type="button"
                      className={`chat-history-panel__item${item.active ? ' is-active' : ''}`}
                      role="option"
                      aria-selected={item.active}
                      onClick={() => onSelectConversation(item.conversationId)}
                    >
                      <span className="chat-history-panel__title">{item.title}</span>
                      <span className="chat-history-panel__meta">
                        <span>{formatConversationTime(item.updatedAt)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="chat-history-panel__delete"
                      aria-label={`删除对话：${item.title}`}
                      title="删除"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteConversation(item.conversationId)
                      }}
                    >
                      <IconTrash />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="chat-history-panel__new"
              onClick={onNewConversation}
            >
              <IconPlus />
              新建对话
            </button>
          </div>
        ) : null}
      </header>

      {activeAccountName ? (
        <div className="chat-context-bar" role="status">
          <span className="chat-context-bar__label">当前客户</span>
          <strong className="chat-context-bar__name">{activeAccountName}</strong>
          <button
            type="button"
            className="chat-context-bar__clear"
            aria-label="清除当前客户上下文"
            title="清除上下文"
            onClick={() => setConversationState(clearAccountContext(conversationRef.current))}
          >
            清除
          </button>
        </div>
      ) : null}

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
            <p className="chat-empty__hint">
              语音优先：点按下方开始录音，再次点按结束并发送；点键盘可切回文字。也可点快捷入口或上传图片/文本附件（附件会尝试识别，复杂 OCR 不在 Demo 范围）。
              {webSearchEnabled
                ? ' 已启用网页检索，可直接问公开政策或资料。'
                : ' 通用问答可用；实时网页检索需在 server/.env 配置 WEB_SEARCH_API_KEY。'}
            </p>
          </div>
        ) : (
          <div className="chat-screen__feed">
            {!isEmpty ? (
              <div className="chat__thread" role="log" aria-relevant="additions">
                {messages.map((m, index) => {
                  const isUser = m.role === 'user'
                  const showTime = shouldShowTimestamp(messages, index)
                  const chainSteps = !isUser ? footprintSteps(m) : []
                  const runSteps = !isUser ? m.steps || [] : []
                  const pending = m.deliveryStatus === 'pending'
                  const stopped = m.deliveryStatus === 'stopped'
                  const errored = m.deliveryStatus === 'error'
                  const turnStart = !isUser && isAssistantTurnStart(messages, index)
                  const turnEnd = !isUser && isAssistantTurnEnd(messages, index)
                  const hasUiCard = Boolean(!isUser && !pending && !errored && m.ui)
                  const uiHasAccountAction = Boolean(
                    m.ui?.actions?.some((a) => a.id === 'open_account'),
                  )
                  const showConfidence = !isUser && !pending && !errored && m.confidence > 0
                  const showAccountLink =
                    Boolean(accountKey && onOpenAccount) &&
                    !isUser &&
                    turnEnd &&
                    !pending &&
                    !errored &&
                    !uiHasAccountAction
                  const showSteps = !isUser && turnEnd && !pending && (runSteps.length > 0 || chainSteps.length > 1)
                  const timeLabel = pending
                    ? '正在回复'
                    : isUser
                      ? formatMessageTime(m.createdAt)
                      : stopped
                        ? `已停止 · ${formatMessageTime(m.completedAt || m.createdAt)}`
                        : formatMessageTime(m.completedAt || m.createdAt)
                  const showTimeRow = showTime || pending
                  const showSourceRow = !isUser && !pending && !errored
                  const showFooter = showSourceRow || showTimeRow
                  const hasFallbackStep = runSteps.some((step) => step.status === 'fallback')

                  return (
                    <div
                      key={m.id}
                      className={`chat-row chat-row--${isUser ? 'user' : 'assistant'}${turnStart ? ' is-turn-start' : ''}${turnEnd ? ' is-turn-end' : ''}`}
                    >
                      {turnStart ? (
                        <div className="chat-row__identity">
                          <span className="chat-row__avatar" aria-hidden>
                            <IconSpark />
                          </span>
                          <div className="chat-row__identity-copy">
                            <span className="chat-row__bot-name">{messageAgentName(m)}</span>
                            {m.agent_id && m.agent_id !== messageAgentName(m) ? (
                              <span className="chat-row__agent-id">{m.agent_id}</span>
                            ) : null}
                            {!isUser && !pending ? (
                              <span className="chat-row__ai-badge" title="AI 生成内容，写入前可编辑确认">
                                AI 生成
                              </span>
                            ) : null}
                            {hasFallbackStep ? (
                              <span className="chat-row__degraded" title="本回合含规则兜底步骤">
                                规则兜底
                              </span>
                            ) : null}
                          </div>
                          {pending ? (
                            <span className="chat-row__live" aria-live="polite">
                              正在处理
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
                            onSendExample={(text) => {
                              void send(text)
                            }}
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
                            {m.failureKind === 'query' || m.failureKind === 'unknown' ? (
                              <button
                                type="button"
                                className="chat-bubble__retry is-secondary"
                                onClick={() => {
                                  setInput('换个说法：请说明客户名称和我想查的内容')
                                  window.setTimeout(() => inputRef.current?.focus(), 40)
                                }}
                              >
                                换种说法
                              </button>
                            ) : null}
                            {accountKey && onOpenAccount ? (
                              <button
                                type="button"
                                className="chat-bubble__retry is-secondary"
                                onClick={() => onOpenAccount(accountKey)}
                              >
                                去客户画像
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {showSteps ? (
                          <details className="chat-steps">
                            <summary>
                              执行步骤
                              {runSteps.some((step) => step.status === 'fallback') ? (
                                <span className="chat-steps__fallback">含规则兜底</span>
                              ) : null}
                            </summary>
                            <ol>
                              {runSteps.length > 0
                                ? runSteps.map((step) => (
                                    <li key={`${step.agentId}-${step.latencyMs}`}>
                                      <span>{step.agentName}</span>
                                      <span className={`chat-steps__status is-${step.status}`}>
                                        {stepStatusLabel(step.status)}
                                      </span>
                                      <span className="chat-steps__latency">{step.latencyMs}ms</span>
                                    </li>
                                  ))
                                : chainSteps.map((step) => <li key={step}>{step}</li>)}
                            </ol>
                          </details>
                        ) : null}

                        {showConfidence || showAccountLink ? (
                          <div className="chat-bubble__meta">
                            {showConfidence ? (
                              <span
                                className={`confidence confidence--${m.confidence_kind || 'answer'}`}
                                title="AI 回答/提取的置信度，不等于事实准确率"
                              >
                                {confidenceLabel(m)} {(m.confidence * 100).toFixed(0)}%
                              </span>
                            ) : null}
                            {showAccountLink && accountKey ? (
                              <button
                                type="button"
                                className="chat-action-link"
                                onClick={() => onOpenAccount?.(accountKey)}
                              >
                                查看客户画像
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </article>

                      {showFooter ? (
                        <div className="chat-row__footer">
                          {showSourceRow ? (
                            <div className="chat-row__sources" aria-label="信息来源">
                              <SourceChips sources={m.sources} showEmpty />
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

      {syncNotice ? (
        <div className="chat-notice" role="status">
          <span>{syncNotice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setSyncNotice('')}>
            ×
          </button>
        </div>
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
          className={`chat-dock__composer${composerMode === 'voice' ? ' is-voice' : ''}`}
          onSubmit={(e) => {
            e.preventDefault()
            if (busy || generating || composerMode === 'voice') return
            void send(input)
          }}
        >
          <button
            type="button"
            className={`chat-dock__attach${attachments.length ? ' is-active' : ''}`}
            aria-label="添加附件（图片将尝试识别，文本会读入内容）"
            title="可上传图片或文本；图片需服务端配置 VISION_MODEL 才能识图像素"
            disabled={busy || generating || attachments.length >= ATTACH_MAX_COUNT}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconPaperclip />
          </button>

          {composerMode === 'text' ? (
            <textarea
              ref={inputRef}
              value={input}
              placeholder={generating ? '正在生成回复…' : '请输入'}
              rows={1}
              inputMode="text"
              enterKeyHint="send"
              autoComplete="off"
              autoCorrect="on"
              autoCapitalize="sentences"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              aria-label="请输入，Enter 发送，Shift+Enter 换行"
            />
          ) : (
            <button
              type="button"
              className={`chat-dock__voice-pad${speech.listening ? ' is-listening' : ''}${
                pendingSpeakText ? ' is-replay' : ''
              }`}
              aria-label={
                pendingSpeakText
                  ? '点按播报回复'
                  : speech.listening
                    ? '点按结束录音并发送'
                    : speech.provider === 'iflytek'
                      ? '点按开始录音（讯飞）'
                      : '点按开始录音'
              }
              aria-pressed={speech.listening}
              disabled={busy || generating || (!speech.supported && !pendingSpeakText)}
              onClick={(event) => {
                event.preventDefault()
                toggleVoicePad()
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <span className="chat-dock__voice-bars" aria-hidden>
                <i />
                <i />
                <i />
                <i />
              </span>
              <span aria-hidden>
                {pendingSpeakText
                  ? '点按播报回复'
                  : speech.listening
                    ? speech.ready
                      ? '点按结束并发送'
                      : '准备中…'
                    : voiceHint ||
                      (speech.provider === 'iflytek'
                        ? '点按开始录音（讯飞）'
                        : '点按开始录音')}
              </span>
            </button>
          )}

          {composerMode === 'text' ? (
            <button
              type="button"
              className="chat-dock__mic"
              aria-label="切换到语音输入"
              title="语音输入"
              disabled={busy || generating}
              onClick={enterVoiceMode}
            >
              <IconMic />
            </button>
          ) : (
            <button
              type="button"
              className="chat-dock__mic is-keyboard"
              aria-label="切换键盘输入"
              title="切换键盘输入"
              onClick={exitVoiceMode}
            >
              <IconKeyboard />
            </button>
          )}

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

        {voiceHint && composerMode === 'text' ? (
          <p className="chat-dock__voice-status" role="status">
            {voiceHint}
          </p>
        ) : null}
        {composerMode === 'voice' && !speech.supported ? (
          <p className="chat-dock__voice-status is-warn" role="status">
            当前浏览器不支持语音识别，请点键盘按钮继续输入。
          </p>
        ) : null}
      </div>
    </section>
  )
}
