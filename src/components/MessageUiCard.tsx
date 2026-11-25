import './MessageUiCard.css'
import type {
  EmailDraftFields,
  MessageUiBlock,
  MessageUiMetric,
  ReviewFinding,
} from '../agents/types'
import { ContactCard } from './ContactCard'
import { IconSpark } from './DashIcons'

type Props = {
  ui: MessageUiBlock
  onOpenAccount?: (accountKey: string) => void
  onOpenOpportunity?: () => void
  /** Clarify / follow-up chips can send text back to the composer. */
  onSendExample?: (text: string) => void
  /** Open editable email draft modal (Power Automate send). */
  onOpenEmailDraft?: (draft: EmailDraftFields) => void
  /** After cloud-flow send succeeds — hide draft card / edit action. */
  emailSent?: boolean
}

function splitMetrics(metrics: MessageUiMetric[] = []) {
  const primary = metrics.filter((m) => (m.priority || 'primary') === 'primary')
  const secondary = metrics.filter((m) => m.priority === 'secondary')
  if (primary.length || secondary.length) return { primary, secondary }
  return { primary: metrics, secondary: [] as MessageUiMetric[] }
}

function statusLabel(status?: string) {
  if (!status) return ''
  if (status === 'Draft') return '待确认'
  if (status === 'Confirmed') return '已确认'
  if (status === 'Syncing') return '同步中'
  if (status === 'Synced') return '已同步'
  if (status === 'SyncFailed') return '同步失败'
  return status
}

function severityLabel(severity: ReviewFinding['severity']) {
  if (severity === 'block') return '阻断'
  if (severity === 'warn') return '提醒'
  return '建议'
}

function FindingsList({ findings }: { findings: ReviewFinding[] }) {
  if (!findings.length) return null
  return (
    <ul className="msg-ui__findings" aria-label="督导建议">
      {findings.map((finding) => (
        <li
          key={`${finding.code}-${finding.message}`}
          className={`msg-ui__finding msg-ui__finding--${finding.severity}`}
        >
          <span className="msg-ui__finding-badge">{severityLabel(finding.severity)}</span>
          <span>{finding.message}</span>
        </li>
      ))}
    </ul>
  )
}

function MetricGrid({ metrics }: { metrics: MessageUiMetric[] }) {
  if (!metrics.length) return null
  return (
    <div className="msg-ui__metrics--primary">
      {metrics.map((metric) => (
        <div
          key={`${metric.label}-${metric.value}`}
          className={`msg-ui__metric msg-ui__metric--${metric.tone || 'neutral'}`}
        >
          <span className="msg-ui__metric-value">{metric.value}</span>
          <span className="msg-ui__metric-label">{metric.label}</span>
        </div>
      ))}
    </div>
  )
}

function SecondaryMetrics({ metrics }: { metrics: MessageUiMetric[] }) {
  if (!metrics.length) return null
  return (
    <div className="msg-ui__secondary">
      {metrics.map((metric) => (
        <span
          key={`${metric.label}-${metric.value}`}
          className={`msg-ui__chip msg-ui__chip--${metric.tone || 'neutral'}`}
        >
          <strong>{metric.value}</strong>
          <span>{metric.label}</span>
        </span>
      ))}
    </div>
  )
}

function FollowUpChips({
  chips,
  onSendExample,
}: {
  chips?: string[]
  onSendExample?: (text: string) => void
}) {
  if (!chips?.length || !onSendExample) return null
  return (
    <div className="msg-ui__followups" aria-label="继续追问">
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          className="msg-ui__followup"
          onClick={() => onSendExample(chip)}
        >
          {chip}
        </button>
      ))}
    </div>
  )
}

function SectionsBlock({ sections }: { sections?: MessageUiBlock['sections'] }) {
  if (!sections?.length) return null
  return (
    <div className="msg-ui__sections">
      {sections.map((section, index) => (
        <section key={`${section.heading || 'section'}-${index}`} className="msg-ui__section">
          {section.heading ? <p className="msg-ui__section-label">{section.heading}</p> : null}
          <ul className="msg-ui__bullets">
            {section.bullets.map((bullet, bulletIndex) => (
              <li key={`${bullet.text}-${bulletIndex}`} className="msg-ui__bullet">
                <span>{bullet.text}</span>
                {bullet.status ? (
                  <span className={`msg-ui__status msg-ui__status--${bullet.status.toLowerCase()}`}>
                    {statusLabel(bullet.status)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function EmailDraftChip({
  draft,
  onOpen,
}: {
  draft: EmailDraftFields
  onOpen?: (draft: EmailDraftFields) => void
}) {
  if (!onOpen) return null
  return (
    <button
      type="button"
      className="msg-ui__email-card"
      onClick={() => onOpen(draft)}
      aria-label="打开邮件草稿"
    >
      <span className="msg-ui__email-card-kicker">邮件草稿</span>
      <span className="msg-ui__email-card-subject">{draft.subject || '（无主题）'}</span>
      <span className="msg-ui__email-card-meta">
        {draft.to.trim() ? `收件人：${draft.to}` : '收件人待填写'} · 点击编辑并发送
      </span>
    </button>
  )
}

export function MessageUiCard({
  ui,
  onOpenAccount,
  onOpenOpportunity,
  onSendExample,
  onOpenEmailDraft,
  emailSent = false,
}: Props) {
  const supported =
    ui.type === 'account_pulse' ||
    ui.type === 'metric_strip' ||
    ui.type === 'opportunity_list' ||
    ui.type === 'order_status' ||
    ui.type === 'clarify' ||
    ui.type === 'work_summary' ||
    ui.type === 'capture_result' ||
    ui.type === 'review' ||
    ui.type === 'general_assist'
  if (!supported) return null

  const followUps = ui.followUps?.length
    ? ui.followUps
    : ui.examples?.length
      ? ui.examples
      : undefined

  const { primary, secondary } = splitMetrics(ui.metrics)
  const opportunities = (ui.items || []).filter((i) => (i.kind || 'other') === 'opportunity')
  const contacts = (ui.items || []).filter((i) => i.kind === 'contact')
  const otherItems = (ui.items || []).filter(
    (i) => i.kind !== 'opportunity' && i.kind !== 'contact',
  )
  const emailDraft = !emailSent ? ui.emailDraft : undefined
  const showEmailSend =
    Boolean(emailDraft && onOpenEmailDraft) &&
    Boolean(ui.actions?.some((a) => a.id === 'edit_send_email'))

  if (ui.type === 'clarify') {
    return (
      <div className="msg-ui msg-ui--clarify">
        <div className="msg-ui__clarify-head">
          <span className="msg-ui__clarify-icon" aria-hidden>
            <IconSpark />
          </span>
          <div>
            <p className="msg-ui__question">{ui.question || ui.title || '需要补充一点信息'}</p>
            {ui.title && ui.question ? <p className="msg-ui__title">{ui.title}</p> : null}
          </div>
        </div>
        {ui.examples && ui.examples.length > 0 ? (
          <div className="msg-ui__examples" aria-label="可以这样问">
            {ui.examples.map((example) => (
              <button
                key={example}
                type="button"
                className="msg-ui__example"
                disabled={!onSendExample}
                onClick={() => onSendExample?.(example)}
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  if (ui.type === 'work_summary' || ui.type === 'general_assist') {
    return (
      <div className={`msg-ui msg-ui--${ui.type}`}>
        {ui.title ? <p className="msg-ui__title">{ui.title}</p> : null}
        {primary.length || secondary.length ? (
          <>
            <MetricGrid metrics={primary} />
            <SecondaryMetrics metrics={secondary} />
          </>
        ) : null}
        <SectionsBlock sections={ui.sections} />
        {emailDraft ? <EmailDraftChip draft={emailDraft} onOpen={onOpenEmailDraft} /> : null}
        {emailSent ? <p className="msg-ui__email-sent">邮件已发送</p> : null}
        {showEmailSend ? (
          <div className="msg-ui__actions">
            <button
              type="button"
              className="chat-action-link"
              onClick={() => onOpenEmailDraft?.(emailDraft!)}
            >
              {ui.actions?.find((a) => a.id === 'edit_send_email')?.label || '编辑并发送邮件'}
              <span aria-hidden>→</span>
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  if (ui.type === 'capture_result') {
    return (
      <div className="msg-ui msg-ui--capture_result">
        {ui.title ? <p className="msg-ui__title">{ui.title}</p> : null}
        <MetricGrid metrics={primary} />
        <SecondaryMetrics metrics={secondary} />
        {ui.facts && ui.facts.length > 0 ? (
          <dl className="msg-ui__facts">
            {ui.facts.map((fact) => (
              <div key={fact.label} className={`msg-ui__fact msg-ui__fact--${fact.tone || 'neutral'}`}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <FindingsList findings={ui.findings || []} />
        <FollowUpChips chips={followUps} onSendExample={onSendExample} />
      </div>
    )
  }

  if (ui.type === 'review') {
    return (
      <div className="msg-ui msg-ui--review">
        {ui.title ? <p className="msg-ui__title">{ui.title}</p> : null}
        <FindingsList findings={ui.findings || []} />
        <FollowUpChips chips={followUps} onSendExample={onSendExample} />
      </div>
    )
  }

  return (
    <div className={`msg-ui msg-ui--${ui.type}`}>
      {ui.title ? <p className="msg-ui__title">{ui.title}</p> : null}

      <MetricGrid metrics={primary} />
      <SecondaryMetrics metrics={secondary} />

      {opportunities.length > 0 ? (
        <div className="msg-ui__section">
          <p className="msg-ui__section-label">开放商机</p>
          <ul className="msg-ui__items">
            {opportunities.map((item) => (
              <li key={`${item.title}-${item.badge || ''}`} className="msg-ui__item">
                <div className="msg-ui__item-main">
                  <span className="msg-ui__item-title">{item.title}</span>
                  {item.subtitle ? <span className="msg-ui__item-sub">{item.subtitle}</span> : null}
                </div>
                {item.badge ? <span className="msg-ui__item-badge">{item.badge}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {contacts.length > 0 ? (
        <div className="msg-ui__section">
          <p className="msg-ui__section-label">联系人</p>
          <ul className="msg-ui__contacts">
            {contacts.map((item) => (
              <li key={`${item.title}-${item.badge || ''}`}>
                <ContactCard
                  name={item.title}
                  title={item.subtitle}
                  badge={item.badge && item.badge !== '联系人' ? item.badge : undefined}
                  compact
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {otherItems.length > 0 ? (
        <ul className="msg-ui__items">
          {otherItems.map((item) => (
            <li key={`${item.title}-${item.badge || ''}`} className="msg-ui__item">
              <div className="msg-ui__item-main">
                <span className="msg-ui__item-title">{item.title}</span>
                {item.subtitle ? <span className="msg-ui__item-sub">{item.subtitle}</span> : null}
              </div>
              {item.badge ? <span className="msg-ui__item-badge">{item.badge}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <SectionsBlock sections={ui.sections} />

      {ui.unverifiedNotes ? (
        <p className="msg-ui__notes">
          <strong>未核实备注</strong>
          {ui.unverifiedNotes}
        </p>
      ) : null}

      {emailDraft ? <EmailDraftChip draft={emailDraft} onOpen={onOpenEmailDraft} /> : null}
      {emailSent ? <p className="msg-ui__email-sent">邮件已发送</p> : null}

      {ui.actions && ui.actions.length > 0 ? (
        <div className="msg-ui__actions">
          {ui.actions.map((action) => {
            if (action.id === 'open_account' && ui.accountKey && onOpenAccount) {
              return (
                <button
                  key={action.id}
                  type="button"
                  className="chat-action-link"
                  onClick={() => onOpenAccount(ui.accountKey!)}
                >
                  {action.label}
                  <span aria-hidden>→</span>
                </button>
              )
            }
            if (action.id === 'open_opportunity' && onOpenOpportunity) {
              return (
                <button
                  key={action.id}
                  type="button"
                  className="chat-action-link"
                  onClick={onOpenOpportunity}
                >
                  {action.label}
                  <span aria-hidden>→</span>
                </button>
              )
            }
            if (action.id === 'edit_send_email' && emailDraft && onOpenEmailDraft) {
              return (
                <button
                  key={action.id}
                  type="button"
                  className="chat-action-link"
                  onClick={() => onOpenEmailDraft(emailDraft)}
                >
                  {action.label}
                  <span aria-hidden>→</span>
                </button>
              )
            }
            return null
          })}
        </div>
      ) : null}
    </div>
  )
}
