import './MessageUiCard.css'
import type { MessageUiBlock, MessageUiMetric } from '../agents/types'

type Props = {
  ui: MessageUiBlock
  onOpenAccount?: (accountKey: string) => void
  onOpenOpportunity?: () => void
}

function splitMetrics(metrics: MessageUiMetric[] = []) {
  const primary = metrics.filter((m) => (m.priority || 'primary') === 'primary')
  const secondary = metrics.filter((m) => m.priority === 'secondary')
  if (primary.length || secondary.length) return { primary, secondary }
  return { primary: metrics, secondary: [] as MessageUiMetric[] }
}

export function MessageUiCard({ ui, onOpenAccount, onOpenOpportunity }: Props) {
  const supported =
    ui.type === 'account_pulse' ||
    ui.type === 'metric_strip' ||
    ui.type === 'opportunity_list' ||
    ui.type === 'order_status'
  if (!supported) return null

  const { primary, secondary } = splitMetrics(ui.metrics)
  const opportunities = (ui.items || []).filter((i) => (i.kind || 'other') === 'opportunity')
  const contacts = (ui.items || []).filter((i) => i.kind === 'contact')
  const otherItems = (ui.items || []).filter(
    (i) => i.kind !== 'opportunity' && i.kind !== 'contact',
  )

  return (
    <div className={`msg-ui msg-ui--${ui.type}`}>
      {ui.title ? <p className="msg-ui__title">{ui.title}</p> : null}

      {primary.length > 0 ? (
        <div className="msg-ui__metrics msg-ui__metrics--primary" aria-label="关键指标">
          {primary.map((m) => (
            <div
              key={`${m.label}-${m.value}`}
              className={`msg-ui__metric msg-ui__metric--${m.tone || 'neutral'}`}
            >
              <span className="msg-ui__metric-value">{m.value}</span>
              <span className="msg-ui__metric-label">{m.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {secondary.length > 0 ? (
        <div className="msg-ui__secondary" aria-label="补充摘要">
          {secondary.map((m) => (
            <span
              key={`${m.label}-${m.value}`}
              className={`msg-ui__chip msg-ui__chip--${m.tone || 'neutral'}`}
            >
              <strong>{m.value}</strong>
              <span>{m.label}</span>
            </span>
          ))}
        </div>
      ) : null}

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
          <ul className="msg-ui__items">
            {contacts.map((item) => (
              <li key={`${item.title}-${item.badge || ''}`} className="msg-ui__item">
                <div className="msg-ui__item-main">
                  <span className="msg-ui__item-title">{item.title}</span>
                  {item.subtitle ? <span className="msg-ui__item-sub">{item.subtitle}</span> : null}
                </div>
                {item.badge ? (
                  <span className="msg-ui__item-badge msg-ui__item-badge--soft">{item.badge}</span>
                ) : null}
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
