import { useState } from 'react'
import { LocationSheet } from '../components/LocationSheet'
import {
  IconBack,
  IconBuilding,
  IconCalendar,
  IconChevronRight,
  IconNotes,
  IconPhone,
  IconPin,
  IconRefresh,
  IconSpark,
  IconTrash,
  IconUser,
} from '../components/DashIcons'
import { EVENT_META, type AgendaItem } from '../data/agenda'

type Props = {
  item: AgendaItem
  dateLabel: string
  onBack: () => void
}

export function ActivityDetails({ item, dateLabel, onBack }: Props) {
  const [locationOpen, setLocationOpen] = useState(false)
  const typeLabel = EVENT_META[item.type].label

  return (
    <section className={`activity-detail${locationOpen ? ' is-dimmed' : ''}`}>
      <header className="activity-detail__top">
        <button type="button" className="activity-detail__icon-btn" aria-label="返回" onClick={onBack}>
          <IconBack />
        </button>
        <h1>Activity Details</h1>
        <button type="button" className="activity-detail__icon-btn is-danger" aria-label="删除">
          <IconTrash />
        </button>
      </header>

      <article className="activity-detail__hero">
        <div className="activity-detail__hero-main">
          <span className={`activity-detail__badge-icon ${EVENT_META[item.type].className}`} aria-hidden>
            <IconCalendar />
          </span>
          <div className="activity-detail__hero-copy">
            <h2>{item.title}</h2>
            <div className="activity-detail__tags">
              <span className="activity-tag is-draft">{item.status}</span>
              <span className="activity-tag">{typeLabel}</span>
            </div>
          </div>
        </div>

        <div className="activity-detail__when">
          <span className="activity-detail__when-icon" aria-hidden>
            <IconCalendar />
          </span>
          <div>
            <p className="activity-detail__when-date">{dateLabel}</p>
            <p className="activity-detail__when-time">{item.time}</p>
          </div>
        </div>
      </article>

      <article className="activity-detail__ai">
        <span className="activity-detail__ai-icon" aria-hidden>
          <IconSpark />
        </span>
        <div className="activity-detail__ai-copy">
          <strong>AI Insights</strong>
          <p>AI analysis will be generated after updates</p>
        </div>
        <button type="button" className="activity-detail__icon-btn" aria-label="刷新洞察">
          <IconRefresh />
        </button>
      </article>

      <section className="activity-detail__card">
        <h3 className="activity-detail__section-label">Related Context</h3>

        <button type="button" className="activity-org" onClick={() => setLocationOpen(true)}>
          <span className="activity-org__icon" aria-hidden>
            <IconBuilding />
          </span>
          <span className="activity-org__body">
            <span className="activity-org__title-row">
              <strong>{item.orgName}</strong>
              <span className="activity-org__chevron" aria-hidden>
                <IconChevronRight />
              </span>
            </span>
            <span className="activity-org__meta">{item.orgIndustry}</span>
            <span className="activity-org__meta">
              <IconPhone /> {item.orgPhone}
            </span>
            <span className="activity-org__meta">
              <IconPin /> {item.location}
            </span>
          </span>
        </button>

        <h4 className="activity-detail__section-label activity-detail__section-label--sub">
          Contacts ({item.contacts.length})
        </h4>
        <ul className="activity-contacts">
          {item.contacts.map((c) => (
            <li key={c.name}>
              <span className="activity-contacts__avatar" aria-hidden>
                <IconUser />
              </span>
              <span className="activity-contacts__body">
                <strong>{c.name}</strong>
                <span>{c.role}</span>
              </span>
              <a className="activity-contacts__phone" href={`tel:${c.phone.replace(/\s/g, '')}`} aria-label={`呼叫 ${c.name}`}>
                <IconPhone />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="activity-detail__card">
        <h3 className="activity-detail__section-label">Details</h3>
        <div className="activity-notes">
          <p className="activity-notes__label">
            <IconNotes /> Notes
          </p>
          <p className="activity-notes__text">{item.notes}</p>
        </div>
      </section>

      <LocationSheet open={locationOpen} item={item} onClose={() => setLocationOpen(false)} />
    </section>
  )
}
