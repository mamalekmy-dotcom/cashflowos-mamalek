import 'server-only'
import { supabase } from './supabase'
import { tellOwners } from './notify'
import { rm, todayISO } from './records'

// Paid services and servers the shop depends on, and when each renews. The daily cron
// reminds the owners and the team group 14 days, 3 days and on the day, then moves the
// date on by the cycle and reminds them to send in the invoice for the claim.

export type Cycle = 'monthly' | 'yearly' | 'once'
export type Subscription = {
  id: number
  name: string
  amount: number
  currency: string
  cycle: Cycle
  next_renewal: string
  where_invoice: string | null
  notes: string | null
  active: boolean
  reminded: string[]
}

export const STAGES = [14, 3, 0] as const

export const daysUntil = (date: string, today: string) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)

export function nextDate(date: string, cycle: Cycle): string {
  const [y, m, d] = date.split('-').map(Number)
  const months = cycle === 'yearly' ? 12 : 1
  // Clamp to the month's last day, so 31 Jan rolls to 28/29 Feb, not 3 Mar.
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10)
}

export const money = (s: Pick<Subscription, 'amount' | 'currency'>) =>
  s.currency === 'MYR' ? rm(Number(s.amount)) : `${s.currency} ${Number(s.amount).toLocaleString('en-MY')}`

export async function listSubscriptions(): Promise<Subscription[]> {
  const { data, error } = await supabase.from('subscriptions').select('*').order('active', { ascending: false }).order('next_renewal')
  if (error) throw new Error(error.message)
  return (data ?? []) as Subscription[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const shown = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

// Run once a day. A stage already sent for this renewal date isn't sent again, and a
// stage missed (the cron didn't run that day) is sent late rather than skipped.
export async function sendRenewalReminders(today = todayISO()): Promise<{ sent: number; rolled: number }> {
  const subs = (await listSubscriptions()).filter(s => s.active)
  let sent = 0
  let rolled = 0
  for (const s of subs) {
    const days = daysUntil(s.next_renewal, today)
    if (days < 0) {
      // Renewed. Move to the next date (a one-off just stops).
      if (s.cycle === 'once') {
        await supabase.from('subscriptions').update({ active: false }).eq('id', s.id)
      } else {
        let next = s.next_renewal
        while (daysUntil(next, today) < 0) next = nextDate(next, s.cycle)
        await supabase.from('subscriptions').update({ next_renewal: next, reminded: [] }).eq('id', s.id)
        await tellOwners(
          `🧾 <b>${esc(s.name)}</b> renewed on ${shown(s.next_renewal)} (${money(s)}).\n` +
            `For your claim: download the invoice${s.where_invoice ? ` from ${esc(s.where_invoice)}` : ''} and send it to me, so it goes into the Management Report.\n` +
            `Next renewal: ${shown(next)}.`,
        )
        sent++
      }
      rolled++
      continue
    }
    const due = STAGES.filter(stage => days <= stage && !s.reminded.includes(`${s.next_renewal}:${stage}`))
    if (!due.length) continue
    const stage = Math.min(...due) // the closest one; earlier stages missed aren't all sent at once
    const when = days === 0 ? '<b>TODAY</b>' : `in <b>${days} day${days === 1 ? '' : 's'}</b> (${shown(s.next_renewal)})`
    await tellOwners(
      `⏰ <b>${esc(s.name)}</b> renews ${when}: ${money(s)}, ${s.cycle === 'once' ? 'one-off' : s.cycle}.\n` +
        (days === 0
          ? `Make sure the card has enough. After it charges, download the invoice${s.where_invoice ? ` from ${esc(s.where_invoice)}` : ''} for your claim.`
          : `Not needed any more? Cancel it before then.`) +
        (s.notes ? `\nNote: ${esc(s.notes)}` : ''),
      true,
    )
    await supabase.from('subscriptions').update({ reminded: [...s.reminded, ...due.map(d => `${s.next_renewal}:${d}`)] }).eq('id', s.id)
    sent++
  }
  return { sent, rolled }
}
