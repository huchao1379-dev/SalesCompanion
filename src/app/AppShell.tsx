import { useEffect, useMemo, useState } from 'react'
import type { DraftPayload, OpportunityDraftPayload } from '../agents/types'
import { CopilotDock } from '../components/CopilotDock'
import type { AgendaItem } from '../data/agenda'
import { AccountInsight } from '../screens/AccountInsight/AccountInsight'
import { ActivityCapture } from '../screens/ActivityCapture/ActivityCapture'
import { ActivityDetails } from '../screens/ActivityDetails/ActivityDetails'
import { BriefMe } from '../screens/BriefMe/BriefMe'
import { CopilotChat } from '../screens/CopilotChat/CopilotChat'
import { HomeDashboard } from '../screens/HomeDashboard/HomeDashboard'
import { OpportunityDetailScreen } from '../screens/OpportunityDetail/OpportunityDetail'
import { OpportunityDraftScreen } from '../screens/OpportunityDraft/OpportunityDraft'
import { TasksHub } from '../screens/TasksHub/TasksHub'
import { ensureVoices, unlockSpeech } from '../speech/tts'
import { useBrowserBottomInset } from './useBrowserBottomInset'

export type ScreenId =
  | 'home'
  | 'capture'
  | 'chat'
  | 'opportunity'
  | 'opportunity-detail'
  | 'tasks'
  | 'account'
  | 'activity'

export function AppShell() {
  useBrowserBottomInset()

  useEffect(() => {
    // Prime Android Chrome's lazy voice list early.
    void ensureVoices()
  }, [])

  const [screen, setScreen] = useState<ScreenId>('home')
  const [seedDrafts, setSeedDrafts] = useState<DraftPayload[]>([])
  const [accountKey, setAccountKey] = useState<string>('SAP-ACC-RENJI')
  const [opportunityId, setOpportunityId] = useState<string | null>(null)
  const [insightsOpen, setInsightsOpen] = useState(true)
  const [briefPlayRequestId, setBriefPlayRequestId] = useState(0)
  const [copilotDraft, setCopilotDraft] = useState('')
  const [chatSeed, setChatSeed] = useState('')
  const [chatKey, setChatKey] = useState(0)
  const [activityItem, setActivityItem] = useState<AgendaItem | null>(null)

  function goScreen(next: ScreenId) {
    setScreen(next)
    if (next !== 'home') setInsightsOpen(false)
  }

  function openOpportunityDetail(id: string) {
    setOpportunityId(id)
    goScreen('opportunity-detail')
  }

  function openDraft(draft: DraftPayload) {
    setSeedDrafts([draft])
    goScreen(draft.kind === 'opportunity' ? 'opportunity' : 'capture')
  }

  function openActivity(item: AgendaItem) {
    setActivityItem(item)
    goScreen('activity')
  }

  function openChat(seed = '') {
    setChatSeed(seed)
    setChatKey((k) => k + 1)
    setCopilotDraft('')
    goScreen('chat')
  }

  function openBrief() {
    // Must unlock TTS inside the tap so BriefMe autoplay works on mobile.
    unlockSpeech()
    goScreen('home')
    setInsightsOpen(true)
    setBriefPlayRequestId((n) => n + 1)
  }

  const onBoard = screen === 'home'
  const showDock =
    !(onBoard && insightsOpen) &&
    screen !== 'chat' &&
    screen !== 'opportunity-detail' &&
    screen !== 'capture'

  const dockMode =
    screen === 'activity' ? 'activity' : screen === 'capture' || screen === 'opportunity' ? 'compact' : 'default'

  const activityDateLabel = useMemo(() => {
    if (!activityItem) return ''
    const base = new Date()
    const d = new Date(base.getFullYear(), base.getMonth(), activityItem.day)
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }, [activityItem])

  return (
    <div
      className={`app-shell${onBoard ? ' app-shell--board' : ''}${showDock ? ' has-dock' : ''}${
        showDock && screen === 'opportunity' ? ' has-dock--compact' : ''
      }${showDock && screen === 'activity' ? ' has-dock--activity' : ''}${
        screen === 'opportunity-detail' ? ' has-opp-detail' : ''
      }`}
    >
      {onBoard ? (
        <HomeDashboard
          dimmed={insightsOpen}
          onOpenBrief={openBrief}
          onOpenCapture={() => goScreen('capture')}
          onOpenChat={() => openChat()}
          onOpenTasks={() => goScreen('tasks')}
          onOpenOpportunity={() => goScreen('opportunity')}
          onOpenAccount={() => {
            setAccountKey('SAP-ACC-RENJI')
            goScreen('account')
          }}
          onOpenActivity={openActivity}
        />
      ) : (
        <main
          className={`app-shell__main${
            screen === 'activity' ||
            screen === 'chat' ||
            screen === 'capture' ||
            screen === 'opportunity' ||
            screen === 'opportunity-detail' ||
            screen === 'account'
              ? ' app-shell__main--flush'
              : ''
          }`}
        >
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
              onBack={() => goScreen('home')}
              onAccountChange={setAccountKey}
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
              key={chatKey}
              initialPrompt={chatSeed}
              onBack={() => {
                setChatSeed('')
                goScreen('home')
              }}
              onOpenAccount={(key) => {
                setAccountKey(key)
                goScreen('account')
              }}
              onOpenOpportunity={() => goScreen('opportunity')}
              onOpenTasks={() => goScreen('tasks')}
            />
          ) : null}
          {screen === 'opportunity' ? (
            <OpportunityDraftScreen
              seedDrafts={seedDrafts}
              onBack={() => goScreen('home')}
              onOpenCapture={() => goScreen('capture')}
              onOpenDetail={openOpportunityDetail}
            />
          ) : null}
          {screen === 'opportunity-detail' && opportunityId ? (
            <OpportunityDetailScreen
              key={opportunityId}
              opportunityId={opportunityId}
              seedDrafts={seedDrafts.filter(
                (d): d is OpportunityDraftPayload => d.kind === 'opportunity',
              )}
              onBack={() => goScreen('opportunity')}
              onOpenCapture={(key) => {
                if (key) setAccountKey(key)
                goScreen('capture')
              }}
              onOpenAccount={(key) => {
                setAccountKey(key)
                goScreen('account')
              }}
            />
          ) : null}
          {screen === 'account' ? (
            <AccountInsight
              key={accountKey}
              accountKey={accountKey}
              onBack={() =>
                goScreen(opportunityId ? 'opportunity-detail' : activityItem ? 'activity' : 'chat')
              }
              onCapture={() => goScreen('capture')}
              onOpenOpportunity={(id) => {
                if (id) openOpportunityDetail(id)
                else goScreen('opportunity')
              }}
            />
          ) : null}
          {screen === 'activity' && activityItem ? (
            <ActivityDetails
              item={activityItem}
              dateLabel={activityDateLabel}
              onBack={() => goScreen('home')}
              onAskCopilot={(prompt) => openChat(prompt)}
            />
          ) : null}
        </main>
      )}

      {onBoard ? (
        <BriefMe
          open={insightsOpen}
          playRequestId={briefPlayRequestId}
          onClose={() => setInsightsOpen(false)}
        />
      ) : null}

      {showDock ? (
        <CopilotDock
          mode={dockMode}
          draft={copilotDraft}
          onDraftChange={setCopilotDraft}
          onOpenCapture={() => goScreen('capture')}
          onOpenOpportunity={() => goScreen('opportunity')}
          onOpenBrief={openBrief}
          onOpenChat={openChat}
        />
      ) : null}
    </div>
  )
}
