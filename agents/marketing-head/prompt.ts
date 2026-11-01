// 👉 SUGGEST knob — the words the Head of Marketing puts in front of the human.
// Every one is a recommendation or a draft. None of them spends, posts or sends.

import type { Rec } from '@/lib/records'
import { m, rm } from '@/lib/records'

// Spend/leads live in meta (same fields the Marketing tab uses).
export const num = (v: unknown) => {
  const n = Number(String(v ?? 0).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
export const spentOf = (r: Rec) => num(r.meta?.spent)
export const leadsOf = (r: Rec) => num(r.meta?.leads)
export const cpl = (spent: number, leads: number) => (leads > 0 ? spent / leads : null)
export const rm2 = (n: number) =>
  'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function channelOf(r: Rec): string {
  const raw = m(r, 'channel')
  if (raw === '—') return 'Other'
  const c = String(raw).toLowerCase()
  if (/google|youtube/.test(c)) return 'Google Ads'
  if (/meta|facebook|instagram|\bfb\b|\big\b/.test(c)) return 'Meta Ads'
  if (/tiktok/.test(c)) return 'TikTok Ads'
  return String(raw)
}

export type ChannelLine = { channel: string; spent: number; leads: number }

export function weeklyReport(lines: ChannelLine[], worst: string | null, upcoming: string[]): string {
  const body = lines
    .map((l) => {
      const c = cpl(l.spent, l.leads)
      return `• ${l.channel}: ${rm(l.spent)} spent, ${l.leads} leads, ${c === null ? 'no leads yet' : rm2(c) + ' per lead'}`
    })
    .join('\n')
  return (
    `📣 <b>Weekly ad spend</b>\n${body}` +
    (worst ? `\n\n⚠️ Costliest channel: <b>${worst}</b> — worth a look before adding budget.` : '') +
    (upcoming.length ? `\n\n🗓️ Coming up: ${upcoming.join(', ')} — want post/ad drafts?` : '') +
    `\n\nReport only. Nothing was spent or posted.`
  )
}

export const nearBudget = (r: Rec, spent: number) =>
  `💰 <b>${r.title}</b> has used ${Math.round((spent / r.amount) * 100)}% of its budget ` +
  `(${rm(spent)} of ${rm(r.amount)}). Recommend: decide whether to let it finish or add budget. ` +
  `Adding budget needs your YES in the ad platform — I won't touch it.`

export const cplSpike = (r: Rec, mine: number, avg: number) =>
  `📈 <b>${r.title}</b> (${channelOf(r)}) costs ${rm2(mine)} per lead vs ${rm2(avg)} average. ` +
  `Recommend: check the targeting or creative, or pause it. Pausing is your call in the ad platform.`

export const endingSoon = (r: Rec, days: number) =>
  `⏳ <b>${r.title}</b> ends ${days === 0 ? 'today' : 'in ' + days + ' day' + (days > 1 ? 's' : '')}` +
  ` (${leadsOf(r)} leads so far). Recommend: let it end, or extend — extending is spend, so it's your YES.`

export const promoDraft = (name: string, date: string, days: number) =>
  `🗓️ <b>${name}</b> is in ${days} days (${date}) and there's no campaign for it yet.\n\n` +
  `Draft post idea: "Celebrate ${name} with Mama Lek! 🎉 Order your festive set early — ` +
  `limited slots this week." Draft only — a human edits and posts it.`
