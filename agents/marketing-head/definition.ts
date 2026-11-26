// 👉 THIS FILE IS YOURS TO EDIT — the Head of Marketing's lines. The maths lives in
// lib/marketing-head.ts.
//
//   WHEN       — any line below is crossed (checked every morning at 9am)
//   LOOK AT    — marketing spend (agency/ads bills + Expenses), POS customers, discounts, reviews
//   SUGGEST    — ONE recommendation a day, the biggest RM first
//   ASK BEFORE — everything. Approve = a task + a draft message. It never sends.

export const MARKETING_HEAD = {
  key: 'marketing-head',
  emoji: '📣',
  name: 'Marketing',

  // Marketing spend as % of sales (this month, or last month when this one has none).
  spendLinePct: 5,
  // With money spent on marketing, customers a day should rise at least this much vs the month before.
  paxLiftPct: 0,
  // Discounts given as % of sales, last 30 days.
  discountLinePct: 3,
  // Google reviews collected a month through the review link.
  reviewsPerMonth: 10,

  taskDueDays: 3,
}
