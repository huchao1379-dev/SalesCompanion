import './TasksHub.css'
import { useEffect, useState, type ReactNode } from 'react'
import type { AgentInvocationRecord, DraftPayload } from '../../agents/types'
import { api } from '../../api/client'
import { SyncStatusBadge } from '../../components/SyncStatusBadge'
import { listDrafts, refreshDraftsFromApi } from '../../data/dataverse'
import { subscribeDrafts } from '../../data/draftStore'
import { listInvocations } from '../../data/invocationLog'

type Props = {
  onOpenCapture: () => void
  onOpenOpportunity: () => void
  onOpenDraft: (draft: DraftPayload) => void
}

export function TasksHub({ onOpenCapture, onOpenOpportunity, onOpenDraft }: Props) {
  const [drafts, setDrafts] = useState<DraftPayload[]>(() => listDrafts())
  const [logs, setLogs] = useState<AgentInvocationRecord[]>(() => listInvocations().slice(0, 5))

  useEffect(() => {
    void refreshDraftsFromApi().then(setDrafts)
    void api
      .logs()
      .then((res) => {
        const rows = (res.logs as Array<{
          id: string
          sessionId?: string
          agentName: string
          inputSummary: string
          latencyMs: number
          success: boolean
          confidence?: number
          errorMessage?: string
          createdAt: string
        }>).map((r) => ({
          id: r.id,
          conversationId: r.sessionId,
          agentName: r.agentName,
          utterance: r.inputSummary,
          latencyMs: r.latencyMs,
          success: r.success,
          confidence: r.confidence,
          errorMessage: r.errorMessage,
          createdAt: r.createdAt,
        }))
        setLogs(rows.slice(0, 8))
      })
      .catch(() => {
        setLogs(listInvocations().slice(0, 5))
      })
    return subscribeDrafts(setDrafts)
  }, [])

  const open = drafts.filter((d) => d.syncStatus === 'Draft' || d.syncStatus === 'SyncFailed')
  const syncing = drafts.filter((d) => d.syncStatus === 'Confirmed' || d.syncStatus === 'Syncing')
  const done = drafts.filter((d) => d.syncStatus === 'Synced').slice(0, 5)

  return (
    <section className="screen tasks">
      <header>
        <p className="home__eyebrow">任务</p>
        <h1>今日待办</h1>
        <p className="muted">草稿确认、同步补偿、新拜访录入（选做增强屏）。</p>
      </header>

      <div className="home__actions">
        <button type="button" className="btn btn--accent" onClick={onOpenCapture}>
          新拜访录入
        </button>
        <button type="button" className="btn btn--ghost" onClick={onOpenOpportunity}>
          商机草稿
        </button>
      </div>

      <TaskGroup title={`待确认 / 失败（${open.length}）`} empty="暂无待处理草稿">
        {open.map((d) => (
          <TaskRow key={d.idempotencyKey} draft={d} onOpen={() => onOpenDraft(d)} />
        ))}
      </TaskGroup>

      <TaskGroup title={`同步中（${syncing.length}）`} empty="没有进行中的同步">
        {syncing.map((d) => (
          <TaskRow key={d.idempotencyKey} draft={d} onOpen={() => onOpenDraft(d)} />
        ))}
      </TaskGroup>

      <TaskGroup title="最近已同步" empty="尚无已同步记录">
        {done.map((d) => (
          <TaskRow key={d.idempotencyKey} draft={d} onOpen={() => onOpenDraft(d)} />
        ))}
      </TaskGroup>

      <div className="tasks__logs">
        <h2>最近 Agent 调用</h2>
        {logs.length === 0 ? (
          <p className="muted">暂无调用日志</p>
        ) : (
          <ul>
            {logs.map((row) => (
              <li key={row.id}>
                <strong>{row.agentName}</strong>
                <span className="muted">
                  {' '}
                  · {row.latencyMs}ms · {row.success ? '成功' : '失败'}
                </span>
                <div className="muted">{row.utterance.slice(0, 48)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function TaskGroup({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: ReactNode
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : []
  return (
    <div className="task-group">
      <h2>{title}</h2>
      {items.length === 0 ? <p className="muted">{empty}</p> : <div className="task-list">{items}</div>}
    </div>
  )
}

function TaskRow({ draft, onOpen }: { draft: DraftPayload; onOpen: () => void }) {
  const title = draft.kind === 'activity' ? draft.subject : draft.name
  return (
    <button type="button" className="task-row" onClick={onOpen}>
      <div>
        <div className="task-row__title">{title}</div>
        <div className="muted">
          {draft.kind === 'activity' ? '活动' : '商机'} · {draft.accountName}
        </div>
      </div>
      <SyncStatusBadge status={draft.syncStatus} />
    </button>
  )
}
