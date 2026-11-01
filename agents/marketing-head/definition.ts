// 👉 Marketing lane (owner: Calixto95). The Head of Marketing 📣 — filled from my
// AI C-Suite canvas. Recommend-only: it reads, reports and flags; it never spends,
// publishes or messages anyone. The daily sweep that turns these knobs into
// proposals lives in check.ts; the words live in prompt.ts.

import type { Rec } from '@/lib/records'

// WHEN: 'daily' — the existing morning cron sweeps it (no new cron). The full spend
// report only goes out on Mondays; the flags can fire any day.
export const when = 'daily' as const
export const REPORT_WEEKDAY = 1 // 0 = Sunday … 1 = Monday

// LOOK AT: ad campaigns (the Marketing tab rows). Leads/content are read by the
// report for context only.
export const lookAt = (rows: Rec[]) => rows.filter((r) => r.category === 'campaign')
export const isRunning = (r: Rec) => (r.status || '').toLowerCase() === 'running'

// The flag thresholds — the numbers in my WHEN.
export const NEAR_BUDGET = 0.8     // spent ≥ 80% of budget
export const CPL_SPIKE = 1.5       // cost per lead ≥ 1.5× the average across campaigns
export const ENDING_SOON_DAYS = 3  // a running campaign ends within 3 days
export const PROMO_LOOKAHEAD = 14  // a festival is within 14 days and has no campaign

// ASK-BEFORE: always. Every proposal starts 🟡 so a human reads it first. These are
// reports and drafts only, so the Boss can later promote them to 🟢 (auto: true in
// check.ts) — but spending or publishing can never be promoted: the executor for this
// agent is draftOnly, which has no way to spend, post or send.
export const askBefore = (_row?: Rec) => true

// The festivals the promo-calendar flag watches. Moveable dates (Raya, CNY,
// Deepavali) are the expected dates — check them each year.
export const PROMOS: { name: string; date: string }[] = [
  { name: 'Deepavali', date: '2026-11-08' },
  { name: 'Christmas', date: '2026-12-25' },
  { name: 'Chinese New Year', date: '2027-02-06' },
  { name: 'Hari Raya Aidilfitri', date: '2027-03-10' },
  { name: 'Merdeka', date: '2027-08-31' },
  { name: 'Malaysia Day', date: '2027-09-16' },
  { name: 'Christmas', date: '2027-12-25' },
]
