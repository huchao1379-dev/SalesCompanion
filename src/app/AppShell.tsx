import { useState } from 'react'
import type { DraftPayload } from '../agents/types'
import { ActivityCapture } from '../screens/ActivityCapture'
import { BriefMe } from '../screens/BriefMe'
import { CopilotChat } from '../screens/CopilotChat'
import { HomeDashboard } from '../screens/HomeDashboard'
import { OpportunityDraftScreen } from '../screens/OpportunityDraft'

export type TabId = 'board' | 'chat' | 'tasks'
export type ScreenId = 'home' | 'brief' | 'capture' | 'chat' | 'opportunity'

const TAB_TO_DEFAULT: Record<TabId, ScreenId> = {
  board: 'home',
  chat: 'chat',
  tasks: 'capture',
}

export function AppShell() {
  const [tab, setTab] = useState<TabId>('board')
  const [screen, setScreen] = useState<ScreenId>('home')
  const [seedDrafts, setSeedDrafts] = useState<DraftPayload[]>([])

  function goTab(next: TabId) {
    setTab(next)
    setScreen(TAB_TO_DEFAULT[next])
  }

  function goScreen(next: ScreenId) {
    setScreen(next)
    if (next === 'chat') setTab('chat')
    else if (next === 'capture' || next === 'opportunity') setTab('tasks')
    else setTab('board')
  }

  const showBack = screen === 'brief' || screen === 'opportunity'

  return (
    <div className="app-shell">
      {showBack ? (
        <div className="app-shell__top">
          <button type="button" className="linkish" onClick={() => goScreen('home')}>
            ← 返回大盘
          </button>
        </div>
      ) : null}

      <main className="app-shell__main">
        {screen === 'home' ? (
          <HomeDashboard
            onOpenBrief={() => goScreen('brief')}
            onOpenCapture={() => goScreen('capture')}
            onOpenChat={() => goScreen('chat')}
          />
        ) : null}
        {screen === 'brief' ? (
          <BriefMe
            onAddToToday={() => goScreen('capture')}
            onOpenChat={() => goScreen('chat')}
          />
        ) : null}
        {screen === 'capture' ? (
          <ActivityCapture
            onDraftsCommitted={(drafts) => {
              setSeedDrafts(drafts)
            }}
            onOpenOpportunity={() => goScreen('opportunity')}
          />
        ) : null}
        {screen === 'chat' ? <CopilotChat /> : null}
        {screen === 'opportunity' ? <OpportunityDraftScreen seedDrafts={seedDrafts} /> : null}
      </main>

      {screen === 'capture' || screen === 'home' ? (
        <div className="app-shell__quick">
          <button type="button" className="linkish" onClick={() => goScreen('opportunity')}>
            查看商机草稿 →
          </button>
        </div>
      ) : null}

      <nav className="tab-bar" aria-label="主导航">
        <button
          type="button"
          className={tab === 'board' ? 'tab-bar__item is-active' : 'tab-bar__item'}
          onClick={() => goTab('board')}
        >
          看板
        </button>
        <button
          type="button"
          className={tab === 'chat' ? 'tab-bar__item is-active' : 'tab-bar__item'}
          onClick={() => goTab('chat')}
        >
          对话
        </button>
        <button
          type="button"
          className={tab === 'tasks' ? 'tab-bar__item is-active' : 'tab-bar__item'}
          onClick={() => goTab('tasks')}
        >
          任务
        </button>
      </nav>
    </div>
  )
}
