// 👉 THIS FILE IS YOURS TO EDIT — the Head of Finance's knobs. The first head of
// your AI C-Suite (docs/ai-csuite-blueprint.md).
//
// The 4-knob framework, filled in for Mama Lek:
//   WHEN       — any of the 4 lines below is crossed (checked every morning at 9am)
//   LOOK AT    — daily_sales, purchases, monthly_pnl and monthly_costs
//   SUGGEST    — ONE recommendation a day, the biggest RM problem first (prompt.ts)
//   ASK BEFORE — anything happens. Approve = add a task + hand you a draft message.
//                It never sends the message itself, never moves money, never deletes.
//
// Raise or lower a line here to turn the dial. The maths lives in lib/finance-head.ts.

export const FINANCE_HEAD = {
  key: 'finance-head',
  when: 'daily' as const,

  // 👉 Sales drop: yesterday is this much below the average of the last 4 same weekdays.
  salesDropPct: 15,

  // 👉 Supplier spend jump: last 30 days vs that supplier's average 30 days before
  //    (the 90 days before that). Both lines must be crossed.
  supplierJumpPct: 20,
  supplierJumpRM: 500,

  // 👉 Monthly cost alarm: the last month with a TMS report.
  labourLinePct: 22,
  foodLinePct: 28,

  // 👉 Buying too much: last 30 days of purchases as a % of last 30 days of sales.
  buyingLinePct: 33,

  // Next upgrade, not live yet: needs a wastage log first.
  wastageLinePct: 3,

  // Days you get to act on the task it adds.
  taskDueDays: 2,
}
