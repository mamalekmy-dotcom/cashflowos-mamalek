// The Head of Marketing's daily sweep. Like every scheduled check it only RETURNS
// proposals — the cron creates them and a human decides. Idempotency keys are per
// row per week (per day for the report), so re-running the cron never duplicates.

import type { Rec } from '@/lib/records'
import type { ProposalDraft, ScheduledCheck } from '@/agents/registry'
import {
  ENDING_SOON_DAYS, NEAR_BUDGET, CPL_SPIKE, PROMO_LOOKAHEAD, PROMOS, REPORT_WEEKDAY,
  isRunning, lookAt,
} from './definition'
import {
  channelOf, cpl, cplSpike, endingSoon, leadsOf, nearBudget, promoDraft, spentOf, weeklyReport,
  type ChannelLine,
} from './prompt'

const KEY = 'marketing-head'
const DAY = 86_400_000
const daysUntil = (date: string, today: string) => Math.round((Date.parse(date) - Date.parse(today)) / DAY)

// The Monday of today's week, so a flag fires at most once a week per campaign.
function weekOf(today: string): string {
  const d = new Date(Date.parse(today))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

const draft = (idempotencyKey: string, text: string, channel = 'report'): ProposalDraft => ({
  idempotencyKey,
  payload: { channel, text: text.replace(/<\/?b>/g, '') },
  text,
})

export function marketingHeadCheck(rows: Rec[], today: string): ProposalDraft[] {
  const campaigns = lookAt(rows)
  const week = weekOf(today)
  const out: ProposalDraft[] = []

  // Average cost per lead across every campaign with leads — the spike baseline.
  const withLeads = campaigns.filter((r) => leadsOf(r) > 0)
  const avg = withLeads.length >= 2
    ? withLeads.reduce((s, r) => s + spentOf(r), 0) / withLeads.reduce((s, r) => s + leadsOf(r), 0)
    : null

  for (const r of campaigns.filter(isRunning)) {
    const spent = spentOf(r)
    if (r.amount > 0 && spent / r.amount >= NEAR_BUDGET) {
      out.push(draft(`${KEY}:budget:${r.id}:${week}`, nearBudget(r, spent)))
    }
    const mine = cpl(spent, leadsOf(r))
    if (avg && mine !== null && mine >= avg * CPL_SPIKE) {
      out.push(draft(`${KEY}:cpl:${r.id}:${week}`, cplSpike(r, mine, avg)))
    }
    if (r.due_date) {
      const left = daysUntil(r.due_date, today)
      if (left >= 0 && left <= ENDING_SOON_DAYS) {
        out.push(draft(`${KEY}:ending:${r.id}:${r.due_date}`, endingSoon(r, left)))
      }
    }
  }

  // Promo calendar: a festival soon with no campaign mentioning it → draft a post idea.
  const upcoming: string[] = []
  for (const p of PROMOS) {
    const left = daysUntil(p.date, today)
    if (left < 0 || left > PROMO_LOOKAHEAD) continue
    upcoming.push(`${p.name} (${p.date})`)
    const covered = campaigns.some((r) => r.title.toLowerCase().includes(p.name.toLowerCase()))
    if (!covered) out.push(draft(`${KEY}:promo:${p.name}:${p.date}`, promoDraft(p.name, p.date, left), 'post'))
  }

  // Weekly spend report — Mondays only, and only once there is something to report.
  if (new Date(Date.parse(today)).getUTCDay() === REPORT_WEEKDAY && campaigns.length) {
    const by = new Map<string, ChannelLine>()
    for (const r of campaigns) {
      const ch = channelOf(r)
      const line = by.get(ch) ?? { channel: ch, spent: 0, leads: 0 }
      line.spent += spentOf(r)
      line.leads += leadsOf(r)
      by.set(ch, line)
    }
    const lines = [...by.values()].sort((a, b) => b.spent - a.spent)
    // Costliest = highest cost per lead; money spent with zero leads counts as worst.
    const score = (l: ChannelLine) => (l.leads > 0 ? l.spent / l.leads : l.spent > 0 ? Infinity : -1)
    const worst = lines.length > 1 ? [...lines].sort((a, b) => score(b) - score(a))[0] : null
    out.push(draft(`${KEY}:report:${today}`, weeklyReport(lines, worst && score(worst) > 0 ? worst.channel : null, upcoming)))
  }

  return out
}

export const marketingHeadScheduled: ScheduledCheck = {
  key: KEY,
  label: 'Head of Marketing',
  check: marketingHeadCheck,
}
