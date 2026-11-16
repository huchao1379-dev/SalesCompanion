import { useState } from 'react'
import type { AgentMessage, DraftPayload } from '../agents/types'
import { getOrchestratorMode, orchestrate } from '../agents/orchestratorClient'
import { AgentLabel } from '../components/AgentLabel'
import { DraftCard } from '../components/DraftCard'
import { MicButton } from '../components/MicButton'
import { SourceChips } from '../components/SourceChips'
import {
  appendMessages,
  clearConversation,
  loadConversation,
} from '../data/conversationStore'
import { confirmAndSync, discardDraft, upsertDraft } from '../data/dataverse'
import { useWebSpeech } from '../speech/useWebSpeech'

type Props = {
  onOpenAccount?: (accountKey: string) => void
  onOpenOpportunity?: () => void
}

const SUGGESTIONS = [
  '仁济医院最近怎么样？',
  'Hospital Alpha 最新进度？',
  '查一下仁济医院上个订单的物流',
  '查一下 Hospital Alpha 上个订单的物流',
  '刚拜访完上海仁济医院张主任，他对监护仪 N17 感兴趣，要 12 台，下周三再约一次定标书细节。',
]

export function CopilotChat({ onOpenAccount, onOpenOpportunity }: Props) {
  const speech = useWebSpeech()
  const [input, setInput] = useState('')
  const [conversation, setConversation] = useState(() => loadConversation())
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<DraftPayload[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const messages = conversation.messages

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

  const accountKey = conversation.context.accountRef || conversation.context.accountId

  return (
    <section className="screen chat">
      <header>
        <p className="home__eyebrow">对话</p>
        <h1>Copilot Chat</h1>
        <p className="muted">场景 B 客户速览 · 场景 C 订单物流 · 场景 A 拜访录入。</p>
      </header>

      <div className="chat__suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="chip-btn"
            disabled={busy}
            onClick={() => void send(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="chat__thread">
        {messages.length === 0 ? (
          <p className="muted">试着问客户进度、订单物流，或口述拜访结果。</p>
        ) : (
          messages.map((m) => (
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
          ))
        )}
      </div>

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

      <div className="chat__composer">
        <input
          value={input}
          placeholder="输入问题…"
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send(input)
          }}
        />
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => void send(input)}
        >
          发送
        </button>
      </div>

      <div className="capture__toolbar">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setConversation(clearConversation())
            setDrafts([])
            setStatus(null)
          }}
        >
          清空会话
        </button>
      </div>

      <div className="capture__mic">
        <MicButton
          listening={speech.listening}
          disabled={busy}
          onPressStart={() => speech.start('zh-CN')}
          onPressEnd={() => {
            const text = speech.stop()
            if (text) void send(text)
          }}
        />
      </div>
    </section>
  )
}
