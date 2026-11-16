import { useMemo, useState } from 'react'
import type { DraftPayload } from '../agents/types'
import { getOrchestratorMode, orchestrate } from '../agents/orchestratorClient'
import { DraftCard } from '../components/DraftCard'
import { MicButton } from '../components/MicButton'
import { getAccountInsight } from '../data/accounts'
import { confirmAndSync, discardDraft, upsertDraft } from '../data/dataverse'
import {
  enqueueOfflineUtterance,
  isOnline,
  listOfflineUtterances,
  markOfflineSynced,
} from '../data/offlineQueue'
import { useWebSpeech } from '../speech/useWebSpeech'

type Props = {
  initialDrafts?: DraftPayload[]
  accountKey?: string
  onDraftsCommitted?: (drafts: DraftPayload[]) => void
  onOpenOpportunity?: () => void
}

const DEMO_UTTERANCE =
  '刚拜访完上海仁济医院张主任，他对监护仪 N17 感兴趣，要 12 台，下周三再约一次定标书细节。'

export function ActivityCapture({
  initialDrafts = [],
  accountKey,
  onDraftsCommitted,
  onOpenOpportunity,
}: Props) {
  const speech = useWebSpeech()
  const [keyboardMode, setKeyboardMode] = useState(false)
  const [textInput, setTextInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftPayload[]>(() => initialDrafts)
  const [cardIndex, setCardIndex] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [simulateFail, setSimulateFail] = useState(false)
  const [offlinePending, setOfflinePending] = useState(
    () => listOfflineUtterances().filter((u) => !u.synced).length,
  )

  const contextAccount = useMemo(() => {
    const fromDraft = drafts.find((d) => d.accountRef)?.accountRef
    return getAccountInsight(accountKey || fromDraft || 'SAP-ACC-RENJI')
  }, [accountKey, drafts])

  const displayTranscript = speech.transcript || speech.interimTranscript || textInput
  const showFallback = keyboardMode || !speech.supported || Boolean(speech.error)
  const activeDraft = drafts[cardIndex]

  async function runOrchestrator(utterance: string) {
    const trimmed = utterance.trim()
    if (!trimmed) {
      setStatus('请先说话或输入拜访内容')
      return
    }

    if (!isOnline()) {
      enqueueOfflineUtterance(trimmed)
      setOfflinePending(listOfflineUtterances().filter((u) => !u.synced).length)
      setStatus('离线：口述已缓存，联网后可补传编排')
      return
    }

    setBusy(true)
    setStatus(
      getOrchestratorMode() === 'deepseek'
        ? '编排中（DeepSeek）…'
        : '编排中（启发式 / Dataverse 种子）…',
    )
    const t0 = startedAt ?? Date.now()
    try {
      const res = await orchestrate({
        utterance: trimmed,
        locale: 'zh-CN',
        context: contextAccount
          ? { accountId: contextAccount.accountRef, accountName: contextAccount.accountName }
          : undefined,
      })
      res.drafts.forEach((d) => upsertDraft(d))
      setDrafts(res.drafts)
      setCardIndex(0)
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      setStatus(`草稿已生成 · 耗时 ${elapsed}s（目标 ≤30s）· Agent 延迟 ${res.latencyMs}ms`)
      onDraftsCommitted?.(res.drafts)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '编排失败')
    } finally {
      setBusy(false)
    }
  }

  async function flushOffline() {
    const pending = listOfflineUtterances().filter((u) => !u.synced)
    if (!pending.length || !isOnline()) return
    setBusy(true)
    try {
      for (const row of pending) {
        const res = await orchestrate({ utterance: row.utterance, locale: row.locale })
        res.drafts.forEach((d) => upsertDraft(d))
        setDrafts(res.drafts)
        onDraftsCommitted?.(res.drafts)
        markOfflineSynced(row.id)
      }
      setOfflinePending(listOfflineUtterances().filter((u) => !u.synced).length)
      setStatus('离线队列已补传并生成草稿')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '离线补传失败')
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
    upsertDraft({ ...next, updatedAt: new Date().toISOString() })
  }

  async function handleConfirm(draft: DraftPayload) {
    setBusy(true)
    try {
      const synced = await confirmAndSync(draft, { fail: simulateFail })
      setDrafts((prev) => prev.map((d) => (d.idempotencyKey === synced.idempotencyKey ? synced : d)))
      setStatus(
        synced.syncStatus === 'SyncFailed'
          ? `同步失败：${synced.syncError ?? ''}`
          : `已确认并同步：${synced.syncStatus}`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmAll() {
    const pending = drafts.filter((d) => d.syncStatus === 'Draft')
    if (!pending.length) return
    setBusy(true)
    try {
      const nextList = [...drafts]
      for (const draft of pending) {
        const synced = await confirmAndSync(draft, { fail: simulateFail })
        const idx = nextList.findIndex((d) => d.idempotencyKey === synced.idempotencyKey)
        if (idx >= 0) nextList[idx] = synced
      }
      setDrafts(nextList)
      setStatus(simulateFail ? '批量确认完成（含模拟失败）' : '全部草稿已确认并同步')
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
      const synced = await confirmAndSync(
        { ...draft, syncStatus: 'Draft' },
        { fail: simulateFail },
      )
      setDrafts((prev) => prev.map((d) => (d.idempotencyKey === synced.idempotencyKey ? synced : d)))
    } finally {
      setBusy(false)
    }
  }

  function resetForRerecord() {
    speech.reset()
    setTextInput('')
    setDrafts([])
    setCardIndex(0)
    setStatus('已清空，可重新录音')
  }

  const hasOpportunity = drafts.some((d) => d.kind === 'opportunity')

  return (
    <section className="screen capture">
      <header>
        <p className="home__eyebrow">活动录入</p>
        <h1>一句话记录拜访</h1>
        <p className="muted">语音 → 草稿 → 确认。不直写 SAP。</p>
      </header>

      <div className="capture__context">
        {contextAccount
          ? `最近 30 天 ${contextAccount.visitCount30d} 次拜访 · 信用 ${contextAccount.creditRating}${
              contextAccount.npsDelta ? ` · NPS ${contextAccount.npsDelta}` : ''
            }${contextAccount.lastContactAt ? ` · 上次接触 ${contextAccount.lastContactAt}` : ''}`
          : '选择或口述客户后显示拜访上下文'}
      </div>

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
        <button type="button" className="btn btn--ghost" onClick={() => setKeyboardMode((v) => !v)}>
          {showFallback ? '收起键盘' : '改用键盘'}
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={resetForRerecord}>
          重录
        </button>
        {hasOpportunity ? (
          <button type="button" className="btn btn--ghost" onClick={onOpenOpportunity}>
            查看商机草稿
          </button>
        ) : null}
        {offlinePending > 0 ? (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || !isOnline()}
            onClick={() => {
              void flushOffline()
            }}
          >
            补传离线（{offlinePending}）
          </button>
        ) : null}
      </div>

      <label className="capture__fail-toggle">
        <input
          type="checkbox"
          checked={simulateFail}
          onChange={(e) => setSimulateFail(e.target.checked)}
        />
        模拟 SAP 同步失败（用于验证重试）
      </label>

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

      {drafts.length > 0 ? (
        <div className="capture__carousel">
          <div className="capture__carousel-nav">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={cardIndex <= 0}
              onClick={() => setCardIndex((i) => Math.max(0, i - 1))}
            >
              ←
            </button>
            <span className="muted">
              {cardIndex + 1} / {drafts.length}
            </span>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={cardIndex >= drafts.length - 1}
              onClick={() => setCardIndex((i) => Math.min(drafts.length - 1, i + 1))}
            >
              →
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !drafts.some((d) => d.syncStatus === 'Draft')}
              onClick={() => {
                void handleConfirmAll()
              }}
            >
              全部确认
            </button>
          </div>
          {activeDraft ? (
            <DraftCard
              key={activeDraft.idempotencyKey}
              draft={activeDraft}
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
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
