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

    const sync = () => {
      const vv = window.visualViewport
      const measured = vv
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0
      // Mobile browser chrome often sits over the page; iframe hosts may also
      // report 0 for env(safe-area-inset-bottom). Keep a platform floor gap.
      const floor = ios ? 20 : android ? 12 : 0
      root.style.setProperty('--browser-bottom', `${Math.max(measured, floor)}px`)
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
    }
  }, [])
}
