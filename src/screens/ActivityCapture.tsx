import { useState } from 'react'
import type { DraftPayload } from '../agents/types'
import { isMockOrchestrator, orchestrate } from '../agents/orchestratorClient'
import { DraftCard } from '../components/DraftCard'
import { MicButton } from '../components/MicButton'
import { confirmAndSync, discardDraft, upsertDraft } from '../data/dataverse'
import { useWebSpeech } from '../speech/useWebSpeech'

type Props = {
  onDraftsCommitted?: (drafts: DraftPayload[]) => void
  onOpenOpportunity?: () => void
}

const DEMO_UTTERANCE =
  '刚拜访完上海仁济医院张主任，他对监护仪 N17 感兴趣，要 12 台，下周三再约一次定标书细节。'

export function ActivityCapture({ onDraftsCommitted, onOpenOpportunity }: Props) {
  const speech = useWebSpeech()
  const [keyboardMode, setKeyboardMode] = useState(false)
  const [textInput, setTextInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftPayload[]>([])
  const [startedAt, setStartedAt] = useState<number | null>(null)

  const displayTranscript = speech.transcript || speech.interimTranscript || textInput
  const showFallback = keyboardMode || !speech.supported || Boolean(speech.error)

  async function runOrchestrator(utterance: string) {
    const trimmed = utterance.trim()
    if (!trimmed) {
      setStatus('请先说话或输入拜访内容')
      return
    }
    setBusy(true)
    setStatus(isMockOrchestrator() ? '编排中（Mock Orchestrator）…' : '编排中…')
    const t0 = startedAt ?? Date.now()
    try {
      const res = await orchestrate({ utterance: trimmed, locale: 'zh-CN' })
      res.drafts.forEach((d) => upsertDraft(d))
      setDrafts(res.drafts)
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      setStatus(`草稿已生成 · 耗时 ${elapsed}s（目标 ≤30s）`)
      onDraftsCommitted?.(res.drafts)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '编排失败')
    } finally {
      setBusy(false)
    }
  }

  function handlePressStart() {
    setStartedAt(Date.now())
    setStatus(null)
    if (!speech.supported) {
      setKeyboardMode(true)
      setStatus('语音不可用，已切换键盘输入')
      return
    }
    speech.start('zh-CN')
  }

  async function handlePressEnd() {
    const text = speech.stop()
    if (text) {
      await runOrchestrator(text)
    } else if (!speech.supported) {
      setKeyboardMode(true)
    } else {
      setStatus('未识别到语音，可重试或改用键盘')
      setKeyboardMode(true)
    }
  }

  function updateDraft(next: DraftPayload) {
    setDrafts((prev) => prev.map((d) => (d.idempotencyKey === next.idempotencyKey ? next : d)))
    upsertDraft(next)
  }

  async function handleConfirm(draft: DraftPayload) {
    setBusy(true)
    try {
      const synced = await confirmAndSync(draft)
      setDrafts((prev) => prev.map((d) => (d.idempotencyKey === synced.idempotencyKey ? synced : d)))
      setStatus(`已确认并同步：${synced.syncStatus}（未直写 SAP UI，模拟 Service Bus）`)
      if (synced.kind === 'opportunity') onOpenOpportunity?.()
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
      setStatus('已拒绝该草稿（可沉淀为提示词优化语料）')
    } finally {
      setBusy(false)
    }
  }

  async function handleRetry(draft: DraftPayload) {
    setBusy(true)
    try {
      const synced = await confirmAndSync({ ...draft, syncStatus: 'Draft' })
      setDrafts((prev) => prev.map((d) => (d.idempotencyKey === synced.idempotencyKey ? synced : d)))
    } finally {
      setBusy(false)
    }
  }

  const hasOpportunity = drafts.some((d) => d.kind === 'opportunity')

  return (
    <section className="screen capture">
      <header>
        <p className="home__eyebrow">活动录入</p>
        <h1>一句话记录拜访</h1>
        <p className="muted">语音 → 草稿 → 确认。不直写 SAP。</p>
      </header>

      <div className="capture__context">最近 30 天 4 次拜访 · 信用 A · 已签 MSA</div>

      <div className="capture__mic">
        <MicButton
          listening={speech.listening}
          disabled={busy}
          onPressStart={handlePressStart}
          onPressEnd={() => {
            void handlePressEnd()
          }}
        />
      </div>

      <div className="capture__toolbar">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setKeyboardMode((v) => !v)}
        >
          {showFallback ? '收起键盘' : '改用键盘'}
        </button>
        {hasOpportunity ? (
          <button type="button" className="btn btn--ghost" onClick={onOpenOpportunity}>
            查看商机草稿
          </button>
        ) : null}
      </div>

      {showFallback ? (
        <div className="capture__fallback">
          <p className="muted">{speech.error ?? '键盘输入（语音 fallback）'}</p>
          <textarea
            rows={3}
            placeholder="粘贴或输入拜访口述…"
            value={textInput || speech.transcript}
            onChange={(e) => {
              setTextInput(e.target.value)
              speech.setTranscript(e.target.value)
            }}
          />
          <div className="capture__fallback-actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => {
                setStartedAt(Date.now())
                void runOrchestrator(textInput || speech.transcript || DEMO_UTTERANCE)
              }}
            >
              生成草稿
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => {
                setTextInput(DEMO_UTTERANCE)
                speech.setTranscript(DEMO_UTTERANCE)
                setStartedAt(Date.now())
                void runOrchestrator(DEMO_UTTERANCE)
              }}
            >
              使用仁济示例
            </button>
          </div>
        </div>
      ) : null}

      {displayTranscript ? (
        <div className="capture__transcript">
          <strong>转写</strong>
          <p>{displayTranscript}</p>
        </div>
      ) : null}

      {status ? <p className="capture__status">{status}</p> : null}

      <div className="draft-list">
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
              void handleRetry(draft)
            }}
          />
        ))}
      </div>
    </section>
  )
}
