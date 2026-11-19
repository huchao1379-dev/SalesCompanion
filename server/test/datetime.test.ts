import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  normalizeIsoDate,
  nowIsoInZone,
  parseChineseRelativeDate,
  todayIsoDate,
  zonedParts,
} from '../src/util/datetime.js'

const NOW = new Date('2026-11-19T10:00:00+08:00')

test('Asia/Shanghai parts are stable regardless of process timezone', () => {
  const parts = zonedParts(NOW)
  assert.equal(parts.year, 2026)
  assert.equal(parts.month, 11)
  assert.equal(parts.day, 19)
  assert.equal(parts.weekdayIndex, 3) // Thursday, Monday=0
  assert.equal(todayIsoDate(NOW), '2026-11-19')
  assert.equal(nowIsoInZone(NOW), '2026-11-19T10:00:00+08:00')
})

test('relative Chinese dates resolve from the injected now', () => {
  assert.equal(parseChineseRelativeDate('下周三再约', NOW)?.date, '2026-11-25')
  assert.equal(parseChineseRelativeDate('下下周三', NOW)?.date, '2026-12-02')
  assert.equal(parseChineseRelativeDate('本周五', NOW)?.date, '2026-11-20')
  assert.equal(parseChineseRelativeDate('明天下午', NOW)?.date, '2026-11-20')
  assert.equal(parseChineseRelativeDate('月底', NOW)?.date, '2026-11-30')
  assert.equal(parseChineseRelativeDate('下个月初', NOW)?.date, '2026-12-01')
  assert.equal(parseChineseRelativeDate('2027年3月31日', NOW)?.date, '2027-03-31')
  assert.equal(parseChineseRelativeDate('一直没有时间', NOW), undefined)
})

test('normalizeIsoDate accepts ISO, slash, Chinese and relative input', () => {
  assert.equal(normalizeIsoDate('2026-11-25', NOW), '2026-11-25')
  assert.equal(normalizeIsoDate('2026/11/25', NOW), '2026-11-25')
  assert.equal(normalizeIsoDate('2026年11月25日', NOW), '2026-11-25')
  assert.equal(normalizeIsoDate('下周三', NOW), '2026-11-25')
  assert.equal(normalizeIsoDate('not-a-date', NOW), undefined)
})
