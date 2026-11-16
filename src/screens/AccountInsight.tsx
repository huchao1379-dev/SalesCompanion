import { useEffect, useState } from 'react'
import type { AccountProfile } from '../agents/types'
import { AgentLabel } from '../components/AgentLabel'
import { SourceChips } from '../components/SourceChips'
import { fetchAccountInsight, getAccountInsight, listMockAccounts } from '../data/accounts'

type Props = {
  accountKey?: string
  onBack: () => void
  onCapture: () => void
}

export function AccountInsight({ accountKey, onBack, onCapture }: Props) {
  const [account, setAccount] = useState<AccountProfile | null>(() =>
    accountKey ? getAccountInsight(accountKey) : listMockAccounts()[0],
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!accountKey) {
        setAccount(listMockAccounts()[0])
        return
      }
      setLoading(true)
      const remote = await fetchAccountInsight(accountKey)
      if (!cancelled) {
        setAccount(remote)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accountKey])

  if (!account) {
    return (
      <section className="screen">
        <p className="muted">{loading ? '加载客户画像…' : '未找到客户画像。'}</p>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          返回
        </button>
      </section>
    )
  }

  return (
    <section className="screen account">
      <header>
        <p className="home__eyebrow">客户画像</p>
        <h1>{account.accountName}</h1>
        <p className="muted">
          最近 30 天 {account.visitCount30d} 次拜访
          {account.npsDelta ? ` · NPS ${account.npsDelta}` : ''}
          {account.lastContactAt ? ` · 上次接触 ${account.lastContactAt}` : ''}
        </p>
      </header>

      <article className="brief-card">
        <AgentLabel name="客户画像 Agent" />
        <p>{account.summary}</p>
        <div className="brief-card__metrics">
          <span className="metric-chip">信用 {account.creditRating}</span>
          <span className="metric-chip">拜访 {account.visitCount30d}</span>
          <span className="metric-chip">开放商机 {account.openOpportunities.length}</span>
        </div>
        <SourceChips sources={account.sources} />
      </article>

      <div className="draft-list">
        {account.openOpportunities.map((opp) => (
          <article key={opp.name} className="draft-card">
            <header className="draft-card__header">
              <AgentLabel name="商机评估 Agent" />
              <span className="confidence">信心度 {(opp.confidence * 100).toFixed(0)}%</span>
            </header>
            <p>
              <strong>{opp.name}</strong>
            </p>
            <p className="muted">
              {opp.productLine} · 阶段 {opp.stage}
            </p>
          </article>
        ))}
      </div>

      <div className="home__actions">
        <button type="button" className="btn btn--accent" onClick={onCapture}>
          为此客户录入拜访
        </button>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          返回
        </button>
      </div>
    </section>
  )
}
