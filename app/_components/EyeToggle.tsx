'use client'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'mamalek-figures'

// Runs before the page paints, so a hidden choice never flashes the numbers first.
export const EYE_INIT_SCRIPT = `try{if(localStorage.getItem('${STORAGE_KEY}')==='hidden')document.documentElement.dataset.figures='hidden'}catch(e){}`

// Blurs figures on screen, for when someone is looking over your shoulder. It isn't a
// security control: the numbers are still in the page. Access rules do that job.
export default function EyeToggle() {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    setHidden(document.documentElement.dataset.figures === 'hidden')
  }, [])

  function toggle() {
    const next = !hidden
    setHidden(next)
    if (next) document.documentElement.dataset.figures = 'hidden'
    else delete document.documentElement.dataset.figures
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'hidden' : 'shown')
    } catch {
      // Private browsing can block storage. The toggle still works for this page.
    }
  }

  return (
    <button
      type="button"
      className="eye-toggle"
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={hidden ? 'Show figures' : 'Hide figures'}
      title={hidden ? 'Show figures' : 'Hide figures'}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
        {hidden ? <line x1="3" y1="3" x2="21" y2="21" /> : null}
      </svg>
    </button>
  )
}
