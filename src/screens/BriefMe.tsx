import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { IconBulb, IconClose, IconRefresh, IconSpark } from '../components/DashIcons'
import { buildBriefChapters, type BriefChapter } from '../data/brief'
import { listDrafts } from '../data/dataverse'
import { subscribeDrafts } from '../data/draftStore'

type Props = {
  open: boolean
  onClose: () => void
}

const PAGE_COUNT = 4
const SWIPE_THRESHOLD = 56

const DEFAULT_INSIGHT = {
  label: 'Performance Analysis',
  headline: 'Achieved 67% of quarterly sales target',
  body:
    'Your team has secured $500K against a $750K target. Progress is solid, but focus should be maintained on closing the remaining $250K this quarter to stay on track.',
}

function chapterToInsight(chapter: BriefChapter | undefined, index: number) {
  if (index === 0) return DEFAULT_INSIGHT
  if (!chapter) return DEFAULT_INSIGHT
  const labels = ['Performance Analysis', 'Risk Outlook', 'Sync Health', 'Account Pulse']
  const body = [chapter.summary, ...chapter.points].filter(Boolean).join(' ')
  return {
    label: labels[index] ?? chapter.title,
    headline: chapter.title,
    body,
  }
}

export function BriefMe({ open, onClose }: Props) {
  const [chapters, setChapters] = useState(() => buildBriefChapters(listDrafts()))
  const [page, setPage] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [dragX, setDragX] = useState(0)

  const pageRef = useRef(0)
  const speakGen = useRef(0)
  const dragY = useRef(0)
  const startY = useRef(0)
  const sheetRef = useRef<HTMLElement | null>(null)
  const swipeStartX = useRef(0)
  const swipeDeltaX = useRef(0)
  const swipeActive = useRef(false)
  const pagesRef = useRef<BriefChapter[]>([])

  const pages = useMemo(() => {
    const base = [...chapters]
    while (base.length < PAGE_COUNT) {
      base.push({
        title: '今日行动建议',
        summary: 'Here is your business briefing for today.',
        points: [
          '优先确认待同步草稿，避免漏跟进。',
          '对风险商机安排一次短会核对采购窗口。',
          '用 Voice-First 录入今日拜访，30 秒内生成草稿。',
        ],
        metrics: ['Focus', 'Follow-up'],
      })
    }
    return base.slice(0, PAGE_COUNT)
  }, [chapters])

  pagesRef.current = pages

  useEffect(() => {
    return subscribeDrafts((drafts) => {
      setChapters(buildBriefChapters(drafts))
    })
  }, [])

  useEffect(() => {
    return () => {
      speakGen.current += 1
      window.speechSynthesis?.cancel()
    }
  }, [])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setElapsed((v) => v + 1), 1000)
    return () => window.clearInterval(id)
  }, [playing])

  const stopSpeak = useCallback(() => {
    speakGen.current += 1
    window.speechSynthesis?.cancel()
    setPlaying(false)
  }, [])

  const speakPage = useCallback((index: number) => {
    const current = pagesRef.current[index]
    if (!current || !window.speechSynthesis) {
      setPlaying(false)
      return
    }

    speakGen.current += 1
    const gen = speakGen.current
    window.speechSynthesis.cancel()

    const insight = chapterToInsight(current, index)
    const text = [insight.headline, insight.body].join('。')
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'zh-CN'
    utter.rate = 1

    utter.onend = () => {
      if (gen !== speakGen.current) return
      const next = index + 1
      if (next < pagesRef.current.length) {
        pageRef.current = next
        setPage(next)
        setElapsed(0)
        speakPage(next)
      } else {
        setPlaying(false)
      }
    }

    utter.onerror = () => {
      if (gen !== speakGen.current) return
      setPlaying(false)
    }

    setElapsed(0)
    setPlaying(true)
    window.speechSynthesis.speak(utter)
  }, [])

  const goToPage = useCallback(
    (index: number, autoPlay = true) => {
      const next = Math.max(0, Math.min(pagesRef.current.length - 1, index))
      pageRef.current = next
      setPage(next)
      setDragX(0)
      setElapsed(0)
      if (autoPlay) speakPage(next)
      else stopSpeak()
    },
    [speakPage, stopSpeak],
  )

  useEffect(() => {
    if (!open) {
      stopSpeak()
      setDragX(0)
      return
    }
    pageRef.current = 0
    setPage(0)
    setElapsed(0)
    speakPage(0)
  }, [open, speakPage, stopSpeak])

  function refresh() {
    setChapters(buildBriefChapters(listDrafts()))
    speakPage(pageRef.current)
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    startY.current = e.clientY
    dragY.current = 0
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    dragY.current = Math.max(0, e.clientY - startY.current)
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dragY.current}px)`
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (sheetRef.current) sheetRef.current.style.transform = ''
    if (dragY.current > 120) {
      stopSpeak()
      onClose()
    }
  }

  function onSwipeDown(e: ReactPointerEvent<HTMLDivElement>) {
    swipeActive.current = true
    swipeStartX.current = e.clientX
    swipeDeltaX.current = 0
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onSwipeMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!swipeActive.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    swipeDeltaX.current = e.clientX - swipeStartX.current
    setDragX(swipeDeltaX.current)
  }

  function onSwipeUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!swipeActive.current) return
    swipeActive.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    const delta = swipeDeltaX.current
    swipeDeltaX.current = 0
    setDragX(0)

    if (delta <= -SWIPE_THRESHOLD && pageRef.current < pagesRef.current.length - 1) {
      goToPage(pageRef.current + 1, true)
      return
    }
    if (delta >= SWIPE_THRESHOLD && pageRef.current > 0) {
      goToPage(pageRef.current - 1, true)
      return
    }
  }

  if (!open) return null

  const paragraphLabel = `Paragraph ${page + 1}/${pages.length}`
  const timeLabel = `0:${String(Math.min(elapsed, 59)).padStart(2, '0')}`

  return (
    <div className="sheet-root" role="presentation">
      <button
        type="button"
        className="sheet-scrim"
        aria-label="关闭播报"
        onClick={() => {
          stopSpeak()
          onClose()
        }}
      />
      <section
        ref={sheetRef}
        className="insights-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Insights 今日播报"
      >
        <header
          className="insights-sheet__grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="insights-sheet__handle" />
        </header>

        <div className="insights-sheet__head">
          <div className="insights-sheet__title-block">
            <div className="insights-sheet__title-row">
              <span className="insights-sheet__spark" aria-hidden>
                <IconSpark />
              </span>
              <h2>Insights</h2>
            </div>
            <p className="insights-sheet__meta">
              {timeLabel} · {paragraphLabel}
            </p>
            <p className="insights-sheet__subtitle">Here is your business briefing for today.</p>
          </div>

          <div className="insights-sheet__controls">
            <button type="button" className="sheet-icon-btn" aria-label="重新播报" onClick={refresh}>
              <IconRefresh />
            </button>
            <button
              type="button"
              className={`sheet-icon-btn sheet-icon-btn--ok${playing ? ' is-playing' : ''}`}
              aria-label={playing ? '停止播报' : '播放今日播报'}
              onClick={() => {
                if (playing) stopSpeak()
                else speakPage(pageRef.current)
              }}
            >
              <span className="sheet-icon-btn__stop" />
            </button>
            <button
              type="button"
              className="sheet-icon-btn"
              aria-label="关闭"
              onClick={() => {
                stopSpeak()
                onClose()
              }}
            >
              <IconClose />
            </button>
          </div>
        </div>

        <div
          className="insights-carousel"
          onPointerDown={onSwipeDown}
          onPointerMove={onSwipeMove}
          onPointerUp={onSwipeUp}
          onPointerCancel={onSwipeUp}
        >
          <div
            className="insights-carousel__track"
            style={{
              transform: `translateX(calc(${-page * 100}% + ${dragX}px))`,
              transition: dragX === 0 ? 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
            }}
          >
            {pages.map((chapter, i) => {
              const insight = chapterToInsight(chapter, i)
              return (
                <article key={`${chapter.title}-${i}`} className="insight-card">
                  <div className="insight-card__icon" aria-hidden>
                    <IconBulb />
                  </div>
                  <div className="insight-card__body">
                    <p className="insight-card__label">{insight.label}</p>
                    <h3 className="insight-card__headline">{insight.headline}</h3>
                    <p className="insight-card__text">{insight.body}</p>
                  </div>
                </article>
              )
            })}
          </div>
        </div>

        <div className="insights-sheet__footer">
          <div className="insights-dots" role="tablist" aria-label="播报分页">
            {pages.map((c, i) => (
              <button
                key={`${c.title}-${i}`}
                type="button"
                role="tab"
                aria-selected={i === page}
                className={i === page ? 'insights-dot is-active' : 'insights-dot'}
                onClick={() => goToPage(i, true)}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
