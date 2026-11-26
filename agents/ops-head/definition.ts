// 👉 THIS FILE IS YOURS TO EDIT — the Head of Ops's lines. Raise or lower a number to
// turn the dial. The maths lives in lib/ops-head.ts.
//
//   WHEN       — any line below is crossed (checked every morning at 9am)
//   LOOK AT    — clock-in punches, bills waiting for approval, leave requests, food cost
//   SUGGEST    — ONE recommendation a day, the biggest problem first
//   ASK BEFORE — everything. Approve = a task + a draft message. It never sends.

export const OPS_HEAD = {
  key: 'ops-head',
  emoji: '⚙️',
  name: 'Ops',

  // Late clock-ins (more than 10 min after the shift starts) in the last 7 days.
  lateLine: 3,
  // Clock-ins with no GPS fix in the last 7 days.
  noGpsLine: 3,
  // Shifts left open (no clock-out) on any day before today, last 7 days.
  missingOutLine: 1,
  // Bills waiting for an owner's Approve for more than this many days.
  billWaitDays: 2,
  // Leave still pending this many days before it starts.
  leaveWarnDays: 3,
  // Food cost % this month (estimate until the stock count) vs the target.
  foodTargetPct: 30,

  // Days you get to act on the task it adds.
  taskDueDays: 2,
}
