import './ActivityCapture.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AccountProfile, DraftPayload } from '../../agents/types'
import { getOrchestratorMode, orchestrate } from '../../agents/orchestratorClient'
import {
  IconBuilding,
  IconCheck,
  IconEye,
  IconMic,
  IconRefresh,
  IconSpark,
} from '../../components/DashIcons'
import { DraftCard } from '../../components/DraftCard'
import { MicButton } from '../../components/MicButton'
import { ScreenHeader } from '../../components/ScreenHeader'
import { fetchAccountInsight, getAccountInsight } from '../../data/accounts'
import {
  confirmAndSyncDetailed,
  discardDraft,
  upsertDraft,
} from '../../data/dataverse'
import {
  enqueueOfflineUtterance,
  isOnline,
  listOfflineUtterances,
  markOfflineSynced,
} from '../../data/offlineQueue'
import { useWebSpeech } from '../../speech/useWebSpeech'

type Props = {
  initialDrafts?: DraftPayload[]
  accountKey?: string
  onBack?: () => void
  onDraftsCommitted?: (drafts: DraftPayload[]) => void
  onOpenOpportunity?: () => void
}

/** Explicit capture flow phases for sales mobile recording. */
export type CapturePhase =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'transcript_ready'
  | 'recognition_failed'
  | 'network_error'
  | 'permission_denied'
  | 'submitting'
  | 'sync_success'
  | 'sync_failed'

const DEMO_UTTERANCE =
  '刚拜访完上海仁济医院张主任，他对监护仪 N17 感兴趣，要 12 台，下周三再约一次定标书细节。'

const STEPS = [
  { key: 'speak', label: '口述' },
  { key: 'transcript', label: '转写' },
  { key: 'confirm', label: '确认' },
] as const

const PHASE_COPY: Record<
  CapturePhase,
  { title: string; detail: string; tone: 'neutral' | 'live' | 'warn' | 'danger' | 'ok' | 'busy' }
> = {
  idle: {
    title: '待机',
    detail: '点击麦克风开始录音，或改用键盘。语音识别依赖浏览器能力，可能需联网。',
    tone: 'neutral',
  },
  recording: {
    title: '录音中',
    detail: '请说出客户、联系人、产品与跟进时间。可随时停止或取消。',
    tone: 'live',
  },
  processing: {
    title: '处理中',
    detail: 'AI 正在从转写中抽取拜访与商机字段，不确定项会标为「待补充」。',
    tone: 'busy',
  },
  transcript_ready: {
    title: '转写完成',
    detail: '请核对并编辑转写内容，确认无误后再生成草稿。',
    tone: 'ok',
  },
  recognition_failed: {
    title: '识别失败',
    detail: '未得到有效转写。请重试录音，或切换键盘输入。',
    tone: 'warn',
  },
  network_error: {
    title: '网络异常',
    detail: '编排服务不可用或设备离线。口述可缓存，联网后再生成草稿。',
    tone: 'danger',
  },
  permission_denied: {
    title: '麦克风权限拒绝',
    detail: '请在系统设置中允许麦克风，或直接使用键盘输入拜访内容。',
    tone: 'danger',
  },
  submitting: {
    title: '提交中',
    detail: '正在确认并同步至业务系统 / SAP…',
    tone: 'busy',
  },
  sync_success: {
    title: '同步成功',
    detail: '草稿已确认并进入模拟同步态（synced 仅表示已回写，不代表真实 SAP）。',
    tone: 'ok',
  },
  sync_failed: {
    title: '同步失败',
    detail: '写入失败，可修改后重试。不会伪造成功状态。',
    tone: 'danger',
  },
}

function deriveStepIndex(phase: CapturePhase, hasDrafts: boolean, hasTranscript: boolean) {
  if (hasDrafts || phase === 'submitting' || phase === 'sync_success' || phase === 'sync_failed') {
    return 2
  }
  if (
    hasTranscript ||
    phase === 'transcript_ready' ||
    phase === 'processing' ||
    phase === 'recording'
  ) {
    return phase === 'recording' && !hasTranscript ? 0 : 1
  }
  return 0
}

export function ActivityCapture({
  initialDrafts = [],
  accountKey,
  onBack,
  onDraftsCommitted,
  onOpenOpportunity,
}: Props) {
  const speech = useWebSpeech()
  const [phase, setPhase] = useState<CapturePhase>(() =>
    initialDrafts.length > 0 ? 'transcript_ready' : 'idle',
  )
  const [keyboardMode, setKeyboardMode] = useState(() => !speech.supported)
  const [transcriptEdit, setTranscriptEdit] = useState(() => {
    const fromActivity = initialDrafts.find((d) => d.kind === 'activity')
    return fromActivity && 'transcript' in fromActivity ? fromActivity.transcript : ''
  })
  const [drafts, setDrafts] = useState<DraftPayload[]>(() => initialDrafts)
  const [statusDetail, setStatusDetail] = useState<string | null>(null)
  const [simulateFail, setSimulateFail] = useState(false)
  const [showDevTools, setShowDevTools] = useState(false)
  const [usedMockSync, setUsedMockSync] = useState(false)
  const [offlinePending, setOfflinePending] = useState(
    () => listOfflineUtterances().filter((u) => !u.synced).length,
  )
  const recordStartedAt = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const accountRefForContext = useMemo(() => {
    const fromDraft = drafts.find((d) => d.accountRef)?.accountRef
    return accountKey || fromDraft || 'SAP-ACC-RENJI'
  }, [accountKey, drafts])

  const [contextAccount, setContextAccount] = useState<AccountProfile | null>(() =>
    getAccountInsight(accountRefForContext),
  )

  useEffect(() => {
    let alive = true
    void fetchAccountInsight(accountRefForContext)
      .then((profile) => {
        if (alive && profile) setContextAccount(profile)
      })
      .catch(() => {
        /* Keep the offline/seed fallback. */
      })
    return () => {
      alive = false
    }
  }, [accountRefForContext])

  const openOppNames = useMemo(
    () => contextAccount?.openOpportunities.map((o) => o.name) ?? [],
    [contextAccount],
  )

  const activityDrafts = useMemo(() => drafts.filter((d) => d.kind === 'activity'), [drafts])
  const opportunityDrafts = useMemo(() => drafts.filter((d) => d.kind === 'opportunity'), [drafts])
  const draftPending = drafts.filter((d) => d.syncStatus === 'Draft').length
  const syncingCount = drafts.filter(
    (d) => d.syncStatus === 'Syncing' || d.syncStatus === 'Confirmed',
  ).length
  const failedCount = drafts.filter((d) => d.syncStatus === 'SyncFailed').length
  const syncedCount = drafts.filter((d) => d.syncStatus === 'Synced').length

  const livePreview = speech.listening
    ? [speech.transcript, speech.interimTranscript].filter(Boolean).join(' ')
    : ''
  const displayTranscript = speech.listening ? livePreview : transcriptEdit
  const stepIndex = deriveStepIndex(phase, drafts.length > 0, Boolean(transcriptEdit.trim()))
  const busy =
    phase === 'processing' || phase === 'submitting' || phase === 'recording'
  const phaseMeta = PHASE_COPY[phase]

  useEffect(() => {
    if (!speech.listening) return
    const id = window.setInterval(() => {
      if (recordStartedAt.current == null) return
      setElapsed(Math.floor((Date.now() - recordStartedAt.current) / 1000))
    }, 200)
    return () => window.clearInterval(id)
  }, [speech.listening])

  /* eslint-disable react-hooks/set-state-in-effect -- Browser Speech API errors are external events mirrored into the capture phase. */
  useEffect(() => {
    if (!speech.errorKind) return
    if (speech.errorKind === 'not-allowed') {
      setPhase('permission_denied')
      setKeyboardMode(true)
      setStatusDetail(speech.error)
    } else if (speech.errorKind === 'network') {
      setPhase('network_error')
      setStatusDetail(speech.error)
    } else if (speech.errorKind === 'no-speech' || speech.errorKind === 'other') {
      if (phase === 'recording' || phase === 'idle') {
        setPhase('recognition_failed')
        setStatusDetail(speech.error)
        setKeyboardMode(true)
      }
    } else if (speech.errorKind === 'unsupported') {
      setKeyboardMode(true)
      setStatusDetail(speech.error)
    }
  }, [speech.errorKind, speech.error, phase])
  /* eslint-enable react-hooks/set-state-in-effect */

  function applyDuplicateHints(list: DraftPayload[]): DraftPayload[] {
    if (!contextAccount?.openOpportunities.length) return list
    return list.map((d) => {
      if (d.kind !== 'opportunity' || d.reuseExisting) return d
      const match = contextAccount.openOpportunities.find((o) => {
        const a = `${o.name} ${o.productLine}`.toLowerCase()
        const b = `${d.name} ${d.productLine}`.toLowerCase()
        return (
          a.includes(d.productLine.toLowerCase()) ||
          b.includes(o.productLine.toLowerCase()) ||
          a.includes(d.name.toLowerCase())
        )
      })
      if (!match) return d
      const hints = [
        ...d.supervisorHints.filter((h) => !h.includes('重复')),
        `检测到相似开放商机「${match.name}」，请确认是否追加而非新建`,
      ]
      return {
        ...d,
        supervisorHints: hints,
        // Do not auto-create: leave reuseExisting false until user confirms, but surface warning
      }
    })
  }

  async function generateDrafts(utterance: string) {
    const trimmed = utterance.trim()
    if (!trimmed) {
      setPhase('recognition_failed')
      setStatusDetail('请先录入拜访内容')
      return
    }

    if (!isOnline()) {
      enqueueOfflineUtterance(trimmed)
      setOfflinePending(listOfflineUtterances().filter((u) => !u.synced).length)
      setPhase('network_error')
      setStatusDetail('设备离线：口述已缓存，联网后可补传生成草稿')
      return
    }

    setPhase('processing')
    setStatusDetail(
      getOrchestratorMode() === 'deepseek'
        ? 'DeepSeek 编排中…'
        : '正在生成草稿（请核对不确定字段）…',
    )
    try {
      const res = await orchestrate({
        utterance: trimmed,
        locale: 'zh-CN',
        turnId: `capture_${trimmed.slice(0, 80)}`,
        context: contextAccount
          ? { accountId: contextAccount.accountRef, accountName: contextAccount.accountName }
          : undefined,
      })
      const next = applyDuplicateHints(res.drafts)
      next.forEach((d) => upsertDraft(d))
      setDrafts(next)
      setTranscriptEdit(trimmed)
      setPhase('transcript_ready')
      setStatusDetail(`草稿已生成 · 请分别核对拜访与商机后再确认同步`)
      onDraftsCommitted?.(next)
    } catch (err) {
      setPhase('network_error')
      setStatusDetail(err instanceof Error ? err.message : '编排失败，请检查网络或后端服务')
    }
  }

  async function flushOffline() {
    const pending = listOfflineUtterances().filter((u) => !u.synced)
    if (!pending.length || !isOnline()) return
    setPhase('processing')
    try {
      for (const row of pending) {
        const res = await orchestrate({ utterance: row.utterance, locale: row.locale })
        const next = applyDuplicateHints(res.drafts)
        next.forEach((d) => upsertDraft(d))
        setDrafts(next)
        setTranscriptEdit(row.utterance)
        onDraftsCommitted?.(next)
        markOfflineSynced(row.id)
      }
      setOfflinePending(listOfflineUtterances().filter((u) => !u.synced).length)
      setPhase('transcript_ready')
      setStatusDetail('离线队列已补传并生成草稿')
    } catch (err) {
      setPhase('network_error')
      setStatusDetail(err instanceof Error ? err.message : '离线补传失败')
    }
  }

  function startRecording() {
    speech.clearError()
    setStatusDetail(null)
    setUsedMockSync(false)
    if (!speech.supported) {
      setKeyboardMode(true)
      setPhase('idle')
      setStatusDetail('当前环境不支持语音识别，请使用键盘输入')
      return
    }
    if (!isOnline()) {
      // Web Speech often needs network; still allow attempt but warn
      setStatusDetail('当前离线：浏览器语音识别可能不可用，建议改用键盘')
    }
    recordStartedAt.current = Date.now()
    setElapsed(0)
    setPhase('recording')
    speech.start('zh-CN')
  }

  function stopRecording() {
    const text = speech.stop()
    recordStartedAt.current = null
    if (text.trim()) {
      setTranscriptEdit(text.trim())
      setPhase('transcript_ready')
      setStatusDetail('转写完成，可编辑后生成草稿')
    } else {
      setPhase('recognition_failed')
      setStatusDetail('未识别到有效语音')
      setKeyboardMode(true)
    }
  }

  function cancelRecording() {
    speech.cancel()
    recordStartedAt.current = null
    setElapsed(0)
    setPhase('idle')
    setStatusDetail('已取消录音')
  }

  function toggleMic() {
    if (phase === 'recording' || speech.listening) {
      stopRecording()
      return
    }
    startRecording()
  }

  function updateDraft(next: DraftPayload) {
    setDrafts((prev) => prev.map((d) => (d.idempotencyKey === next.idempotencyKey ? next : d)))
    upsertDraft({ ...next, updatedAt: new Date().toISOString() })
  }

  async function handleConfirm(draft: DraftPayload) {
    setPhase('submitting')
    setStatusDetail(`正在同步「${draft.kind === 'opportunity' ? '商机' : '拜访'}」…`)
    try {
      const { draft: synced, viaApi } = await confirmAndSyncDetailed(draft, { fail: simulateFail })
      if (!viaApi) setUsedMockSync(true)
      setDrafts((prev) => prev.map((d) => (d.idempotencyKey === synced.idempotencyKey ? synced : d)))
      if (synced.syncStatus === 'SyncFailed') {
        setPhase('sync_failed')
        setStatusDetail(synced.syncError || '同步失败')
      } else if (synced.syncStatus === 'Synced') {
        setPhase('sync_success')
        setStatusDetail(
          viaApi
            ? `已同步 · ${synced.sapExternalId || '已写入'}`
            : `本地模拟同步成功 · ${synced.sapExternalId}（后端未连通）`,
        )
      } else {
        setPhase('submitting')
        setStatusDetail(`状态：${synced.syncStatus}`)
      }
    } catch (err) {
      setPhase('sync_failed')
      setStatusDetail(err instanceof Error ? err.message : '同步请求失败')
    }
  }

  async function handleConfirmAll() {
    const pending = drafts.filter((d) => d.syncStatus === 'Draft')
    if (!pending.length) return
    setPhase('submitting')
    let anyFail = false
    let anyMock = false
    const nextList = [...drafts]
    try {
      for (const draft of pending) {
        const { draft: synced, viaApi } = await confirmAndSyncDetailed(draft, {
          fail: simulateFail,
        })
        if (!viaApi) anyMock = true
        if (synced.syncStatus === 'SyncFailed') anyFail = true
        const idx = nextList.findIndex((d) => d.idempotencyKey === synced.idempotencyKey)
        if (idx >= 0) nextList[idx] = synced
      }
      setDrafts(nextList)
      if (anyMock) setUsedMockSync(true)
      if (anyFail) {
        setPhase('sync_failed')
        setStatusDetail('部分或全部同步失败，请查看卡片后重试')
      } else {
        setPhase('sync_success')
        setStatusDetail(
          anyMock
            ? '全部完成（含本地模拟同步，后端未连通）'
            : '全部草稿已确认并同步',
        )
      }
    } catch (err) {
      setPhase('sync_failed')
      setStatusDetail(err instanceof Error ? err.message : '批量同步失败')
    }
  }

  async function handleDiscard(draft: DraftPayload) {
    setPhase('submitting')
    try {
      const discarded = await discardDraft(draft)
      setDrafts((prev) =>
        prev.map((d) => (d.idempotencyKey === discarded.idempotencyKey ? discarded : d)),
      )
      setPhase('transcript_ready')
      setStatusDetail('已拒绝该草稿')
    } catch (err) {
      setPhase('sync_failed')
      setStatusDetail(err instanceof Error ? err.message : '拒绝失败')
    }
  }

  async function handleRetry(draft: DraftPayload) {
    await handleConfirm({ ...draft, syncStatus: 'Draft' })
  }

  function resetAll() {
    speech.cancel()
    speech.reset()
    recordStartedAt.current = null
    setElapsed(0)
    setTranscriptEdit('')
    setDrafts([])
    setUsedMockSync(false)
    setStatusDetail('已清空，可重新录入')
    setPhase('idle')
  }

  return (
    <section className="capture-screen" aria-busy={busy}>
      <ScreenHeader
        eyebrow="现场录入"
        title="新建拜访"
        onBack={onBack}
        trailing={
          <button
            type="button"
            className="screen-header__btn"
            aria-label="清空重录"
            disabled={phase === 'processing' || phase === 'submitting'}
            onClick={resetAll}
          >
            <IconRefresh />
          </button>
        }
      />

      <ol className="capture-screen__steps" aria-label="录入进度">
        {STEPS.map((step, i) => (
          <li
            key={step.key}
            className={[i < stepIndex ? 'is-done' : '', i === stepIndex ? 'is-active' : '']
              .filter(Boolean)
              .join(' ')}
          >
            <span className="capture-screen__step-dot">
              {i < stepIndex ? <IconCheck /> : i + 1}
            </span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>

      {contextAccount ? (
        <article className="capture-screen__account">
          <span className="capture-screen__account-icon" aria-hidden>
            <IconBuilding />
          </span>
          <div className="capture-screen__account-body">
            <div className="capture-screen__account-head">
              <strong>{contextAccount.accountName}</strong>
              <span className="status-pill status-pill--strong">信用 {contextAccount.creditRating}</span>
            </div>
            <p>
              近 30 天 {contextAccount.visitCount30d} 次拜访
              {contextAccount.npsDelta ? ` · NPS ${contextAccount.npsDelta}` : ''}
            </p>
            {contextAccount.lastContactAt ? (
              <p className="capture-screen__account-meta">上次接触 {contextAccount.lastContactAt}</p>
            ) : null}
          </div>
          <div className="capture-screen__account-chips">
            <span className="metric-chip">拜访 {contextAccount.visitCount30d}</span>
            <span className="metric-chip">开放商机 {contextAccount.openOpportunities.length}</span>
            {contextAccount.openOpportunities[0] ? (
              <span className="metric-chip metric-chip--accent">
                {contextAccount.openOpportunities[0].name}
              </span>
            ) : null}
          </div>
        </article>
      ) : null}

      {/* Single primary capture panel — no duplicate empty-state card */}
      <article
        className={`capture-screen__hero${phase === 'recording' ? ' is-listening' : ''}`}
        aria-labelledby="capture-hero-title"
      >
        <div className="capture-screen__hero-copy">
          <span className="capture-screen__hero-icon" aria-hidden>
            <IconMic />
          </span>
          <div>
            <h2 id="capture-hero-title">一句话记下这次拜访</h2>
            <p>
              {phase === 'recording'
                ? `录音中 ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')} · 点击麦克风可停止`
                : '点击开始录音，或改用键盘。确认后再同步 SAP，不直写。'}
            </p>
          </div>
        </div>

        <div
          className={`capture-screen__phase capture-screen__phase--${phaseMeta.tone}`}
          role="status"
          aria-live="polite"
        >
          <strong>{phaseMeta.title}</strong>
          <span>{statusDetail || phaseMeta.detail}</span>
        </div>

        {phase === 'recording' ? (
          <div className="capture-screen__rec-bar">
            <span className="capture-screen__live" aria-hidden>
              录制中
            </span>
            <span className="capture-screen__rec-time" aria-live="polite">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </span>
            <button type="button" className="btn btn--accent" onClick={stopRecording}>
              停止
            </button>
            <button type="button" className="btn btn--ghost" onClick={cancelRecording}>
              取消
            </button>
          </div>
        ) : null}

        {phase !== 'recording' ? (
          <div className="capture-screen__mic">
            <MicButton
              listening={false}
              disabled={phase === 'processing' || phase === 'submitting'}
              onToggle={toggleMic}
              idleLabel={speech.supported ? '点击开始录音' : '语音不可用'}
            />
          </div>
        ) : (
          <div className="capture-screen__mic">
            <MicButton
              listening
              elapsedSeconds={elapsed}
              onToggle={toggleMic}
              idleLabel="点击停止"
            />
          </div>
        )}

        <p className="capture-screen__privacy muted">
          语音识别由浏览器提供，通常需联网并将音频送至识别服务；本应用不会在未确认前写入 SAP。
        </p>

        <div className="capture-screen__toolbar">
          <button
            type="button"
            className={`chip-btn${keyboardMode ? ' is-active' : ''}`}
            onClick={() => setKeyboardMode((v) => !v)}
          >
            {keyboardMode ? '收起键盘' : '改用键盘'}
          </button>
          {opportunityDrafts.length > 0 && onOpenOpportunity ? (
            <button type="button" className="chip-btn is-active" onClick={onOpenOpportunity}>
              <IconEye /> 查看商机
            </button>
          ) : null}
          {offlinePending > 0 ? (
            <button
              type="button"
              className="chip-btn"
              disabled={!isOnline() || phase === 'processing'}
              onClick={() => {
                void flushOffline()
              }}
            >
              补传离线（{offlinePending}）
            </button>
          ) : null}
        </div>

        {keyboardMode || phase === 'permission_denied' || !speech.supported ? (
          <div className="capture-screen__keyboard">
            <label className="capture-screen__keyboard-label" htmlFor="capture-transcript-input">
              键盘输入 / 编辑转写
            </label>
            <textarea
              id="capture-transcript-input"
              rows={3}
              placeholder="例如：刚拜访完仁济张主任，对 N17 感兴趣，要 12 台…"
              value={transcriptEdit}
              disabled={phase === 'processing' || phase === 'submitting' || phase === 'recording'}
              onChange={(e) => {
                setTranscriptEdit(e.target.value)
                if (e.target.value.trim() && phase !== 'processing') {
                  setPhase('transcript_ready')
                }
              }}
            />
            <div className="capture-screen__fallback-actions">
              <button
                type="button"
                className="btn btn--accent"
                disabled={phase === 'processing' || phase === 'submitting' || !transcriptEdit.trim()}
                onClick={() => {
                  void generateDrafts(transcriptEdit)
                }}
              >
                生成草稿
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={phase === 'processing' || phase === 'submitting'}
                onClick={() => {
                  setTranscriptEdit(DEMO_UTTERANCE)
                  setPhase('transcript_ready')
                  void generateDrafts(DEMO_UTTERANCE)
                }}
              >
                仁济示例
              </button>
            </div>
          </div>
        ) : null}
      </article>

      {!keyboardMode && (phase === 'transcript_ready' || phase === 'processing' || drafts.length > 0) ? (
        <div className="capture-screen__transcript">
          <div className="capture-screen__transcript-head">
            <strong>转写内容（可编辑）</strong>
            {phase === 'recording' ? <span className="capture-screen__live">识别中</span> : null}
          </div>
          <textarea
            rows={3}
            aria-label="转写内容"
            value={displayTranscript}
            disabled={phase === 'processing' || phase === 'submitting' || phase === 'recording'}
            onChange={(e) => {
              setTranscriptEdit(e.target.value)
              speech.setTranscript(e.target.value)
            }}
          />
          {phase === 'transcript_ready' && drafts.length === 0 ? (
            <div className="capture-screen__fallback-actions">
              <button
                type="button"
                className="btn btn--accent"
                disabled={!transcriptEdit.trim()}
                onClick={() => {
                  void generateDrafts(transcriptEdit)
                }}
              >
                生成草稿
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === 'processing' ? (
        <article className="capture-screen__ai is-busy" aria-live="polite">
          <span className="capture-screen__ai-icon" aria-hidden>
            <IconSpark />
          </span>
          <div className="capture-screen__ai-copy">
            <strong>AI 处理中</strong>
            <p>{statusDetail || '正在抽取客户、联系人、产品与跟进时间…'}</p>
          </div>
        </article>
      ) : null}

      {usedMockSync ? (
        <p className="capture-screen__mock-banner" role="status">
          后端确认接口不可用：草稿已保留为「同步失败」，不会伪造 SAP 成功。请检查 API 后重试。
        </p>
      ) : null}

      {drafts.length > 0 ? (
        <div className="capture-screen__drafts">
          <div className="capture-screen__drafts-head">
            <div>
              <h3>待确认草稿</h3>
              <p className="muted">
                {draftPending} 待确认
                {syncingCount ? ` · ${syncingCount} 同步中` : ''}
                {syncedCount ? ` · ${syncedCount} 已同步` : ''}
                {failedCount ? ` · ${failedCount} 失败` : ''}
              </p>
            </div>
            {draftPending > 0 ? (
              <button
                type="button"
                className="btn btn--accent"
                disabled={phase === 'submitting' || phase === 'processing'}
                onClick={() => {
                  void handleConfirmAll()
                }}
              >
                全部确认
              </button>
            ) : null}
          </div>

          {activityDrafts.length > 0 ? (
            <section className="capture-screen__draft-group" aria-label="活动草稿">
              <h4>活动草稿</h4>
              {activityDrafts.map((d) => (
                <DraftCard
                  key={d.idempotencyKey}
                  draft={d}
                  busy={phase === 'submitting' || phase === 'processing'}
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
            </section>
          ) : null}

          {opportunityDrafts.length > 0 ? (
            <section className="capture-screen__draft-group" aria-label="商机草稿">
              <h4>商机草稿</h4>
              {opportunityDrafts.map((d) => (
                <DraftCard
                  key={d.idempotencyKey}
                  draft={d}
                  busy={phase === 'submitting' || phase === 'processing'}
                  openOpportunityNames={openOppNames}
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
            </section>
          ) : null}
        </div>
      ) : null}

      <details
        className="capture-screen__dev"
        open={showDevTools}
        onToggle={(e) => setShowDevTools((e.target as HTMLDetailsElement).open)}
      >
        <summary>开发选项</summary>
        <label className="capture-screen__fail-toggle">
          <input
            type="checkbox"
            checked={simulateFail}
            onChange={(e) => setSimulateFail(e.target.checked)}
          />
          模拟 SAP 同步失败（验证重试；本地 mock 路径）
        </label>
        <p className="muted" style={{ marginTop: '0.4rem' }}>
          当前编排模式：{getOrchestratorMode()}
        </p>
      </details>
    </section>
  )
}
