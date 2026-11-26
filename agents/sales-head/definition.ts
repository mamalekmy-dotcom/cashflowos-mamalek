// 👉 THIS FILE IS YOURS TO EDIT — the Head of Sales's lines. The maths lives in
// lib/sales-head.ts.
//
//   WHEN       — any line below is crossed (checked every morning at 9am)
//   LOOK AT    — POS daily sales: nett, receipts, pax
//   SUGGEST    — ONE recommendation a day, the biggest RM first
//   ASK BEFORE — everything. Approve = a task + a draft message. It never sends.

export const SALES_HEAD = {
  key: 'sales-head',
  emoji: '🎯',
  name: 'Sales',

  // This week so far vs the same days last week.
  weekDropPct: 10,
  // Spend per customer (nett ÷ pax), last 7 days vs the 28 days before.
  spendDropPct: 5,
  // This month's pace (average per open day) vs last month.
  monthDropPct: 8,
  // A weekday that sells this much below the average open day (last 4 weeks).
  slowDayPct: 20,

  taskDueDays: 3,
}
