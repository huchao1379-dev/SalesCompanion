import './ActivityCapture.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AccountProfile,
  DraftPayload,
  OrchestratorResponse,
} from '../../agents/types'
import { getOrchestratorMode, orchestrate } from '../../agents/orchestratorClient'
import {
  IconBuilding,
  IconCheck,
  IconChevronDown,
  IconEye,
  IconMic,
  IconPause,
  IconPlay,
  IconRefresh,
  IconSpark,
  IconStop,
} from '../../components/DashIcons'
import { DraftCard } from '../../components/DraftCard'
import { MicButton } from '../../components/MicButton'
import { ScreenHeader } from '../../components/ScreenHeader'
import {
  fetchAccountInsight,
  getAccountInsight,
  listAccountsFromApi,
  listMockAccounts,
} from '../../data/accounts'
import {
  confirmAndSyncDetailed,
  discardDraft,
  upsertDraft,
} from '../../data/dataverse'
import { canConfirmDraft } from '../../data/syncStatus'
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
  onAccountChange?: (accountRef: string) => void
}

/** Explicit capture flow phases for sales mobile recording. */
export type CapturePhase =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'processing'
  | 'transcript_ready'
  | 'recognition_failed'
  | 'network_error'
  | 'permission_denied'
  | 'submitting'
  | 'sync_success'
  | 'sync_failed'

const STEPS = [
  { key: 'speak', label: '口述' },
  { key: 'transcript', label: '转写' },
  { key: 'confirm', label: '确认' },
] as const

function buildAiSummaryText(res: OrchestratorResponse): string {
  const activity = res.drafts.find((d) => d.kind === 'activity')
  const opportunity = res.drafts.find((d) => d.kind === 'opportunity')
  const sections: string[] = []

  if (activity && activity.kind === 'activity') {
    const lines = [
      `拜访摘要：${activity.summary || activity.subject || '（待补充）'}`,
      activity.accountName ? `客户：${activity.accountName}` : null,
      activity.contactName && activity.contactName !== '待补充'
        ? `联系人：${activity.contactName}`
        : null,
      activity.visitType ? `类型：${activity.visitType}` : null,
      activity.followUpAt ? `跟进：${activity.followUpAt.slice(0, 10)}` : null,
    ].filter(Boolean)
    sections.push(lines.join('\n'))
  }

  if (opportunity && opportunity.kind === 'opportunity') {
    const qty = opportunity.quantity > 0 ? ` × ${opportunity.quantity}` : ''
    sections.push(
      [
        `商机意向：${opportunity.name || opportunity.productLine || '（待补充）'}`,
        opportunity.productLine
          ? `产品：${opportunity.productLine}${opportunity.productModel ? ` ${opportunity.productModel}` : ''}${qty}`
          : null,
        opportunity.stage ? `阶段：${opportunity.stage}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  const assistantText = res.messages
    .filter((m) => m.role === 'assistant' && m.content.trim())
    .map((m) => m.content.trim())
    .join('\n\n')

  if (assistantText) {
    sections.push(assistantText)
  }

  if (!sections.length) {
    return '暂未提取到可展示的总结。请用包含客户、联系人、产品与跟进时间的拜访口述再试。'
  }

  return sections.join('\n\n')
}

const PHASE_COPY: Record<
  CapturePhase,
  { title: string; detail: string; tone: 'neutral' | 'live' | 'warn' | 'danger' | 'ok' | 'busy' }
> = {
  idle: {
    title: '待机',
    detail: '点击麦克风开始录音。转写内容会实时显示在上方区域。',
    tone: 'neutral',
  },
  recording: {
    title: '录音中',
    detail: '请说出客户、联系人、产品与跟进时间。可暂停或结束录音。',
    tone: 'live',
  },
  paused: {
    title: '已暂停',
    detail: '录音已暂停，可继续录音或结束并处理转写内容。',
    tone: 'warn',
  },
  processing: {
    title: '处理中',
    detail: 'AI 正在从转写中抽取拜访与商机字段，不确定项会标为「待补充」。',
    tone: 'busy',
  },
  transcript_ready: {
    title: '转写完成',
    detail: '可直接点击内容区修改，或进行 AI 总结。',
    tone: 'ok',
  },
  recognition_failed: {
    title: '识别失败',
    detail: '未得到有效转写。请重试录音，或直接在内容区补充。',
    tone: 'warn',
  },
  network_error: {
    title: '网络异常',
    detail: '编排服务不可用或设备离线。口述可缓存，联网后再生成草稿。',
    tone: 'danger',
  },
  permission_denied: {
    title: '麦克风权限拒绝',
    detail: '请在系统设置中允许麦克风，或直接在内容区输入拜访内容。',
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
    phase === 'recording' ||
    phase === 'paused'
  ) {
    return phase === 'recording' && !hasTranscript ? 0 : 1
  }
  return 0
}

function formatElapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function ActivityCapture({
  initialDrafts = [],
  accountKey,
  onBack,
  onDraftsCommitted,
  onOpenOpportunity,
  onAccountChange,
}: Props) {
  const speech = useWebSpeech()
  const [phase, setPhase] = useState<CapturePhase>(() =>
    initialDrafts.length > 0 ? 'transcript_ready' : 'idle',
  )
  const [accountPickerOpen, setAccountPickerOpen] = useState(false)
  const [accountOptions, setAccountOptions] = useState<AccountProfile[]>(() => listMockAccounts())
  const [selectedAccountRef, setSelectedAccountRef] = useState(
    () => accountKey || 'SAP-ACC-RENJI',
  )
  const [transcriptEdit, setTranscriptEdit] = useState(() => {
    const fromActivity = initialDrafts.find((d) => d.kind === 'activity')
    return fromActivity && 'transcript' in fromActivity ? fromActivity.transcript : ''
  })
  const [drafts, setDrafts] = useState<DraftPayload[]>(() => initialDrafts)
  const [statusDetail, setStatusDetail] = useState<string | null>(null)
  const [simulateFail, setSimulateFail] = useState(false)
  const [showDevTools, setShowDevTools] = useState(false)
  const [usedMockSync, setUsedMockSync] = useState(false)
  const [savedHint, setSavedHint] = useState(false)
  const [aiSummary, setAiSummary] = useState('')
  const [viewStep, setViewStep] = useState(() => (initialDrafts.length > 0 ? 2 : 0))
  const [offlinePending, setOfflinePending] = useState(
    () => listOfflineUtterances().filter((u) => !u.synced).length,
  )
  const recordStartedAt = useRef<number | null>(null)
  const pausedAccumulated = useRef(0)
  const autoSaveTimer = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const contentAreaRef = useRef<HTMLTextAreaElement | null>(null)

  const [contextAccount, setContextAccount] = useState<AccountProfile | null>(() =>
    getAccountInsight(selectedAccountRef),
  )

  useEffect(() => {
    let alive = true
    void listAccountsFromApi()
      .then((list) => {
        if (alive && list.length) setAccountOptions(list)
      })
      .catch(() => {
        /* Keep mock list. */
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    const seed = getAccountInsight(selectedAccountRef)
    if (seed) setContextAccount(seed)
    void fetchAccountInsight(selectedAccountRef)
      .then((profile) => {
        if (alive && profile) setContextAccount(profile)
      })
      .catch(() => {
        /* Keep the offline/seed fallback. */
      })
    return () => {
      alive = false
    }
  }, [selectedAccountRef])

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

  const isRecordingSession = phase === 'recording' || phase === 'paused'
  const livePreview = speech.listening
    ? [speech.transcript, speech.interimTranscript].filter(Boolean).join(' ')
    : ''
  const displayTranscript = speech.listening ? livePreview : transcriptEdit
  const derivedStep = deriveStepIndex(phase, drafts.length > 0, Boolean(transcriptEdit.trim()))
  const stepIndex = viewStep
  const isConfirmStep = stepIndex === 2
  const busy = phase === 'processing' || phase === 'submitting' || phase === 'recording'
  const phaseMeta = PHASE_COPY[phase]
  const contentLocked =
    phase === 'processing' || phase === 'submitting' || phase === 'recording'
  const hasContent = Boolean(displayTranscript.trim())
  const canOpenStep = (index: number) => {
    if (index <= 1) return true
    return drafts.length > 0 || derivedStep >= 2
  }

  /* Keep the visible step in sync when the flow advances forward. */
  useEffect(() => {
    setViewStep((prev) => (derivedStep > prev ? derivedStep : prev))
  }, [derivedStep])

  useEffect(() => {
    if (!isConfirmStep) return
    setAccountPickerOpen(false)
  }, [isConfirmStep])

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current != null) {
        window.clearTimeout(autoSaveTimer.current)
      }
    }
  }, [])

  function goToStep(index: number) {
    if (!canOpenStep(index)) {
      setStatusDetail(
        index === 2
          ? '请先完成 AI 总结并生成草稿后再进入确认'
          : '请先录音或录入转写内容后再查看转写步骤',
      )
      return
    }
    if (phase === 'recording' || phase === 'paused') {
      setStatusDetail('请先结束或取消当前录音，再切换步骤')
      return
    }
    setViewStep(index)
    setAccountPickerOpen(false)
    window.requestAnimationFrame(() => {
      document
        .querySelector('.capture-screen__steps')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  useEffect(() => {
    if (phase !== 'recording') return
    const id = window.setInterval(() => {
      if (recordStartedAt.current == null) return
      setElapsed(
        pausedAccumulated.current + Math.floor((Date.now() - recordStartedAt.current) / 1000),
      )
    }, 200)
    return () => window.clearInterval(id)
  }, [phase])

  /* eslint-disable react-hooks/set-state-in-effect -- Browser Speech API errors are external events mirrored into the capture phase. */
  useEffect(() => {
    if (!speech.errorKind) return
    if (speech.errorKind === 'not-allowed') {
      setPhase('permission_denied')
      setStatusDetail(speech.error)
    } else if (speech.errorKind === 'network') {
      setPhase('network_error')
      setStatusDetail(speech.error)
    } else if (speech.errorKind === 'no-speech' || speech.errorKind === 'other') {
      if (phase === 'recording' || phase === 'idle' || phase === 'paused') {
        setPhase('recognition_failed')
        setStatusDetail(speech.error)
      }
    } else if (speech.errorKind === 'unsupported') {
      setStatusDetail(speech.error)
    }
  }, [speech.errorKind, speech.error, phase])
  /* eslint-enable react-hooks/set-state-in-effect */

  function selectAccount(profile: AccountProfile) {
    setSelectedAccountRef(profile.accountRef)
    setContextAccount(profile)
    setAccountPickerOpen(false)
    onAccountChange?.(profile.accountRef)
    setStatusDetail(`已选择客户：${profile.accountName}`)
  }

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
        : '正在生成 AI 总结与草稿…',
    )
    try {
      // Bias the capture page toward visit extraction even for short utterances.
      const captureUtterance = /拜访|录入拜访|刚拜访/.test(trimmed)
        ? trimmed
        : `录入拜访：${trimmed}`
      const res = await orchestrate({
        utterance: captureUtterance,
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
      const summaryText = buildAiSummaryText(res)
      setAiSummary(summaryText)
      setPhase('transcript_ready')
      if (next.length > 0) {
        setStatusDetail(`AI 总结完成 · 已生成 ${next.length} 条草稿，请核对后确认同步`)
        onDraftsCommitted?.(next)
      } else {
        setStatusDetail('AI 已返回说明，但未生成草稿。请按示例补充客户/产品信息后重试。')
      }
      // Scroll summary into view after paint.
      window.requestAnimationFrame(() => {
        document.getElementById('capture-ai-summary')?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
      })
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
    setSavedHint(false)
    setAiSummary('')
    if (!speech.supported) {
      setPhase('idle')
      setStatusDetail('当前环境不支持语音识别，请在内容区直接输入')
      return
    }
    if (!isOnline()) {
      setStatusDetail('当前离线：浏览器语音识别可能不可用')
    }
    pausedAccumulated.current = 0
    recordStartedAt.current = Date.now()
    setElapsed(0)
    setPhase('recording')
    speech.start('zh-CN')
  }

  function pauseRecording() {
    const text = speech.pause()
    if (recordStartedAt.current != null) {
      pausedAccumulated.current += Math.floor((Date.now() - recordStartedAt.current) / 1000)
      recordStartedAt.current = null
    }
    setElapsed(pausedAccumulated.current)
    if (text.trim()) setTranscriptEdit(text.trim())
    setPhase('paused')
    setStatusDetail('已暂停，可继续录音或结束')
  }

  function resumeRecording() {
    speech.clearError()
    recordStartedAt.current = Date.now()
    setPhase('recording')
    setStatusDetail(null)
    speech.resume('zh-CN')
  }

  function endRecording() {
    const text = speech.listening || speech.paused ? speech.stop() : transcriptEdit
    recordStartedAt.current = null
    pausedAccumulated.current = 0
    const finalText = text.trim() || transcriptEdit.trim()
    if (finalText) {
      setTranscriptEdit(finalText)
      setPhase('transcript_ready')
      persistTranscript(finalText)
      setStatusDetail('转写完成，可直接点击内容修改或进行 AI 总结')
    } else {
      setPhase('recognition_failed')
      setStatusDetail('未识别到有效语音，可在内容区手动补充')
    }
  }

  function cancelRecording() {
    speech.cancel()
    recordStartedAt.current = null
    pausedAccumulated.current = 0
    setElapsed(0)
    setPhase('idle')
    setStatusDetail('已取消录音')
  }

  function persistTranscript(raw: string, opts?: { quiet?: boolean }) {
    const trimmed = raw.trim()
    if (!trimmed) return
    const existing = drafts.find((d) => d.kind === 'activity')
    if (existing && existing.kind === 'activity') {
      const next: DraftPayload = {
        ...existing,
        transcript: trimmed,
        summary: existing.summary || trimmed,
        subject: existing.subject || `拜访 · ${contextAccount?.accountName || '客户'}`,
        updatedAt: new Date().toISOString(),
        accountRef: contextAccount?.accountRef || existing.accountRef,
        accountName: contextAccount?.accountName || existing.accountName,
      }
      updateDraft(next)
    } else {
      const now = new Date().toISOString()
      const accountName = contextAccount?.accountName || '待补充客户'
      const draft: DraftPayload = {
        kind: 'activity',
        idempotencyKey: `local_activity_${Date.now()}`,
        syncStatus: 'Draft',
        createdAt: now,
        updatedAt: now,
        subject: `拜访 · ${accountName}`,
        summary: trimmed,
        visitType: 'Visit',
        accountName,
        accountRef: contextAccount?.accountRef,
        contactName: '待补充',
        followUpAt: '',
        transcript: trimmed,
        confidence: 0.55,
        sources: [{ kind: 'other', label: '语音转写', ref: 'speech' }],
        agentName: '现场录入',
      }
      upsertDraft(draft)
      setDrafts((prev) => [...prev.filter((d) => d.kind !== 'activity'), draft])
      onDraftsCommitted?.([draft, ...drafts.filter((d) => d.kind !== 'activity')])
    }
    setSavedHint(true)
    setPhase('transcript_ready')
    if (!opts?.quiet) {
      setStatusDetail('内容已自动保存')
    }
  }

  function scheduleAutoSave(value: string) {
    if (autoSaveTimer.current != null) {
      window.clearTimeout(autoSaveTimer.current)
    }
    autoSaveTimer.current = window.setTimeout(() => {
      autoSaveTimer.current = null
      persistTranscript(value, { quiet: true })
    }, 500)
  }

  function syncContentAreaHeight() {
    const el = contentAreaRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxPx = Math.min(window.innerHeight * 0.5, 22 * 16)
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 9 * 16), maxPx)}px`
  }

  function handleContentChange(value: string) {
    setTranscriptEdit(value)
    speech.setTranscript(value)
    setSavedHint(false)
    if (value.trim() && phase !== 'processing' && phase !== 'submitting' && !isRecordingSession) {
      setPhase('transcript_ready')
      scheduleAutoSave(value)
    }
    window.requestAnimationFrame(syncContentAreaHeight)
  }

  useEffect(() => {
    if (isRecordingSession) return
    window.requestAnimationFrame(syncContentAreaHeight)
  }, [transcriptEdit, isRecordingSession, stepIndex])

  function updateDraft(next: DraftPayload) {
    setDrafts((prev) => prev.map((d) => (d.idempotencyKey === next.idempotencyKey ? next : d)))
    upsertDraft({ ...next, updatedAt: new Date().toISOString() })
  }

  async function handleConfirm(draft: DraftPayload) {
    if (!canConfirmDraft(draft)) {
      setPhase('transcript_ready')
      setStatusDetail('督导存在阻断项，请先补全必填信息后再确认同步。')
      return
    }
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
    const pending = drafts.filter((d) => canConfirmDraft(d))
    if (!pending.length) {
      if (drafts.some((d) => d.syncStatus === 'Draft' && d.reviewStatus === 'blocked')) {
        setStatusDetail('督导存在阻断项，请先补全必填信息后再确认同步。')
      }
      return
    }
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
    pausedAccumulated.current = 0
    setElapsed(0)
    setTranscriptEdit('')
    setDrafts([])
    setAiSummary('')
    setUsedMockSync(false)
    setSavedHint(false)
    setAccountPickerOpen(false)
    setViewStep(0)
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
        {STEPS.map((step, i) => {
          const reachable = canOpenStep(i)
          const lockedByRecording =
            (phase === 'recording' || phase === 'paused') && i !== stepIndex
          return (
            <li
              key={step.key}
              className={[
                i < derivedStep ? 'is-done' : '',
                i === stepIndex ? 'is-active' : '',
                !reachable || lockedByRecording ? 'is-disabled' : 'is-clickable',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <button
                type="button"
                className="capture-screen__step-btn"
                aria-current={i === stepIndex ? 'step' : undefined}
                aria-disabled={!reachable || lockedByRecording}
                disabled={!reachable || lockedByRecording}
                onClick={() => goToStep(i)}
              >
                <span className="capture-screen__step-dot">
                  {i < derivedStep ? <IconCheck /> : i + 1}
                </span>
                <span>{step.label}</span>
              </button>
            </li>
          )
        })}
      </ol>

      {!isConfirmStep ? (
      <div className={`capture-screen__account-wrap${accountPickerOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className={`capture-screen__account capture-screen__account--select${
            accountPickerOpen ? ' is-open' : ''
          }`}
          aria-expanded={accountPickerOpen}
          aria-haspopup="listbox"
          onClick={() => setAccountPickerOpen((v) => !v)}
        >
          <span className="capture-screen__account-icon" aria-hidden>
            <IconBuilding />
          </span>
          <div className="capture-screen__account-body">
            <div className="capture-screen__account-head">
              <strong>{contextAccount?.accountName || '选择拜访客户'}</strong>
              {contextAccount ? (
                <span className="status-pill status-pill--strong">
                  信用 {contextAccount.creditRating}
                </span>
              ) : (
                <span className="status-pill">未选择</span>
              )}
            </div>
            {contextAccount ? (
              <>
                <p>
                  近 30 天 {contextAccount.visitCount30d} 次拜访
                  {contextAccount.npsDelta ? ` · NPS ${contextAccount.npsDelta}` : ''}
                  {contextAccount.lastContactAt ? ` · 上次 ${contextAccount.lastContactAt}` : ''}
                </p>
                <div className="capture-screen__account-chips">
                  <span className="metric-chip">拜访 {contextAccount.visitCount30d}</span>
                  <span className="metric-chip">
                    开放商机 {contextAccount.openOpportunities.length}
                  </span>
                  {contextAccount.openOpportunities[0] ? (
                    <span className="metric-chip metric-chip--accent">
                      {contextAccount.openOpportunities[0].name}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <p>点击选择本次拜访的客户</p>
            )}
          </div>
          <span className="capture-screen__account-chevron" aria-hidden>
            <IconChevronDown />
          </span>
        </button>

        {accountPickerOpen ? (
          <ul className="capture-screen__account-menu" role="listbox" aria-label="选择客户">
            {accountOptions.map((account) => {
              const selected = account.accountRef === selectedAccountRef
              return (
                <li key={account.accountRef} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className={`capture-screen__account-option${selected ? ' is-selected' : ''}`}
                    onClick={() => selectAccount(account)}
                  >
                    <span className="capture-screen__account-option-icon" aria-hidden>
                      <IconBuilding />
                    </span>
                    <span className="capture-screen__account-option-body">
                      <strong>{account.accountName}</strong>
                      <span>
                        信用 {account.creditRating}
                        {account.visitCount30d != null
                          ? ` · 近 30 天 ${account.visitCount30d} 次`
                          : ''}
                      </span>
                    </span>
                    {selected ? <IconCheck /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
      ) : null}

      {!isConfirmStep ? (
      <article
        className={`capture-screen__hero${isRecordingSession ? ' is-listening' : ''}${
          phase === 'paused' ? ' is-paused' : ''
        }`}
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
                ? `录音中 ${formatElapsed(elapsed)} · 可暂停或结束`
                : phase === 'paused'
                  ? `已暂停 ${formatElapsed(elapsed)} · 可继续或结束`
                  : '语音转写实时显示在下方，确认后再同步 SAP。'}
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

        <div className="capture-screen__content">
          <div className="capture-screen__content-head">
            <div className="capture-screen__content-title">
              <strong>转写内容</strong>
              {phase === 'recording' ? <span className="capture-screen__live">识别中</span> : null}
              {phase === 'paused' ? <span className="capture-screen__paused-pill">已暂停</span> : null}
              {savedHint ? <span className="capture-screen__saved-pill">已保存</span> : null}
            </div>
            <div className="capture-screen__content-actions">
              <button
                type="button"
                className="chip-btn"
                disabled={contentLocked || !hasContent}
                onClick={() => {
                  void generateDrafts(displayTranscript)
                }}
              >
                <IconSpark /> AI 总结
              </button>
            </div>
          </div>

          {isRecordingSession ? (
            <div
              className={`capture-screen__content-display${hasContent ? '' : ' is-empty'}`}
              role="region"
              aria-label="实时转写"
            >
              {hasContent ? (
                <p>{displayTranscript}</p>
              ) : (
                <p className="capture-screen__content-placeholder">正在聆听，转写内容会实时显示…</p>
              )}
            </div>
          ) : (
            <textarea
              ref={contentAreaRef}
              className="capture-screen__content-input"
              rows={4}
              aria-label="拜访内容"
              placeholder="点击此处直接修改拜访内容，或下方开始录音…"
              value={transcriptEdit}
              disabled={phase === 'processing' || phase === 'submitting'}
              onChange={(e) => handleContentChange(e.target.value)}
              onFocus={syncContentAreaHeight}
              onBlur={() => {
                if (transcriptEdit.trim()) persistTranscript(transcriptEdit, { quiet: true })
              }}
            />
          )}

          {aiSummary ? (
            <div
              id="capture-ai-summary"
              className="capture-screen__ai-summary"
              role="region"
              aria-label="AI 总结结果"
            >
              <div className="capture-screen__ai-summary-head">
                <span className="capture-screen__ai-summary-icon" aria-hidden>
                  <IconSpark />
                </span>
                <strong>AI 总结结果</strong>
              </div>
              <p className="capture-screen__ai-summary-body">{aiSummary}</p>
            </div>
          ) : null}
        </div>

        {!isRecordingSession ? (
          <div className="capture-screen__mic">
            <MicButton
              listening={false}
              disabled={phase === 'processing' || phase === 'submitting'}
              onToggle={startRecording}
              idleLabel={speech.supported ? '点击开始录音' : '语音不可用'}
            />
          </div>
        ) : (
          <div className="capture-screen__rec-controls" role="group" aria-label="录音控制">
            <div className="capture-screen__rec-meta">
              <span
                className={`capture-screen__live${phase === 'paused' ? ' is-paused' : ''}`}
                aria-hidden
              >
                {phase === 'paused' ? '已暂停' : '录制中'}
              </span>
              <span className="capture-screen__rec-time" aria-live="polite">
                {formatElapsed(elapsed)}
              </span>
            </div>
            <div className="capture-screen__rec-buttons">
              {phase === 'recording' ? (
                <button type="button" className="btn btn--ghost capture-screen__rec-btn" onClick={pauseRecording}>
                  <IconPause /> 暂停
                </button>
              ) : (
                <button type="button" className="btn btn--accent capture-screen__rec-btn" onClick={resumeRecording}>
                  <IconPlay /> 继续
                </button>
              )}
              <button type="button" className="btn btn--accent capture-screen__rec-btn" onClick={endRecording}>
                <IconStop /> 结束
              </button>
              <button type="button" className="btn btn--ghost capture-screen__rec-btn" onClick={cancelRecording}>
                取消
              </button>
            </div>
          </div>
        )}

        <p className="capture-screen__privacy muted">
          语音识别由浏览器提供，通常需联网；确认前不会写入 SAP。
        </p>

        {(opportunityDrafts.length > 0 && onOpenOpportunity) || offlinePending > 0 ? (
          <div className="capture-screen__toolbar">
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
        ) : null}
      </article>
      ) : null}

      {isConfirmStep && aiSummary ? (
        <div
          id="capture-ai-summary"
          className="capture-screen__ai-summary capture-screen__ai-summary--confirm"
          role="region"
          aria-label="AI 总结结果"
        >
          <div className="capture-screen__ai-summary-head">
            <span className="capture-screen__ai-summary-icon" aria-hidden>
              <IconSpark />
            </span>
            <strong>AI 总结结果</strong>
          </div>
          <p className="capture-screen__ai-summary-body">{aiSummary}</p>
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

      {isConfirmStep && drafts.length === 0 ? (
        <article className="capture-screen__empty" aria-live="polite">
          <span className="capture-screen__empty-icon" aria-hidden>
            <IconSpark />
          </span>
          <h3>暂无待确认草稿</h3>
          <p>请先在「口述 / 转写」完成录音与 AI 总结，生成草稿后再回来确认。</p>
          <button type="button" className="btn btn--accent" onClick={() => goToStep(0)}>
            返回口述
          </button>
        </article>
      ) : null}

      {isConfirmStep && drafts.length > 0 ? (
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
