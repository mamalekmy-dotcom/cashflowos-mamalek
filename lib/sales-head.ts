import 'server-only'
import { supabase, supabaseConfigured } from './supabase'
import { rm as rmExact } from './records'
import { SALES_HEAD as S } from '@/agents/sales-head/definition'
import { addDays, headCheck, pct, readAll, sum, weekdayName, type Alarm, type Reading, type Readout } from './heads'

// The Head of Sales: week vs last week, spend per customer, this month's pace, and the
// slow weekday. Reads the POS daily sales only (dine-in vs GrabFood isn't split yet).

type Day = { sale_date: string; net_sales: number; receipts: number; pax: number; delivery: number }
const rm = (n: number) => rmExact(Math.round(n))
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })

export async function salesReadout(today: string): Promise<Readout> {
  const readings: Reading[] = []
  const alarms: Alarm[] = []
  if (!supabaseConfigured) return { readings, alarms }
  const days = await readAll<Day>((a, b) => supabase.from('daily_sales').select('sale_date, net_sales, receipts, pax, delivery')
    .gte('sale_date', addDays(today, -70)).lt('sale_date', today).order('sale_date').range(a, b))
  const open = days.filter(d => Number(d.net_sales) > 0)
  const on = new Map(open.map(d => [d.sale_date, d]))
  const nett = (d?: Day) => Number(d?.net_sales ?? 0)

  // ① This week so far (Mon → yesterday) vs the same days last week.
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7 // Mon = 0
  const monday = addDays(today, -dow)
  const thisWeek = Array.from({ length: dow }, (_, i) => addDays(monday, i))
  if (thisWeek.length) {
    const now = sum(thisWeek.map(d => nett(on.get(d))))
    const before = sum(thisWeek.map(d => nett(on.get(addDays(d, -7)))))
    if (before > 0) {
      const drop = (1 - now / before) * 100
      const firing = drop >= S.weekDropPct
      readings.push({ kind: 'week', label: 'This week vs last week', value: `${rm(now)} vs ${rm(before)} (${drop >= 0 ? '−' : '+'}${Math.abs(drop).toFixed(0)}%)`, line: `${S.weekDropPct}% down`, state: firing ? 'firing' : 'ok' })
      if (firing) {
        alarms.push({
          key: `${S.key}:week:${monday}`, kind: 'week', impact: before - now,
          s: {
            title: `Sales down ${drop.toFixed(0)}% this week`,
            why: `${rm(now)} so far vs ${rm(before)} on the same days last week. ${rm(before - now)} less.`,
            suggest: 'Push a weekday deal on WhatsApp/IG for the rest of the week, and ask the floor what customers say.',
            task: 'Run a quick weekday push for the rest of this week',
            to: 'Outlet team',
            draft: `Team, sales this week are ${drop.toFixed(0)}% below last week. Let's push: recommend the set meal + drink to every table, and tell me anything customers complain about. Thanks!`,
          },
        })
      }
    } else readings.push({ kind: 'week', label: 'This week vs last week', value: 'No sales last week', line: `${S.weekDropPct}% down`, state: 'nodata' })
  } else readings.push({ kind: 'week', label: 'This week vs last week', value: 'Week just started', line: `${S.weekDropPct}% down`, state: 'nodata' })

  // ② Spend per customer, last 7 days vs the 28 days before.
  const recent = open.filter(d => d.sale_date >= addDays(today, -7))
  const earlier = open.filter(d => d.sale_date < addDays(today, -7) && d.sale_date >= addDays(today, -35))
  const perPax = (ds: Day[]) => { const p = sum(ds.map(d => Number(d.pax))); return p > 0 ? sum(ds.map(nett)) / p : null }
  const a = perPax(recent), b = perPax(earlier)
  if (a != null && b != null) {
    const drop = (1 - a / b) * 100
    const firing = drop >= S.spendDropPct
    const pax7 = sum(recent.map(d => Number(d.pax)))
    readings.push({ kind: 'spend', label: 'Spend per customer', value: `RM ${a.toFixed(2)} vs RM ${b.toFixed(2)}`, line: `${S.spendDropPct}% down`, state: firing ? 'firing' : 'ok' })
    if (firing) {
      alarms.push({
        key: `${S.key}:spend:${today.slice(0, 7)}`, kind: 'spend', impact: (b - a) * pax7,
        s: {
          title: `Spend per customer down ${drop.toFixed(0)}%`,
          why: `RM ${a.toFixed(2)} a head this week vs RM ${b.toFixed(2)} before. On ${pax7} customers that's ${rm((b - a) * pax7)} a week.`,
          suggest: 'Brief FOH to offer add-ons (extra beef, drinks, dessert) on every order.',
          task: 'FOH upsell briefing: add-ons on every order',
          to: 'FOH Supervisor',
          draft: `Hi, customers are spending less per head this week (RM ${a.toFixed(2)} vs RM ${b.toFixed(2)}). From today please offer an add-on with every order: extra beef, a drink or dessert. Thanks!`,
        },
      })
    }
  } else readings.push({ kind: 'spend', label: 'Spend per customer', value: 'No pax counts yet', line: `${S.spendDropPct}% down`, state: 'nodata' })

  // ③ This month's pace vs last month (average per open day).
  const month = addDays(today, -1).slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
  const avg = (ds: Day[]) => (ds.length ? sum(ds.map(nett)) / ds.length : null)
  const curDays = open.filter(d => d.sale_date.startsWith(month)), prevDays = open.filter(d => d.sale_date.startsWith(prev))
  const cur = avg(curDays), last = avg(prevDays)
  if (cur != null && last != null && curDays.length >= 5) {
    const drop = (1 - cur / last) * 100
    const firing = drop >= S.monthDropPct
    readings.push({ kind: 'month', label: `${monthName(month)} pace vs ${monthName(prev)}`, value: `${rm(cur)}/day vs ${rm(last)}/day`, line: `${S.monthDropPct}% down`, state: firing ? 'firing' : 'ok' })
    if (firing) {
      const gap = (last - cur) * 26
      alarms.push({
        key: `${S.key}:month:${month}`, kind: 'month', impact: gap / 4,
        s: {
          title: `${monthName(month)} running ${drop.toFixed(0)}% behind ${monthName(prev)}`,
          why: `${rm(cur)} a day vs ${rm(last)} last month. Over a month that's about ${rm(gap)}.`,
          suggest: 'Plan one promotion for the rest of the month with the Head of Marketing.',
          task: `Plan a promotion to close the ${monthName(month)} gap`,
          to: 'Su Ni',
          draft: `Su Ni, ${monthName(month)} is running ${drop.toFixed(0)}% behind ${monthName(prev)} (${rm(cur)}/day vs ${rm(last)}/day). Can we pick one promotion for the rest of the month this week?`,
        },
      })
    }
  } else readings.push({ kind: 'month', label: 'Month pace', value: 'Not enough days yet', line: `${S.monthDropPct}% down`, state: 'nodata' })

  // ④ The slow weekday, last 4 weeks.
  const four = open.filter(d => d.sale_date >= addDays(today, -28))
  if (four.length >= 12) {
    const byDow = new Map<string, number[]>()
    for (const d of four) { const w = weekdayName(d.sale_date); byDow.set(w, [...(byDow.get(w) ?? []), nett(d)]) }
    const all = sum(four.map(nett)) / four.length
    const [slowDay, vals] = [...byDow.entries()].map(([w, v]) => [w, sum(v) / v.length] as const).sort((x, z) => x[1] - z[1])[0]
    const below = (1 - vals / all) * 100
    const firing = below >= S.slowDayPct
    readings.push({ kind: 'slow', label: 'Slowest weekday (4 weeks)', value: `${slowDay} ${rm(vals)} vs avg ${rm(all)}`, line: `${S.slowDayPct}% below`, state: firing ? 'firing' : 'ok' })
    if (firing) {
      alarms.push({
        key: `${S.key}:slow:${slowDay}:${today.slice(0, 7)}`, kind: 'slow', impact: (all - vals) * 4 * 0.3,
        s: {
          title: `${slowDay}s sell ${below.toFixed(0)}% below average`,
          why: `${rm(vals)} on a ${slowDay} vs ${rm(all)} on an average day. Lifting it a third of the way is about ${rm((all - vals) * 4 * 0.3)} a month.`,
          suggest: `Try a ${slowDay}-only deal for 4 weeks and measure it.`,
          task: `Design a ${slowDay}-only deal`,
          to: 'Su Ni',
          draft: `Su Ni, ${slowDay}s are our weakest day (${rm(vals)} vs ${rm(all)} average). Shall we try a ${slowDay}-only deal for 4 weeks? Ideas: set lunch price, free drink, or a member promo.`,
        },
      })
    }
  } else readings.push({ kind: 'slow', label: 'Slowest weekday', value: 'Not enough weeks yet', line: `${S.slowDayPct}% below`, state: 'nodata' })

  // ⑤ Delivery share: needs the POS to split delivery out.
  const deliv = sum(recent.map(d => Number(d.delivery)))
  readings.push({ kind: 'grab', label: 'GrabFood share', value: deliv > 0 ? pct((deliv / sum(recent.map(nett))) * 100) : 'POS does not split delivery yet', line: '—', state: deliv > 0 ? 'ok' : 'nodata' })

  alarms.sort((x, z) => z.impact - x.impact)
  return { readings, alarms }
}

export const salesCheck = async (today: string) => headCheck(S, await salesReadout(today), today)
