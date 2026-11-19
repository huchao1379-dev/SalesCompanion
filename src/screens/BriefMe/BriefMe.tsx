import './BriefMe.css'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  IconBulb,
  IconClose,
  IconPlay,
  IconRefresh,
  IconSpark,
  IconStop,
} from '../../components/DashIcons'
import { SheetScrim } from '../../components/SheetScrim'
import { buildBriefChapters, type BriefChapter } from '../../data/brief'
import { listDrafts } from '../../data/dataverse'
import { subscribeDrafts } from '../../data/draftStore'
import { cancelSpeech, speakText, unlockSpeech } from '../../speech/tts'

type Props = {
  open: boolean
  onClose: () => void
}

const PAGE_COUNT = 4
const SWIPE_THRESHOLD = 48
/** Ignore end-of-speech auto-advance when utterance dies almost immediately (blocked/failed TTS). */
const MIN_PLAY_MS_BEFORE_ADVANCE = 700

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
  const playlistRef = useRef(false)
  /** Armed by open / refresh / play; allows playlist auto-advance. */
  const userArmedPlayRef = useRef(false)
  const speakStartedAt = useRef(0)
  const dragY = useRef(0)
  const startY = useRef(0)
  const sheetRef = useRef<HTMLElement | null>(null)
  const carouselRef = useRef<HTMLDivElement | null>(null)
  const swipeStartX = useRef(0)
  const swipeStartY = useRef(0)
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
      playlistRef.current = false
      cancelSpeech()
    }
  }, [])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setElapsed((v) => v + 1), 1000)
    return () => window.clearInterval(id)
  }, [playing])

  const stopSpeak = useCallback(() => {
    speakGen.current += 1
    playlistRef.current = false
    userArmedPlayRef.current = false
    cancelSpeech()
    setPlaying(false)
  }, [])

  const speakPage = useCallback((index: number, opts?: { fromUserGesture?: boolean; playlist?: boolean }) => {
    const fromUserGesture = opts?.fromUserGesture ?? false
    const playlist = opts?.playlist ?? false
    const current = pagesRef.current[index]
    if (!current || !window.speechSynthesis) {
      playlistRef.current = false
      setPlaying(false)
      return
    }

    if (fromUserGesture) {
      userArmedPlayRef.current = true
      unlockSpeech()
    } else if (!userArmedPlayRef.current) {
      // Playlist continuation is allowed only after open/refresh/play armed TTS.
      playlistRef.current = false
      setPlaying(false)
      return
    }

    playlistRef.current = playlist

    speakGen.current += 1
    const gen = speakGen.current
    speakStartedAt.current = Date.now()

    const insight = chapterToInsight(current, index)
    const text = [insight.headline, insight.body].join('。')

    setElapsed(0)
    setPlaying(true)

    void speakText(text, {
      lang: 'zh-CN',
      rate: 1,
      onEnd: () => {
        if (gen !== speakGen.current) return
        const livedMs = Date.now() - speakStartedAt.current
        // Ignore instant end (blocked TTS) so we don't cascade 0→1→2→3.
        const canAdvance =
          playlistRef.current &&
          userArmedPlayRef.current &&
          livedMs >= MIN_PLAY_MS_BEFORE_ADVANCE
        const next = index + 1
        if (canAdvance && next < pagesRef.current.length) {
          pageRef.current = next
          setPage(next)
          setElapsed(0)
          speakPage(next, { fromUserGesture: false, playlist: true })
          return
        }
        playlistRef.current = false
        setPlaying(false)
      },
      onError: () => {
        if (gen !== speakGen.current) return
        playlistRef.current = false
        setPlaying(false)
      },
    })
  }, [])

  const goToPage = useCallback(
    (index: number, opts?: { play?: boolean; playlist?: boolean }) => {
      const next = Math.max(0, Math.min(pagesRef.current.length - 1, index))
      pageRef.current = next
      setPage(next)
      setDragX(0)
      setElapsed(0)
      if (opts?.play) {
        speakPage(next, {
          fromUserGesture: true,
          playlist: opts.playlist ?? true,
        })
      } else {
        stopSpeak()
      }
    },
    [speakPage, stopSpeak],
  )

  useEffect(() => {
    if (!open) {
      stopSpeak()
      setDragX(0)
      return
    }
    // Open → land on first card and autoplay through the playlist.
    pageRef.current = 0
    setPage(0)
    setElapsed(0)
    setDragX(0)
    const t = window.setTimeout(() => {
      speakPage(0, { fromUserGesture: true, playlist: true })
    }, 80)
    return () => window.clearTimeout(t)
  }, [open, speakPage, stopSpeak])

  function refresh() {
    setChapters(buildBriefChapters(listDrafts()))
    // Refresh → restart from the first card and autoplay.
    goToPage(0, { play: true, playlist: true })
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
    if (e.button != null && e.button !== 0) return
    swipeActive.current = true
    swipeStartX.current = e.clientX
    swipeStartY.current = e.clientY
    swipeDeltaX.current = 0
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Some hosts reject capture; still track via move/up on the element.
    }
  }

  function onSwipeMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!swipeActive.current) return
    const dx = e.clientX - swipeStartX.current
    const dy = e.clientY - swipeStartY.current
    // Prefer horizontal intent; ignore mostly-vertical drags (sheet dismiss lives on grab).
    if (Math.abs(dy) > Math.abs(dx) + 12 && Math.abs(dx) < SWIPE_THRESHOLD) {
      setDragX(0)
      swipeDeltaX.current = 0
      return
    }
    swipeDeltaX.current = dx
    setDragX(dx)
  }

  function onSwipeUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!swipeActive.current) return
    swipeActive.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }

    const delta = swipeDeltaX.current
    swipeDeltaX.current = 0
    setDragX(0)

    if (delta <= -SWIPE_THRESHOLD && pageRef.current < pagesRef.current.length - 1) {
      goToPage(pageRef.current + 1)
      return
    }
    if (delta >= SWIPE_THRESHOLD && pageRef.current > 0) {
      goToPage(pageRef.current - 1)
    }
  }

  if (!open) return null

  const paragraphLabel = `Paragraph ${page + 1}/${pages.length}`
  const timeLabel = `0:${String(Math.min(elapsed, 59)).padStart(2, '0')}`
  const slidePct = -page * (100 / PAGE_COUNT)

  return (
    <div className="sheet-root" role="presentation">
      <SheetScrim
        label="关闭播报"
        onClose={() => {
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
              title={playing ? '停止播报' : '点击播放今日播报'}
              onClick={() => {
                if (playing) {
                  stopSpeak()
                  return
                }
                // Only start TTS from an explicit user tap — never on sheet open.
                speakPage(pageRef.current, { fromUserGesture: true, playlist: true })
              }}
            >
              {playing ? <IconStop /> : <IconPlay />}
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
          ref={carouselRef}
          className="insights-carousel"
          onPointerDown={onSwipeDown}
          onPointerMove={onSwipeMove}
          onPointerUp={onSwipeUp}
          onPointerCancel={onSwipeUp}
        >
          <div
            className="insights-carousel__track"
            style={{
              width: `${PAGE_COUNT * 100}%`,
              transform: `translateX(calc(${slidePct}% + ${dragX}px))`,
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
                onClick={() => goToPage(i)}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
