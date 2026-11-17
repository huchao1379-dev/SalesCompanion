import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { DraftPayload } from '../agents/types'
import {
  IconBrief,
  IconCheck,
  IconEdit,
  IconEye,
  IconPaperclip,
  IconPlus,
  IconSendUp,
} from '../components/DashIcons'
import type { AgendaItem } from '../data/agenda'
import { AccountInsight } from '../screens/AccountInsight'
import { ActivityCapture } from '../screens/ActivityCapture'
import { ActivityDetails } from '../screens/ActivityDetails'
import { BriefMe } from '../screens/BriefMe'
import { CopilotChat } from '../screens/CopilotChat'
import { HomeDashboard } from '../screens/HomeDashboard'
import { OpportunityDraftScreen } from '../screens/OpportunityDraft'
import { TasksHub } from '../screens/TasksHub'
import { ensureVoices, unlockSpeech } from '../speech/tts'
import { useBrowserBottomInset } from './useBrowserBottomInset'

export type ScreenId =
  | 'home'
  | 'capture'
  | 'chat'
  | 'opportunity'
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
  const [insightsOpen, setInsightsOpen] = useState(true)
  const [copilotDraft, setCopilotDraft] = useState('')
  const [chatSeed, setChatSeed] = useState('')
  const [chatKey, setChatKey] = useState(0)
  const [activityItem, setActivityItem] = useState<AgendaItem | null>(null)

  function goScreen(next: ScreenId) {
    setScreen(next)
    if (next !== 'home') setInsightsOpen(false)
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

  function submitCopilot() {
    openChat(copilotDraft.trim())
  }

  function onCopilotKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitCopilot()
    }
  }

  function onCopilotSubmit(e: FormEvent) {
    e.preventDefault()
    submitCopilot()
  }

  const onBoard = screen === 'home'
  const showDock = !(onBoard && insightsOpen) && screen !== 'chat'

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
    <div className={`app-shell${onBoard ? ' app-shell--board' : ''}${showDock ? ' has-dock' : ''}`}>
      {onBoard ? (
        <HomeDashboard
          dimmed={insightsOpen}
          onOpenBrief={() => {
            unlockSpeech()
            setInsightsOpen(true)
          }}
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
            screen === 'activity' || screen === 'chat' ? ' app-shell__main--flush' : ''
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
            <>
              <div className="app-shell__top">
                <button type="button" className="linkish" onClick={() => goScreen('home')}>
                  ← Back
                </button>
              </div>
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
            </>
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
            <>
              <div className="app-shell__top">
                <button type="button" className="linkish" onClick={() => goScreen('home')}>
                  ← Back
                </button>
              </div>
              <OpportunityDraftScreen seedDrafts={seedDrafts} />
            </>
          ) : null}
          {screen === 'account' ? (
            <AccountInsight
              accountKey={accountKey}
              onBack={() => goScreen(activityItem ? 'activity' : 'chat')}
              onCapture={() => goScreen('capture')}
            />
          ) : null}
          {screen === 'activity' && activityItem ? (
            <ActivityDetails
              item={activityItem}
              dateLabel={activityDateLabel}
              onBack={() => goScreen('home')}
            />
          ) : null}
        </main>
      )}

      {onBoard ? <BriefMe open={insightsOpen} onClose={() => setInsightsOpen(false)} /> : null}

      {showDock ? (
        <div
          className={`copilot-dock${screen === 'activity' ? ' copilot-dock--activity' : ''}`}
          aria-label="Copilot 快捷栏"
        >
          {screen === 'activity' ? (
            <div className="copilot-dock__float-actions">
              <button type="button" className="activity-action-btn">
                <IconCheck /> Complete
              </button>
              <button type="button" className="activity-action-btn">
                <IconEdit /> Edit
              </button>
            </div>
          ) : (
            <div className="copilot-dock__actions">
              <button type="button" className="copilot-chip" onClick={() => goScreen('capture')}>
                <IconPlus />
                New Visit
              </button>
              <button type="button" className="copilot-chip" onClick={() => goScreen('opportunity')}>
                <IconEye />
                View Opps
              </button>
              <button
                type="button"
                className="copilot-chip"
                onClick={() => {
                  unlockSpeech()
                  goScreen('home')
                  setInsightsOpen(true)
                }}
              >
                <IconBrief />
                Brief Me
              </button>
            </div>
          )}

          <form className="copilot-dock__composer" onSubmit={onCopilotSubmit}>
            <button type="button" className="copilot-dock__attach" aria-label="添加附件">
              <IconPaperclip />
            </button>
            <input
              value={copilotDraft}
              onChange={(e) => setCopilotDraft(e.target.value)}
              onFocus={() => openChat(copilotDraft)}
              onPointerUp={() => openChat(copilotDraft)}
              onKeyDown={onCopilotKeyDown}
              placeholder="Ask Copilot..."
              aria-label="Ask Copilot"
              readOnly
              inputMode="none"
            />
            <button type="submit" className="copilot-dock__send" aria-label="打开对话">
              <IconSendUp />
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
