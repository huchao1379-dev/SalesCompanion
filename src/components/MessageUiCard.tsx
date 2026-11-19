import './MessageUiCard.css'
import type { MessageUiBlock, MessageUiMetric, ReviewFinding } from '../agents/types'
import { ContactCard } from './ContactCard'
import { IconSpark } from './DashIcons'

type Props = {
  ui: MessageUiBlock
  onOpenAccount?: (accountKey: string) => void
  onOpenOpportunity?: () => void
  /** Clarify cards can send an example back to the composer. */
  onSendExample?: (text: string) => void
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

export function MessageUiCard({ ui, onOpenAccount, onOpenOpportunity, onSendExample }: Props) {
  const supported =
    ui.type === 'account_pulse' ||
    ui.type === 'metric_strip' ||
    ui.type === 'opportunity_list' ||
    ui.type === 'order_status' ||
    ui.type === 'clarify' ||
    ui.type === 'work_summary' ||
    ui.type === 'capture_result' ||
    ui.type === 'review'
  if (!supported) return null

  const { primary, secondary } = splitMetrics(ui.metrics)
  const opportunities = (ui.items || []).filter((i) => (i.kind || 'other') === 'opportunity')
  const contacts = (ui.items || []).filter((i) => i.kind === 'contact')
  const otherItems = (ui.items || []).filter(
    (i) => i.kind !== 'opportunity' && i.kind !== 'contact',
  )

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
        {ui.footnote ? <p className="msg-ui__footnote">{ui.footnote}</p> : null}
      </div>
    )
  }

  if (ui.type === 'work_summary') {
    return (
      <div className="msg-ui msg-ui--work_summary">
        {ui.title ? <p className="msg-ui__title">{ui.title}</p> : null}
        {primary.length || secondary.length ? (
          <>
            <MetricGrid metrics={primary} />
            <SecondaryMetrics metrics={secondary} />
          </>
        ) : null}
        {ui.sections && ui.sections.length > 0 ? (
          <div className="msg-ui__sections">
            {ui.sections.map((section, index) => (
              <section key={`${section.heading || 'section'}-${index}`} className="msg-ui__section">
                {section.heading ? <p className="msg-ui__section-label">{section.heading}</p> : null}
                <ul className="msg-ui__bullets">
                  {section.bullets.map((bullet, bulletIndex) => (
                    <li key={`${bullet.text}-${bulletIndex}`} className="msg-ui__bullet">
                      <span>{bullet.text}</span>
                      {bullet.status ? (
                        <span
                          className={`msg-ui__status msg-ui__status--${bullet.status.toLowerCase()}`}
                        >
                          {statusLabel(bullet.status)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
        {ui.footnote ? <p className="msg-ui__footnote">{ui.footnote}</p> : null}
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
        {ui.hint ? (
          <p className="msg-ui__hint" role="note">
            {ui.hint}
          </p>
        ) : null}
        {ui.footnote ? <p className="msg-ui__footnote">{ui.footnote}</p> : null}
      </div>
    )
  }

  if (ui.type === 'review') {
    return (
      <div className="msg-ui msg-ui--review">
        {ui.title ? <p className="msg-ui__title">{ui.title}</p> : null}
        <FindingsList findings={ui.findings || []} />
        {ui.footnote ? <p className="msg-ui__footnote">{ui.footnote}</p> : null}
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

      {ui.unverifiedNotes ? (
        <p className="msg-ui__notes">
          <strong>未核实备注</strong>
          {ui.unverifiedNotes}
        </p>
      ) : null}

      {ui.hint ? (
        <p className="msg-ui__hint" role="note">
          {ui.hint}
        </p>
      ) : null}

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
            return null
          })}
        </div>
      ) : null}

      {ui.footnote ? <p className="msg-ui__footnote">{ui.footnote}</p> : null}
    </div>
  )
}
