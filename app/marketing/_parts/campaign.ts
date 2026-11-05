// Helpers for the Marketing tab (category==='campaign'). Kept in _parts/ so the
// whole lane stays inside app/marketing/.
import type { Rec } from '@/lib/records'

// Always listed in "Spend by channel", even before they have a campaign.
export const CHANNELS = ['Google Ads', 'Meta Ads', 'TikTok Ads']

// meta values arrive as numbers or strings ("820", "RM 820") — read either.
export const num = (v: unknown) => {
  const n = Number(String(v ?? 0).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// Folds everyday spellings onto the three main platforms, so "facebook",
// "IG" and "Meta Ads" all land on one Meta Ads line.
export function channelOf(r: Rec): string {
  const raw = String(r.meta?.channel ?? '').trim()
  const c = raw.toLowerCase()
  if (!c) return 'Other'
  if (c.includes('google') || c.includes('youtube')) return 'Google Ads'
  if (c.includes('meta') || c.includes('facebook') || c.includes('instagram') || c === 'fb' || c === 'ig') return 'Meta Ads'
  if (c.includes('tiktok')) return 'TikTok Ads'
  return raw
}

export const costPerLead = (spent: number, leads: number) =>
  leads > 0 ? 'RM ' + (spent / leads).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'

// Reuse the existing pill colours (globals.css) instead of adding new CSS:
// running = blue (like "active"), planned = amber (like "draft"), ended = green.
export function pillFor(status: string | null | undefined): string {
  const s = (status || '').toLowerCase()
  if (s === 'running') return 'active'
  if (s === 'planned') return 'draft'
  if (s === 'ended') return 'done'
  return s
}
