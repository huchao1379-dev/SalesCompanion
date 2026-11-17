import './CopilotChat.css'
import { useEffect, useRef, useState } from 'react'
import type { AgentMessage, DraftPayload } from '../../agents/types'
import { getOrchestratorMode, orchestrate } from '../../agents/orchestratorClient'
import { AgentLabel } from '../../components/AgentLabel'
import { DraftCard } from '../../components/DraftCard'
import {
  IconBack,
  IconMic,
  IconPaperclip,
  IconSendUp,
} from '../../components/DashIcons'
import { SourceChips } from '../../components/SourceChips'
import {
  appendMessages,
  clearConversation,
  loadConversation,
} from '../../data/conversationStore'
import { confirmAndSync, discardDraft, upsertDraft } from '../../data/dataverse'
import { useWebSpeech } from '../../speech/useWebSpeech'

type Props = {
  initialPrompt?: string
  onBack?: () => void
  onOpenAccount?: (accountKey: string) => void
  onOpenOpportunity?: () => void
  onOpenTasks?: () => void
}

const HELP_ITEMS = [
  'Query customer info and opportunity status.',
  "Get today's schedule and to-do items.",
  'Analyze sales trends and performance data.',
]

const QUICK_CHIPS = [
  { label: "Today's tasks", prompt: "What's on my agenda today?" },
  { label: 'Pipeline status', prompt: 'Summarize my current pipeline status.' },
  { label: 'Follow-ups', prompt: 'What follow-ups should I do next?' },
]

export function CopilotChat({
  initialPrompt = '',
  onBack,
  onOpenAccount,
  onOpenOpportunity,
  onOpenTasks,
}: Props) {
  const speech = useWebSpeech()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [input, setInput] = useState(initialPrompt)
  const [conversation, setConversation] = useState(() => loadConversation())
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<DraftPayload[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const messages = conversation.messages
  const isEmpty = messages.length === 0

  useEffect(() => {
    if (initialPrompt) setInput(initialPrompt)
  }, [initialPrompt])

  useEffect(() => {
    // Avoid auto-focus on iOS: Safari zooms/pans the page and creates scrollbars.
    const isIOS =
      /iP(hone|od|ad)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    if (isIOS) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(t)
  }, [])

  async function send(text: string) {
    const utterance = text.trim()
    if (!utterance || busy) return

    setBusy(true)
    setStatus(`编排中（${getOrchestratorMode()}）…`)
    const stamp = new Date().toISOString()
    const userMsg: AgentMessage = {
      id: `user_${stamp}`,
      role: 'user',
      agent_name: '你',
      content: utterance,
      sources: [],
      confidence: 1,
      createdAt: stamp,
    }
    const withUser = appendMessages(conversation, [userMsg])
    setConversation(withUser)
    setInput('')
    try {
      const res = await orchestrate({
        utterance,
        context: { ...withUser.context, conversationId: withUser.conversationId },
      })
      res.drafts.forEach((d) => upsertDraft(d))
      setDrafts(res.drafts)
      const next = appendMessages(withUser, res.messages, res.context)
      setConversation(next)
      setStatus(
        `意图 ${res.intent || '—'} · ${res.mode || getOrchestratorMode()} · ${res.latencyMs}ms`,
      )
    } catch (err) {
      const errStamp = new Date().toISOString()
      const next = appendMessages(withUser, [
        {
          id: `err_${errStamp}`,
          role: 'assistant',
          agent_name: '系统',
          content: err instanceof Error ? err.message : '请求失败',
          sources: [],
          confidence: 0,
          createdAt: errStamp,
        },
      ])
      setConversation(next)
      setStatus('编排失败')
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
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

  const accountKey = conversation.context.accountRef || conversation.context.accountId
  const canSend = Boolean(input.trim()) && !busy

  return (
    <section className={`chat-screen${isEmpty ? ' is-empty' : ''}`}>
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
          className="chat-screen__clear"
          onClick={() => {
            setConversation(clearConversation())
            setDrafts([])
            setStatus(null)
          }}
        >
          Clear
        </button>
      </header>

      <div className="chat-screen__body">
        {isEmpty ? (
          <div className="chat-empty">
            <div className="chat-empty__help">
              <h2>I can help you with:</h2>
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
            <p className="chat-empty__hint">Type a question or hold the mic to start.</p>
          </div>
        ) : (
          <div className="chat__thread">
            {messages.map((m) => (
              <article
                key={m.id}
                className={`chat-bubble chat-bubble--${m.role === 'user' ? 'user' : 'assistant'}`}
              >
                {m.role !== 'user' ? (
                  <AgentLabel name={m.agent_name} chain={m.agent_chain} />
                ) : null}
                <p>{m.content}</p>
                {m.role !== 'user' ? (
                  <div className="chat-bubble__meta">
                    <span className="confidence">置信度 {(m.confidence * 100).toFixed(0)}%</span>
                    <SourceChips sources={m.sources} />
                    {accountKey && onOpenAccount ? (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenAccount(accountKey)}
                      >
                        查看客户画像 →
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}

        {status ? <p className="capture__status">{status}</p> : null}

        {drafts.length > 0 ? (
          <div className="draft-list">
            <div className="capture__carousel-nav">
              <strong>本轮草稿</strong>
              {drafts.some((d) => d.kind === 'opportunity') && onOpenOpportunity ? (
                <button type="button" className="linkish" onClick={onOpenOpportunity}>
                  打开商机屏 →
                </button>
              ) : null}
            </div>
            {drafts.map((d) => (
              <DraftCard
                key={d.idempotencyKey}
                draft={d}
                busy={busy}
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
        ) : null}
      </div>

      <div className="chat-dock">
        {isEmpty ? (
          <div className="chat-dock__chips">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className="chat-dock__chip"
                disabled={busy}
                onClick={() => onChip(chip)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}

        <form
          className="chat-dock__composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
        >
          <button type="button" className="chat-dock__attach" aria-label="添加附件">
            <IconPaperclip />
          </button>
          <input
            ref={inputRef}
            value={input}
            placeholder="Ask Copilot..."
            disabled={busy}
            inputMode="text"
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void send(input)
              }
            }}
            aria-label="Ask Copilot"
          />
          <button
            type="button"
            className={`chat-dock__mic${speech.listening ? ' is-listening' : ''}`}
            aria-label={speech.listening ? '松开结束语音' : '按住说话'}
            disabled={busy}
            onPointerDown={(e) => {
              e.preventDefault()
              speech.start('zh-CN')
            }}
            onPointerUp={() => {
              const text = speech.stop()
              if (text) void send(text)
            }}
            onPointerCancel={() => {
              speech.stop()
            }}
          >
            <IconMic />
          </button>
          <button
            type="submit"
            className={`chat-dock__send${canSend ? ' is-ready' : ''}`}
            aria-label="发送"
            disabled={!canSend}
          >
            <IconSendUp />
          </button>
        </form>
      </div>
    </section>
  )
}
