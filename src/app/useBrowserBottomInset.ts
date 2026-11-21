import { useEffect } from 'react'

function isAppleTouchDevice() {
  if (typeof navigator === 'undefined') return false
  return (
    /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isAndroidDevice() {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}

/** Keep bottom docks clear of iOS Safari / Android Chrome / host chrome. */
export function useBrowserBottomInset() {
  useEffect(() => {
    const root = document.documentElement
    const ios = isAppleTouchDevice()
    const android = isAndroidDevice()

    root.dataset.platform = ios ? 'ios' : android ? 'android' : 'other'

    const sync = () => {
      const vv = window.visualViewport
      const measured = vv
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0
      // Mobile browser chrome often sits over the page; iframe hosts may also
      // report 0 for env(safe-area-inset-bottom). Keep a modest platform floor.
      // Android: avoid a high floor — gesture nav + chrome already inflate
      // measured/safe-area and previously left docks floating too high.
      const floor = ios ? 16 : 0
      // Cap so a mis-reported visualViewport gap cannot push docks up excessively.
      const cap = ios ? 34 : android ? 16 : 24
      const next = Math.min(Math.max(measured, floor), cap)
      root.style.setProperty('--browser-bottom', `${next}px`)
    }

    sync()
    window.visualViewport?.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('scroll', sync)
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)

    return () => {
      window.visualViewport?.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
      root.style.removeProperty('--browser-bottom')
      delete root.dataset.platform
    }
  }, [])
}
