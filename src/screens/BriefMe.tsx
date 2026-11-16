import { useState } from 'react'

type Props = {
  onAddToToday: () => void
  onOpenChat: () => void
}

const CHAPTERS = [
  {
    title: '今日重点',
    summary: '指标分析 Agent + 客户画像 Agent：今天重点在 Alpha 演示跟进与 Gamma RFP 准备。',
    points: [
      '09:00 Hospital Alpha — 关注 A3 演示反馈',
      '14:00 Hospital Gamma — 昨日 RFP 要点已摘要到拜访卡',
      '进行中商机 2 个信心度下降，建议会前核对',
    ],
    metrics: ['拜访 4', '风险 2', '延期工单 1'],
  },
  {
    title: '风险商机',
    summary: '商机评估 Agent：两单信心度环比下降，建议今天确认采购窗口。',
    points: [
      'Hospital Beta · N17 — Identify → 建议 Qualify',
      'Hospital Delta · 麻醉机 — 报价过期 5 天',
    ],
    metrics: ['风险 2', '待跟进 3'],
  },
]

const SPEEDS = [1, 1.5, 2] as const

export function BriefMe({ onAddToToday, onOpenChat }: Props) {
  const [chapter, setChapter] = useState(0)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [playing, setPlaying] = useState(false)
  const current = CHAPTERS[chapter]

  return (
    <section className="screen brief">
      <header>
        <p className="home__eyebrow">Brief Me</p>
        <h1>今日播报</h1>
        <p className="muted">短按播放 · 长按进入对话（橙麦）。</p>
      </header>

      <article className="brief-card">
        <p className="brief-card__chapter">{current.title}</p>
        <p className="brief-card__summary">{current.summary}</p>
        <ul>
          {current.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="brief-card__metrics">
          {current.metrics.map((m) => (
            <span key={m} className="metric-chip">
              {m}
            </span>
          ))}
        </div>
        <button type="button" className="btn btn--primary" onClick={onAddToToday}>
          加入今日任务
        </button>
      </article>

      <div className="brief-controls">
        <div className="brief-dots" role="tablist" aria-label="播报章节">
          {CHAPTERS.map((c, i) => (
            <button
              key={c.title}
              type="button"
              role="tab"
              aria-selected={i === chapter}
              className={i === chapter ? 'brief-dot is-active' : 'brief-dot'}
              onClick={() => setChapter(i)}
            />
          ))}
        </div>
        <div className="brief-speeds">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={speed === s ? 'chip-btn is-active' : 'chip-btn'}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="brief-play">
        <button
          type="button"
          className="btn btn--accent"
          onClick={() => setPlaying((v) => !v)}
        >
          {playing ? `暂停播报 (${speed}×)` : `短按播放 (${speed}×)`}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onOpenChat}>
          长按 · 进入对话
        </button>
      </div>
    </section>
  )
}
