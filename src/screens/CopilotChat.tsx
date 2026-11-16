import { useState } from 'react'
import type { AgentMessage } from '../agents/types'
import { orchestrate } from '../agents/orchestratorClient'
import { AgentLabel } from '../components/AgentLabel'
import { MicButton } from '../components/MicButton'
import { SourceChips } from '../components/SourceChips'
import { useWebSpeech } from '../speech/useWebSpeech'

const SUGGESTIONS = [
  'Hospital Alpha 最新进度？',
  '查一下 Hospital Alpha 上个订单的物流',
  '刚拜访完上海仁济医院张主任，他对监护仪 N17 感兴趣，要 12 台',
]

export function CopilotChat() {
  const speech = useWebSpeech()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [busy, setBusy] = useState(false)

  async function send(text: string) {
    const utterance = text.trim()
    if (!utterance || busy) return
    setBusy(true)
    const userMsg: AgentMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      agent_name: '你',
      content: utterance,
      sources: [],
      confidence: 1,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    try {
      const res = await orchestrate({ utterance })
      setMessages((prev) => [...prev, ...res.messages])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          agent_name: '系统',
          content: err instanceof Error ? err.message : '请求失败',
          sources: [],
          confidence: 0,
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="screen chat">
      <header>
        <p className="home__eyebrow">对话</p>
        <h1>Copilot Chat</h1>
        <p className="muted">意图 → Orchestrator → Domain Agents，无需菜单。</p>
      </header>

      <div className="chat__suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip-btn" disabled={busy} onClick={() => void send(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="chat__thread">
        {messages.length === 0 ? (
          <p className="muted">试着问客户进度，或按住橙麦口述。</p>
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
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

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
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void send(input)}>
          发送
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
