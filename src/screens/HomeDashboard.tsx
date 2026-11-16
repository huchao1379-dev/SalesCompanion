type Props = {
  userName?: string
  onOpenBrief: () => void
  onOpenCapture: () => void
  onOpenChat: () => void
}

const KPIS = [
  { label: '今日拜访', value: '4' },
  { label: '风险商机', value: '2' },
  { label: '待同步', value: '1' },
  { label: '草稿采纳', value: '86%' },
]

export function HomeDashboard({
  userName = 'Maria',
  onOpenBrief,
  onOpenCapture,
  onOpenChat,
}: Props) {
  return (
    <section className="screen home">
      <header className="home__hero">
        <p className="home__eyebrow">SalesCompanion</p>
        <h1>你好，{userName}</h1>
        <p className="home__summary">
          今日 4 个拜访 · 2 个进行中商机需关注 · 指标分析 Agent 已准备好播报。
        </p>
      </header>

      <div className="kpi-grid">
        {KPIS.map((k) => (
          <div key={k.label} className="kpi-card">
            <span className="kpi-card__value">{k.value}</span>
            <span className="kpi-card__label">{k.label}</span>
          </div>
        ))}
      </div>

      <div className="home__actions">
        <button type="button" className="btn btn--primary" onClick={onOpenBrief}>
          今日播报
        </button>
        <button type="button" className="btn btn--accent" onClick={onOpenCapture}>
          新拜访录入
        </button>
        <button type="button" className="btn btn--ghost" onClick={onOpenChat}>
          打开对话
        </button>
      </div>

      <button type="button" className="home__mic-hint" onClick={onOpenCapture}>
        <span className="home__mic-orb" aria-hidden>
          🎙
        </span>
        <span>常驻橙麦在任务页 · 点此开始拜访录入</span>
      </button>
    </section>
  )
}
