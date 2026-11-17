import type { FormEvent, KeyboardEvent } from 'react'
import {
  IconBrief,
  IconCheck,
  IconEdit,
  IconEye,
  IconPaperclip,
  IconPlus,
  IconSendUp,
} from './DashIcons'
import './CopilotDock.css'

export type CopilotDockMode = 'default' | 'activity' | 'compact'

type Props = {
  mode?: CopilotDockMode
  draft: string
  onDraftChange: (value: string) => void
  onOpenCapture: () => void
  onOpenOpportunity: () => void
  onOpenBrief: () => void
  onOpenChat: (seed?: string) => void
}

export function CopilotDock({
  mode = 'default',
  draft,
  onDraftChange,
  onOpenCapture,
  onOpenOpportunity,
  onOpenBrief,
  onOpenChat,
}: Props) {
  function submit() {
    onOpenChat(draft.trim())
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  const rootClass = [
    'copilot-dock',
    mode === 'activity' ? 'copilot-dock--activity' : '',
    mode === 'compact' ? 'copilot-dock--compact' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClass} aria-label="快捷栏">
      {mode === 'activity' ? (
        <div className="copilot-dock__float-actions">
          <button type="button" className="activity-action-btn">
            <IconCheck /> 完成
          </button>
          <button type="button" className="activity-action-btn">
            <IconEdit /> 编辑
          </button>
        </div>
      ) : mode === 'compact' ? null : (
        <div className="copilot-dock__actions">
          <button type="button" className="copilot-chip" onClick={onOpenCapture}>
            <IconPlus />
            新建拜访
          </button>
          <button type="button" className="copilot-chip" onClick={onOpenOpportunity}>
            <IconEye />
            查看商机
          </button>
          <button type="button" className="copilot-chip" onClick={onOpenBrief}>
            <IconBrief />
            智能简报
          </button>
        </div>
      )}

      <form className="copilot-dock__composer" onSubmit={onSubmit}>
        <button type="button" className="copilot-dock__attach" aria-label="添加附件">
          <IconPaperclip />
        </button>
        <input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onFocus={() => onOpenChat(draft)}
          onPointerUp={() => onOpenChat(draft)}
          onKeyDown={onKeyDown}
          placeholder="问 Copilot…"
          aria-label="问 Copilot"
          readOnly
          inputMode="none"
        />
        <button type="submit" className="copilot-dock__send" aria-label="打开对话">
          <IconSendUp />
        </button>
      </form>
    </div>
  )
}
