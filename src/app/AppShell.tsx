import { useState } from 'react'
import type { DraftPayload } from '../agents/types'
import { AccountInsight } from '../screens/AccountInsight'
import { ActivityCapture } from '../screens/ActivityCapture'
import { BriefMe } from '../screens/BriefMe'
import { CopilotChat } from '../screens/CopilotChat'
import { HomeDashboard } from '../screens/HomeDashboard'
import { OpportunityDraftScreen } from '../screens/OpportunityDraft'
import { TasksHub } from '../screens/TasksHub'

export type TabId = 'board' | 'chat' | 'tasks'
export type ScreenId =
  | 'home'
  | 'capture'
  | 'chat'
  | 'opportunity'
  | 'tasks'
  | 'account'

const TAB_TO_DEFAULT: Record<TabId, ScreenId> = {
  board: 'home',
  chat: 'chat',
  tasks: 'tasks',
}

export function AppShell() {
  const [tab, setTab] = useState<TabId>('board')
  const [screen, setScreen] = useState<ScreenId>('home')
  const [seedDrafts, setSeedDrafts] = useState<DraftPayload[]>([])
  const [accountKey, setAccountKey] = useState<string>('SAP-ACC-RENJI')
  const [insightsOpen, setInsightsOpen] = useState(true)

  function goTab(next: TabId) {
    setTab(next)
    setScreen(TAB_TO_DEFAULT[next])
    if (next !== 'board') setInsightsOpen(false)
  }

  function goScreen(next: ScreenId) {
    setScreen(next)
    if (next === 'chat') setTab('chat')
    else if (next === 'capture' || next === 'opportunity' || next === 'tasks') setTab('tasks')
    else setTab('board')
    if (next !== 'home') setInsightsOpen(false)
  }

  function openDraft(draft: DraftPayload) {
    setSeedDrafts([draft])
    goScreen(draft.kind === 'opportunity' ? 'opportunity' : 'capture')
  }

  const onBoard = screen === 'home'
  const showBack = screen === 'opportunity' || screen === 'account' || screen === 'capture'
  const showTabs = !(onBoard && insightsOpen)

  return (
    <div className={`app-shell${onBoard ? ' app-shell--board' : ''}`}>
      {onBoard ? (
        <HomeDashboard
          dimmed={insightsOpen}
          onOpenBrief={() => setInsightsOpen(true)}
          onOpenCapture={() => goScreen('capture')}
          onOpenChat={() => goScreen('chat')}
          onOpenTasks={() => goScreen('tasks')}
          onOpenAccount={() => {
            setAccountKey('SAP-ACC-RENJI')
            goScreen('account')
          }}
        />
      ) : (
        <>
          {showBack ? (
            <div className="app-shell__top">
              <button
                type="button"
                className="linkish"
                onClick={() => goScreen(screen === 'capture' ? 'tasks' : 'home')}
              >
                ← Back
              </button>
            </div>
          ) : null}

          <main className="app-shell__main">
            {screen === 'tasks' ? (
              <TasksHub
                onOpenCapture={() => goScreen('capture')}
                onOpenOpportunity={() => goScreen('opportunity')}
                onOpenDraft={openDraft}
              />
            ) : null}
            {screen === 'capture' ? (
              <ActivityCapture
                key={
                  seedDrafts
                    .filter((d) => d.kind === 'activity')
                    .map((d) => d.idempotencyKey)
                    .join('|') || 'capture-new'
                }
                initialDrafts={seedDrafts.filter((d) => d.kind === 'activity')}
                accountKey={accountKey}
                onDraftsCommitted={(drafts) => {
                  setSeedDrafts(drafts)
                  const ref = drafts.find((d) => d.accountRef)?.accountRef
                  if (ref) setAccountKey(ref)
                }}
                onOpenOpportunity={() => goScreen('opportunity')}
              />
            ) : null}
            {screen === 'chat' ? (
              <CopilotChat
                onOpenAccount={(key) => {
                  setAccountKey(key)
                  goScreen('account')
                }}
                onOpenOpportunity={() => goScreen('opportunity')}
              />
            ) : null}
            {screen === 'opportunity' ? <OpportunityDraftScreen seedDrafts={seedDrafts} /> : null}
            {screen === 'account' ? (
              <AccountInsight
                accountKey={accountKey}
                onBack={() => goScreen('chat')}
                onCapture={() => goScreen('capture')}
              />
            ) : null}
          </main>
        </>
      )}

      {onBoard ? <BriefMe open={insightsOpen} onClose={() => setInsightsOpen(false)} /> : null}

      {showTabs ? (
        <nav className="tab-bar" aria-label="主导航">
          <button
            type="button"
            className={tab === 'board' ? 'tab-bar__item is-active' : 'tab-bar__item'}
            onClick={() => {
              goTab('board')
              setInsightsOpen(false)
            }}
          >
            Board
          </button>
          <button
            type="button"
            className={tab === 'chat' ? 'tab-bar__item is-active' : 'tab-bar__item'}
            onClick={() => goTab('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            className={tab === 'tasks' ? 'tab-bar__item is-active' : 'tab-bar__item'}
            onClick={() => goTab('tasks')}
          >
            Tasks
          </button>
        </nav>
      ) : null}
    </div>
  )
}
