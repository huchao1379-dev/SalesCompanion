import './AddInsightTaskSheet.css'
import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './DashIcons'
import { IconButton } from './IconButton'
import type { InsightAction } from '../data/activityInsight'
import { PRIORITY_LABEL } from '../data/activityInsight'
import {
  addMinutesToTime,
  commitInsightTask,
  compareTime,
  formatDateKey,
  formatDueDateLabel,
  formatTimeRange,
  suggestDueDate,
  suggestTimeRange,
} from '../data/insightTasks'

type Props = {
  open: boolean
  action: InsightAction | null
  activityId: string
  activityTitle: string
  orgName: string
  onClose: () => void
  onAdded?: (info: { dueDate: string; actionId: string }) => void
}

export function AddInsightTaskSheet({
  open,
  action,
  activityId,
  activityTitle,
  orgName,
  onClose,
  onAdded,
}: Props) {
  const titleId = useId()
  const titleFieldId = useId()
  const descFieldId = useId()
  const dateId = useId()
  const startId = useId()
  const endId = useId()
  const today = useMemo(() => formatDateKey(new Date()), [])
  const weekQuick = useMemo(() => suggestDueDate('this_week'), [])
  const laterQuick = useMemo(() => suggestDueDate('later'), [])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(today)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !action) return
    const times = suggestTimeRange(action.priority)
    setTitle(action.title)
    setDescription(action.description || '')
    setDueDate(suggestDueDate(action.priority))
    setStartTime(times.startTime)
    setEndTime(times.endTime)
    setEditing(false)
    setSaving(false)
  }, [open, action])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, saving])

  if (!open || !action || typeof document === 'undefined') return null

  const fieldsLocked = !editing || saving

  function handleStartTimeChange(value: string) {
    const nextStart = value || startTime
    setStartTime(nextStart)
    if (compareTime(endTime, nextStart) <= 0) {
      setEndTime(addMinutesToTime(nextStart, 60))
    }
  }

  function handleConfirm() {
    if (!action || saving) return
    // Only「完成」persists the task. Close / Edit / scrim never write.
    setSaving(true)
    setEditing(false)
    let nextEnd = endTime
    if (compareTime(nextEnd, startTime) <= 0) {
      nextEnd = addMinutesToTime(startTime, 60)
    }
    const saved = commitInsightTask({
      title: title.trim() || action.title,
      description: description.trim(),
      dueDate,
      startTime,
      endTime: nextEnd,
      priority: action.priority,
      ownerName: action.ownerName,
      contactName: action.contactName,
      source: action.source,
      activityId,
      activityTitle,
      orgName,
      actionId: action.id,
    })
    onAdded?.({ dueDate: saved.dueDate, actionId: action.id })
    window.setTimeout(() => onClose(), 650)
  }

  const previewLabel = `${formatDueDateLabel(dueDate)} ${formatTimeRange(startTime, endTime)}`

  return createPortal(
    <div className="add-task-modal-root" role="presentation">
      <button
        type="button"
        className="add-task-modal__scrim"
        aria-label="关闭添加到任务"
        onClick={() => {
          if (!saving) onClose()
        }}
      />
      <div
        className={`add-task-modal${saving ? ' is-saved' : ''}${editing ? ' is-editing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="add-task-modal__head">
          <div className="add-task-modal__copy">
            <p className="add-task-modal__eyebrow" id={titleId}>
              添加到任务
            </p>
            <p className="add-task-modal__meta">
              {orgName}
              {action.priority ? ` · ${PRIORITY_LABEL[action.priority]}` : ''}
            </p>
          </div>
          <IconButton
            variant="soft"
            size="sm"
            squared
            aria-label="关闭"
            title="关闭"
            disabled={saving}
            onClick={onClose}
          >
            <IconClose />
          </IconButton>
        </header>

        <div className="add-task-modal__body">
          <div className="add-task-modal__editable">
            <span className="add-task-modal__editable-hint">标题</span>
            {editing ? (
              <textarea
                id={titleFieldId}
                className="add-task-modal__title-input"
                rows={2}
                value={title}
                disabled={saving}
                placeholder="输入任务标题"
                enterKeyHint="next"
                onChange={(e) => setTitle(e.target.value)}
              />
            ) : (
              <p className="add-task-modal__title-view">{title || '未命名任务'}</p>
            )}
          </div>

          <div className="add-task-modal__editable is-desc">
            <span className="add-task-modal__editable-hint">详细内容</span>
            {editing ? (
              <textarea
                id={descFieldId}
                className="add-task-modal__desc-input"
                rows={3}
                value={description}
                disabled={saving}
                placeholder="补充任务说明、对象与目标"
                onChange={(e) => setDescription(e.target.value)}
              />
            ) : (
              <p className="add-task-modal__desc-view">
                {description || '暂无详细说明'}
              </p>
            )}
          </div>

          <div className="add-task-modal__section">
            <label className="add-task-modal__field" htmlFor={dateId}>
              <span>日期</span>
              <input
                id={dateId}
                type="date"
                min={today}
                value={dueDate}
                disabled={fieldsLocked}
                onChange={(e) => setDueDate(e.target.value || today)}
              />
            </label>

            <div className="add-task-modal__time-row">
              <label className="add-task-modal__field" htmlFor={startId}>
                <span>开始</span>
                <input
                  id={startId}
                  type="time"
                  value={startTime}
                  disabled={fieldsLocked}
                  step={300}
                  onChange={(e) => handleStartTimeChange(e.target.value)}
                />
              </label>
              <span className="add-task-modal__time-sep" aria-hidden>
                –
              </span>
              <label className="add-task-modal__field" htmlFor={endId}>
                <span>结束</span>
                <input
                  id={endId}
                  type="time"
                  value={endTime}
                  disabled={fieldsLocked}
                  step={300}
                  min={startTime}
                  onChange={(e) => {
                    const next = e.target.value || endTime
                    if (compareTime(next, startTime) <= 0) {
                      setEndTime(addMinutesToTime(startTime, 30))
                      return
                    }
                    setEndTime(next)
                  }}
                />
              </label>
            </div>

            <div className="add-task-modal__quick" role="group" aria-label="快捷日期">
              <QuickChip
                label="今天"
                active={dueDate === today}
                disabled={fieldsLocked}
                onClick={() => setDueDate(today)}
              />
              <QuickChip
                label="本周"
                active={dueDate === weekQuick}
                disabled={fieldsLocked}
                onClick={() => setDueDate(weekQuick)}
              />
              <QuickChip
                label="一周后"
                active={dueDate === laterQuick}
                disabled={fieldsLocked}
                onClick={() => setDueDate(laterQuick)}
              />
            </div>

            <div className="add-task-modal__quick" role="group" aria-label="快捷时段">
              <QuickChip
                label="上午 9–10"
                active={startTime === '09:00' && endTime === '10:00'}
                disabled={fieldsLocked}
                onClick={() => {
                  setStartTime('09:00')
                  setEndTime('10:00')
                }}
              />
              <QuickChip
                label="下午 14–15"
                active={startTime === '14:00' && endTime === '15:00'}
                disabled={fieldsLocked}
                onClick={() => {
                  setStartTime('14:00')
                  setEndTime('15:00')
                }}
              />
              <QuickChip
                label="傍晚 16:30–17:30"
                active={startTime === '16:30' && endTime === '17:30'}
                disabled={fieldsLocked}
                onClick={() => {
                  setStartTime('16:30')
                  setEndTime('17:30')
                }}
              />
            </div>

            <p className="add-task-modal__preview">
              点击「完成」后才会添加到 · <strong>{previewLabel}</strong>
            </p>
          </div>

          {saving ? (
            <p className="add-task-modal__ok" role="status">
              已添加到 {previewLabel}
            </p>
          ) : null}
        </div>

        <div className="add-task-modal__footer">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={saving}
          >
            关闭
          </button>
          <button
            type="button"
            className={`btn btn--ghost add-task-modal__edit-btn${editing ? ' is-active' : ''}`}
            onClick={() => setEditing((v) => !v)}
            disabled={saving}
            aria-pressed={editing}
          >
            {editing ? '完成编辑' : '编辑'}
          </button>
          <button
            type="button"
            className="btn btn--accent"
            onClick={handleConfirm}
            disabled={saving}
          >
            {saving ? '已添加' : '完成'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function QuickChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`add-task-modal__chip${active ? ' is-active' : ''}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
