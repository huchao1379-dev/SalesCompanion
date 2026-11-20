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
import { IconButton } from '../../components/IconButton'
import { SheetScrim } from '../../components/SheetScrim'
import { buildBriefChapters, type BriefChapter } from '../../data/brief'
import { listDrafts } from '../../data/dataverse'
import { subscribeDrafts } from '../../data/draftStore'
import { cancelSpeech, speakText, unlockSpeech } from '../../speech/tts'

type Props = {
  open: boolean
  onClose: () => void
  /** Bumped by parent inside a user gesture so mobile TTS autoplay is allowed. */
  playRequestId?: number
}

const PAGE_COUNT = 4
const SWIPE_THRESHOLD = 48
/** Ignore end-of-speech auto-advance when utterance dies almost immediately (blocked/failed TTS). */
const MIN_PLAY_MS_BEFORE_ADVANCE = 700

const DEFAULT_INSIGHT = {
  label: '业绩分析',
  headline: '本季度销售目标已完成 67%',
  body:
    '团队已完成 50 万美元，目标 75 万美元。整体进度稳健，接下来重点推进剩余 25 万美元的成交。',
}

function chapterToInsight(chapter: BriefChapter | undefined, index: number) {
  if (index === 0) return DEFAULT_INSIGHT
  if (!chapter) return DEFAULT_INSIGHT
  const labels = ['业绩分析', '风险展望', '同步健康度', '客户脉搏']
  const body = [chapter.summary, ...chapter.points].filter(Boolean).join(' ')
  return {
    label: labels[index] ?? chapter.title,
    headline: chapter.title,
    body,
  }
}

export function BriefMe({ open, onClose, playRequestId = 0 }: Props) {
  const [chapters, setChapters] = useState(() => buildBriefChapters(listDrafts()))
  const [page, setPage] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ttsError, setTtsError] = useState('')
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
        summary: '这是今天的业务播报。',
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

  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

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

  const pendingAutoRetryRef = useRef(false)

  const speakPage = useCallback((
    index: number,
    opts?: { fromUserGesture?: boolean; playlist?: boolean; autoPlay?: boolean },
  ) => {
    const fromUserGesture = opts?.fromUserGesture ?? false
    const playlist = opts?.playlist ?? false
    const autoPlay = opts?.autoPlay ?? false
    const current = pagesRef.current[index]
    if (!current) {
      playlistRef.current = false
      setPlaying(false)
      return
    }
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      playlistRef.current = false
      userArmedPlayRef.current = false
      setPlaying(false)
      setTtsError('当前运行环境不支持语音播报，请使用 Chrome 或 Edge 浏览器。')
      return
    }

    if (fromUserGesture) {
      userArmedPlayRef.current = true
      pendingAutoRetryRef.current = false
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
    setPlaying(false)
    setTtsError('')

    speakText(text, {
      lang: 'zh-CN',
      rate: 1,
      onStart: () => {
        if (gen !== speakGen.current) return
        pendingAutoRetryRef.current = false
        setPlaying(true)
      },
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
          // eslint-disable-next-line react-hooks/immutability -- recursive playlist advance
          speakPage(next, { fromUserGesture: false, playlist: true })
          return
        }
        playlistRef.current = false
        setPlaying(false)
      },
      onError: (error) => {
        if (gen !== speakGen.current) return
        playlistRef.current = false
        userArmedPlayRef.current = false
        setPlaying(false)
        const blocked = error.error === 'not-allowed'
        if (blocked && autoPlay) {
          // First paint / cold open has no gesture — retry on the next tap.
          pendingAutoRetryRef.current = true
        }
        setTtsError(
          blocked
            ? autoPlay
              ? '浏览器拦截了自动播报，点任意处或播放按钮即可开始。'
              : '浏览器没有启动语音播报，请检查语音权限或使用 Chrome/Edge 重试。'
            : error.error === 'language-unavailable' ||
                error.error === 'voice-unavailable' ||
                error.error === 'synthesis-unavailable'
              ? '当前设备没有可用的中文语音，请检查系统语音设置。'
              : '语音播报启动失败，请检查浏览器权限或稍后重试。',
        )
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

  /* eslint-disable react-hooks/set-state-in-effect -- open/close and first-card reset are intentional side effects. */
  useEffect(() => {
    if (!open) {
      stopSpeak()
      setDragX(0)
      return
    }
    // Open → land on first card and autoplay through the playlist.
    // Parent must call unlockSpeech() in the same tap; we speak ASAP (no long
    // delay) so mobile browsers still treat the session as unlocked.
    pageRef.current = 0
    setPage(0)
    setElapsed(0)
    setDragX(0)
    setTtsError('')
    // Microtask keeps unlock utterance from being cancelled in the same tick
    // as speakText's cancel(), while staying close to the user gesture.
    let cancelled = false
    const start = () => {
      if (cancelled) return
      speakPage(0, { fromUserGesture: true, playlist: true, autoPlay: true })
    }
    const t = window.setTimeout(start, 0)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [open, playRequestId, speakPage, stopSpeak])
  /* eslint-enable react-hooks/set-state-in-effect */

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
        onPointerDownCapture={(e) => {
          // Cold-open autoplay is often blocked; first tap unlocks and retries.
          if (!pendingAutoRetryRef.current || playing) return
          const target = e.target as HTMLElement | null
          // Let dedicated controls (play / refresh / close / dots) handle themselves.
          if (target?.closest('button, a, [role="tab"]')) return
          pendingAutoRetryRef.current = false
          unlockSpeech()
          speakPage(pageRef.current, { fromUserGesture: true, playlist: true, autoPlay: true })
        }}
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
            <p className={`insights-sheet__subtitle${ttsError ? ' is-warn' : ''}`}>
              {ttsError
                ? ttsError
                : playing
                  ? '正在播报…'
                  : '打开时会尝试自动播报；如浏览器拦截，请点击播放按钮。'}
            </p>
          </div>

          <div className="insights-sheet__controls">
            <IconButton variant="soft" size="sm" aria-label="重新播报" onClick={refresh}>
              <IconRefresh />
            </IconButton>
            <IconButton
              variant="success"
              size="sm"
              className={playing ? 'is-playing' : ''}
              aria-label={playing ? '停止播报' : '播放今日播报'}
              title={playing ? '停止播报' : '点击播放今日播报'}
              aria-pressed={playing}
              onClick={() => {
                if (playing) {
                  stopSpeak()
                  return
                }
                setTtsError('')
                // Start synchronously from the user's click so browser autoplay
                // restrictions do not block an explicitly requested playback.
                speakPage(pageRef.current, { fromUserGesture: true, playlist: true })
              }}
            >
              {playing ? <IconStop /> : <IconPlay />}
            </IconButton>
            <IconButton
              variant="soft"
              size="sm"
              aria-label="关闭"
              onClick={() => {
                stopSpeak()
                onClose()
              }}
            >
              <IconClose />
            </IconButton>
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
