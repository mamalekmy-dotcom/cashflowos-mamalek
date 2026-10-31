'use client'
import { useState, useTransition } from 'react'
import { draftReview } from './actions'

type Props = { token: string; platform: string; reviewUrl: string | null; gift: string | null }

export default function ReviewFlow({ token, platform, reviewUrl, gift }: Props) {
  const [rating, setRating] = useState(0)
  const [liked, setLiked] = useState('')
  const [draft, setDraft] = useState('')
  const [posted, setPosted] = useState(false)
  const [pending, start] = useTransition()

  if (posted) {
    return (
      <>
        <h1 className="ph" style={{ fontSize: 18 }}>Thank you!</h1>
        <p className="cap" style={{ margin: '8px 0 0' }}>{gift ? `Show this screen to staff for your gift: ${gift}` : 'See you again soon.'}</p>
      </>
    )
  }

  if (draft) {
    return (
      <>
        <h1 className="ph" style={{ fontSize: 18, marginBottom: 12 }}>Your review</h1>
        <textarea className="login-input" rows={5} aria-label="Your review" value={draft} onChange={e => setDraft(e.target.value)} />
        <p className="cap" style={{ margin: '10px 0' }}>Edit it so it sounds like you. Posting is your choice.</p>
        <button
          className="btn"
          type="button"
          style={{ width: '100%' }}
          onClick={async () => {
            await navigator.clipboard.writeText(draft).catch(() => null)
            if (reviewUrl) window.open(reviewUrl, '_blank', 'noreferrer')
            setPosted(true)
          }}
        >
          Copy and open {platform}
        </button>
      </>
    )
  }

  return (
    <>
      <h1 className="ph" style={{ fontSize: 18 }}>How was your meal?</h1>
      <div className="btnrow" style={{ margin: '14px 0' }}>
        {[1, 2, 3, 4, 5].map(star => (
          <button key={star} type="button" className={`btn${rating === star ? '' : ' ghost'}`} aria-label={`${star} stars`} onClick={() => setRating(star)}>{star}★</button>
        ))}
      </div>
      <input className="login-input" placeholder="What did you have or enjoy?" aria-label="What you enjoyed" value={liked} onChange={e => setLiked(e.target.value)} />
      <button
        className="btn"
        type="button"
        disabled={pending || !rating}
        style={{ width: '100%', marginTop: 12 }}
        onClick={() => start(async () => { const result = await draftReview(token, rating, liked); if (result.ok) setDraft(result.draft) })}
      >
        {pending ? 'Writing…' : 'Draft my review'}
      </button>
    </>
  )
}
