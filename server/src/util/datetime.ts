/**
 * Demo timezone helpers. The product is used in China, so relative dates are
 * resolved in Asia/Shanghai regardless of the server's process timezone.
 */
const TIME_ZONE = 'Asia/Shanghai'
const OFFSET = '+08:00'

export type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** Monday = 0 ... Sunday = 6 */
  weekdayIndex: number
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function weekdayIndex(year: number, month: number, day: number) {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

export function zonedParts(date = new Date()): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0)
  const year = get('year')
  const month = get('month')
  const day = get('day')
  return {
    year,
    month,
    day,
    hour: get('hour'),
    minute: get('minute'),
    weekdayIndex: weekdayIndex(year, month, day),
  }
}

export function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`
}

export function addDays(year: number, month: number, day: number, days: number) {
  const d = new Date(Date.UTC(year, month - 1, day + days))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

export function zonedIsoDateTime(date: string, hour = 9, minute = 0) {
  return `${date}T${pad(hour)}:${pad(minute)}:00${OFFSET}`
}

export function nowIsoInZone(date = new Date()) {
  const p = zonedParts(date)
  return `${toIsoDate(p.year, p.month, p.day)}T${pad(p.hour)}:${pad(p.minute)}:00${OFFSET}`
}

export function todayIsoDate(date = new Date()) {
  const p = zonedParts(date)
  return toIsoDate(p.year, p.month, p.day)
}

/** Convert any valid ISO timestamp to the Asia/Shanghai calendar date. */
export function isoDateInZone(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return todayIsoDate(date)
}

export type ParsedRelativeDate = {
  /** YYYY-MM-DD in Asia/Shanghai */
  date: string
  /** The matched phrase, useful for audit/summary. */
  source: string
}

const WEEKDAY_MAP: Record<string, number> = {
  一: 0,
  二: 1,
  三: 2,
  四: 3,
  五: 4,
  六: 5,
  日: 6,
  天: 6,
}

function matchWeekday(char: string | undefined) {
  return char && char in WEEKDAY_MAP ? WEEKDAY_MAP[char] : undefined
}

/**
 * Parse common Chinese relative-date phrases used in sales utterances.
 * Returns a date-only string; time-of-day is intentionally not guessed.
 */
export function parseChineseRelativeDate(
  text: string,
  now = new Date(),
): ParsedRelativeDate | undefined {
  const source = text.trim().replace(/\s+/g, ' ')
  if (!source) return undefined
  const p = zonedParts(now)

  const iso = source.match(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/)
  if (iso) {
    const date = toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    return { date, source: iso[0] }
  }

  const monthDay = source.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  if (monthDay) {
    const date = toIsoDate(p.year, Number(monthDay[1]), Number(monthDay[2]))
    return { date, source: monthDay[0] }
  }

  const nextNextWeek = source.match(/下下(?:个)?周([一二三四五六日天])/)
  if (nextNextWeek) {
    const target = matchWeekday(nextNextWeek[1])
    if (target !== undefined) {
      const nextMonday = ((7 - p.weekdayIndex) % 7) || 7
      const d = addDays(p.year, p.month, p.day, nextMonday + 7 + target)
      return { date: toIsoDate(d.year, d.month, d.day), source: nextNextWeek[0] }
    }
  }

  const nextWeek = source.match(/下(?:个)?周([一二三四五六日天])/)
  if (nextWeek) {
    const target = matchWeekday(nextWeek[1])
    if (target !== undefined) {
      const nextMonday = ((7 - p.weekdayIndex) % 7) || 7
      const d = addDays(p.year, p.month, p.day, nextMonday + target)
      return { date: toIsoDate(d.year, d.month, d.day), source: nextWeek[0] }
    }
  }

  const thisWeek = source.match(/(?:本|这)(?:个)?周([一二三四五六日天])/)
  if (thisWeek) {
    const target = matchWeekday(thisWeek[1])
    if (target !== undefined) {
      const d = addDays(p.year, p.month, p.day, -p.weekdayIndex + target)
      return { date: toIsoDate(d.year, d.month, d.day), source: thisWeek[0] }
    }
  }

  const plainWeek = source.match(/(?:周|星期)([一二三四五六日天])/)
  if (plainWeek) {
    const target = matchWeekday(plainWeek[1])
    if (target !== undefined) {
      const delta = (target - p.weekdayIndex + 7) % 7
      const d = addDays(p.year, p.month, p.day, delta)
      return { date: toIsoDate(d.year, d.month, d.day), source: plainWeek[0] }
    }
  }

  if (/大后天/.test(source)) {
    const d = addDays(p.year, p.month, p.day, 3)
    return { date: toIsoDate(d.year, d.month, d.day), source: '大后天' }
  }
  if (/后天/.test(source)) {
    const d = addDays(p.year, p.month, p.day, 2)
    return { date: toIsoDate(d.year, d.month, d.day), source: '后天' }
  }
  if (/明天|明日/.test(source)) {
    const d = addDays(p.year, p.month, p.day, 1)
    return { date: toIsoDate(d.year, d.month, d.day), source: '明天' }
  }
  if (/今天|今日/.test(source)) {
    return { date: toIsoDate(p.year, p.month, p.day), source: '今天' }
  }

  if (/月底|月末/.test(source)) {
    const last = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate()
    return { date: toIsoDate(p.year, p.month, last), source: '月底' }
  }
  if (/下(?:个)?月初/.test(source)) {
    const d = new Date(Date.UTC(p.year, p.month, 1))
    return {
      date: toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
      source: '下个月初',
    }
  }

  return undefined
}

/** Accept YYYY-MM-DD / YYYY/MM/DD / ISO datetime / Chinese relative phrases. */
export function normalizeIsoDate(
  value: unknown,
  now = new Date(),
): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return undefined

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const date = toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    return isValidYmd(Number(iso[1]), Number(iso[2]), Number(iso[3])) ? date : undefined
  }
  const slash = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/)
  if (slash) {
    const y = Number(slash[1])
    const m = Number(slash[2])
    const d = Number(slash[3])
    return isValidYmd(y, m, d) ? toIsoDate(y, m, d) : undefined
  }
  return parseChineseRelativeDate(text, now)?.date
}

export function normalizeIsoDateTime(
  value: unknown,
  now = new Date(),
): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return undefined
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime()) && /[T ]\d{1,2}:\d{2}/.test(text)) {
    return text.includes('T') || text.includes('+') || text.endsWith('Z')
      ? parsed.toISOString()
      : `${text.replace(' ', 'T')}${OFFSET}`
  }
  const date = normalizeIsoDate(text, now)
  return date ? zonedIsoDateTime(date) : undefined
}

export function isValidYmd(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

export function isPastDate(date: string, now = new Date()) {
  return date < todayIsoDate(now)
}

export { TIME_ZONE, OFFSET }
