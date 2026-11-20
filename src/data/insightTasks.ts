import type { InsightAction, InsightActionPriority } from './activityInsight'

/** v3: only tasks explicitly confirmed via「完成」are stored / shown. */
const STORAGE_KEY = 'salescompanion.insightTasks.v3'

export type InsightTask = {
  id: string
  title: string
  description: string
  priority: InsightActionPriority
  ownerName: string | null
  contactName: string | null
  source: string
  /** Local calendar day YYYY-MM-DD */
  dueDate: string
  /** Local time HH:mm */
  startTime: string
  /** Local time HH:mm */
  endTime: string
  activityId: string
  activityTitle: string
  orgName: string
  actionId: string
  createdAt: string
  updatedAt: string
  done: boolean
  /** Must be true to appear in calendar / 今日待办. Set only by commitInsightTask. */
  committed: boolean
}

export type InsightTaskCommitInput = {
  title: string
  description: string
  dueDate: string
  startTime: string
  endTime: string
  priority: InsightActionPriority
  ownerName?: string | null
  contactName?: string | null
  source?: string
  activityId: string
  activityTitle: string
  orgName: string
  actionId: string
}

type Listener = (tasks: InsightTask[]) => void

const listeners = new Set<Listener>()

function emit(tasks: InsightTask[]) {
  listeners.forEach((l) => l(tasks))
}

function normalizeTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return fallback
  const hh = Math.min(23, Math.max(0, Number(m[1])))
  const mm = Math.min(59, Math.max(0, Number(m[2])))
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function normalizeTask(raw: Partial<InsightTask> & { id: string; dueDate: string }): InsightTask | null {
  // Discard legacy / accidental drafts that were never explicitly committed.
  if (raw.committed !== true) return null

  const startTime = normalizeTime(raw.startTime, '09:00')
  let endTime = normalizeTime(raw.endTime, '10:00')
  if (compareTime(endTime, startTime) <= 0) {
    endTime = addMinutesToTime(startTime, 60)
  }
  const now = new Date().toISOString()
  return {
    id: raw.id,
    title: String(raw.title || '未命名任务').trim() || '未命名任务',
    description: String(raw.description || '').trim(),
    priority: (raw.priority as InsightActionPriority) || 'this_week',
    ownerName: raw.ownerName ?? null,
    contactName: raw.contactName ?? null,
    source: raw.source || 'activity_notes',
    dueDate: raw.dueDate,
    startTime,
    endTime,
    activityId: String(raw.activityId || ''),
    activityTitle: String(raw.activityTitle || ''),
    orgName: String(raw.orgName || ''),
    actionId: String(raw.actionId || ''),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || raw.createdAt || now,
    done: Boolean(raw.done),
    committed: true,
  }
}

function readStore(): InsightTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { tasks?: Array<Partial<InsightTask> & { id?: string; dueDate?: string }> }
    if (!Array.isArray(parsed.tasks)) return []
    return parsed.tasks
      .filter((t): t is Partial<InsightTask> & { id: string; dueDate: string } =>
        Boolean(t && typeof t.id === 'string' && typeof t.dueDate === 'string'),
      )
      .map(normalizeTask)
      .filter((t): t is InsightTask => Boolean(t))
  } catch {
    return []
  }
}

function writeStore(tasks: InsightTask[]) {
  const committedOnly = tasks.filter((t) => t.committed)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: committedOnly }))
  emit(committedOnly)
}

export function listInsightTasks(): InsightTask[] {
  return readStore()
}

export function subscribeInsightTasks(listener: Listener): () => void {
  listeners.add(listener)
  listener(readStore())
  return () => {
    listeners.delete(listener)
  }
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDueDateLabel(dueDate: string): string {
  const date = parseDateKey(dueDate)
  if (!date) return dueDate
  const today = formatDateKey(new Date())
  if (dueDate === today) return '今天'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatTimeRange(startTime: string, endTime: string): string {
  const start = normalizeTime(startTime, '09:00')
  const end = normalizeTime(endTime, '10:00')
  return `${start}–${end}`
}

export function formatTaskScheduleLabel(task: Pick<InsightTask, 'dueDate' | 'startTime' | 'endTime'>): string {
  return `${formatDueDateLabel(task.dueDate)} ${formatTimeRange(task.startTime, task.endTime)}`
}

export function compareTime(a: string, b: string): number {
  const [ah, am] = normalizeTime(a, '00:00').split(':').map(Number)
  const [bh, bm] = normalizeTime(b, '00:00').split(':').map(Number)
  return ah * 60 + am - (bh * 60 + bm)
}

export function addMinutesToTime(time: string, minutes: number): string {
  const [hh, mm] = normalizeTime(time, '09:00').split(':').map(Number)
  const total = Math.max(0, Math.min(24 * 60 - 1, hh * 60 + mm + minutes))
  const nextH = Math.floor(total / 60)
  const nextM = total % 60
  return `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`
}

function roundUpToHalfHour(date: Date): string {
  const d = new Date(date)
  const minutes = d.getMinutes()
  const add = minutes === 0 || minutes === 30 ? 0 : minutes < 30 ? 30 - minutes : 60 - minutes
  d.setMinutes(minutes + add, 0, 0)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Suggest a default due date from action priority. */
export function suggestDueDate(priority: InsightActionPriority, from = new Date()): string {
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  if (priority === 'immediate') return formatDateKey(base)
  if (priority === 'this_week') {
    base.setDate(base.getDate() + 2)
    return formatDateKey(base)
  }
  base.setDate(base.getDate() + 7)
  return formatDateKey(base)
}

export function suggestTimeRange(
  priority: InsightActionPriority,
  from = new Date(),
): { startTime: string; endTime: string } {
  if (priority === 'immediate') {
    const startTime = roundUpToHalfHour(from)
    return { startTime, endTime: addMinutesToTime(startTime, 60) }
  }
  if (priority === 'this_week') {
    return { startTime: '10:00', endTime: '11:00' }
  }
  return { startTime: '14:00', endTime: '15:00' }
}

/**
 * Persist a task only after the user explicitly confirms（完成）.
 * Opening the modal / editing / closing must NOT call this.
 */
export function commitInsightTask(input: InsightTaskCommitInput): InsightTask {
  const dueDate = parseDateKey(input.dueDate) ? input.dueDate : formatDateKey(new Date())
  const startTime = normalizeTime(input.startTime, '09:00')
  let endTime = normalizeTime(input.endTime, '10:00')
  if (compareTime(endTime, startTime) <= 0) {
    endTime = addMinutesToTime(startTime, 60)
  }

  const tasks = readStore()
  const now = new Date().toISOString()
  const existing = tasks.find(
    (t) =>
      t.committed &&
      !t.done &&
      t.actionId === input.actionId &&
      t.activityId === input.activityId &&
      t.dueDate === dueDate &&
      t.startTime === startTime,
  )

  if (existing) {
    const updated: InsightTask = {
      ...existing,
      title: input.title.trim() || existing.title || '未命名任务',
      description: input.description.trim(),
      priority: input.priority,
      ownerName: input.ownerName ?? existing.ownerName,
      contactName: input.contactName ?? existing.contactName,
      source: input.source || existing.source,
      dueDate,
      startTime,
      endTime,
      activityTitle: input.activityTitle,
      orgName: input.orgName,
      updatedAt: now,
      committed: true,
      done: false,
    }
    writeStore(tasks.map((t) => (t.id === existing.id ? updated : t)))
    return updated
  }

  const task: InsightTask = {
    id: `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: input.title.trim() || '未命名任务',
    description: input.description.trim(),
    priority: input.priority,
    ownerName: input.ownerName ?? null,
    contactName: input.contactName ?? null,
    source: input.source || 'activity_notes',
    dueDate,
    startTime,
    endTime,
    activityId: input.activityId,
    activityTitle: input.activityTitle,
    orgName: input.orgName,
    actionId: input.actionId,
    createdAt: now,
    updatedAt: now,
    done: false,
    committed: true,
  }
  writeStore([task, ...tasks].slice(0, 200))
  return task
}

/** @deprecated Use commitInsightTask — only persists on explicit confirm. */
export function addInsightTask(input: {
  action: InsightAction
  dueDate: string
  startTime?: string
  endTime?: string
  title?: string
  description?: string
  activityId: string
  activityTitle: string
  orgName: string
}): InsightTask {
  const times = suggestTimeRange(input.action.priority)
  return commitInsightTask({
    title: input.title ?? input.action.title,
    description: input.description ?? input.action.description ?? '',
    dueDate: input.dueDate,
    startTime: input.startTime || times.startTime,
    endTime: input.endTime || times.endTime,
    priority: input.action.priority,
    ownerName: input.action.ownerName,
    contactName: input.action.contactName,
    source: input.action.source,
    activityId: input.activityId,
    activityTitle: input.activityTitle,
    orgName: input.orgName,
    actionId: input.action.id,
  })
}

export function toggleInsightTaskDone(id: string, done?: boolean): InsightTask | null {
  const tasks = readStore()
  let updated: InsightTask | null = null
  const next = tasks.map((t) => {
    if (t.id !== id) return t
    updated = { ...t, done: done ?? !t.done, updatedAt: new Date().toISOString() }
    return updated
  })
  if (!updated) return null
  writeStore(next)
  return updated
}

export function listInsightTasksForDate(dueDate: string): InsightTask[] {
  return readStore()
    .filter((t) => t.committed && t.dueDate === dueDate)
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        compareTime(a.startTime, b.startTime) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
}

export function listInsightTaskDaysInMonth(year: number, month: number): Set<number> {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
  const days = new Set<number>()
  for (const t of readStore()) {
    if (!t.committed || t.done) continue
    if (!t.dueDate.startsWith(prefix)) continue
    const day = Number(t.dueDate.slice(-2))
    if (day >= 1 && day <= 31) days.add(day)
  }
  return days
}
