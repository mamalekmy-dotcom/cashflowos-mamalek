import 'server-only'
import { supabase, supabaseConfigured } from './supabase'
import { rm as rmExact } from './records'
import { billedExpenses } from './expenses'
import { MARKETING_HEAD as K } from '@/agents/marketing-head/definition'
import { addDays, headCheck, pct, readAll, sum, type Alarm, type Reading, type Readout } from './heads'

// The Head of Marketing: is the marketing money bringing more customers? Spend as % of
// sales, customers a day vs the month before, discounts given away, and Google reviews.

type Day = { sale_date: string; net_sales: number; pax: number; discount: number }
const rm = (n: number) => rmExact(Math.round(n))
const MARKETING = /market|ads?\b|advert|agency|promo|social|influenc/i
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })
const shift = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7) }
const endOf = (ym: string) => addDays(`${shift(ym, 1)}-01`, -1)

async function spendIn(month: string): Promise<number> {
  const [{ data: typed }, billed] = await Promise.all([
    supabase.from('monthly_expenses').select('amount, expense_categories(name)').eq('month', month),
    billedExpenses(`${month}-01`, endOf(month)),
  ])
  const keyed = sum((typed ?? []).filter(r => MARKETING.test((r.expense_categories as unknown as { name: string } | null)?.name ?? '')).map(r => Number(r.amount)))
  const bills = sum(billed.filter(b => MARKETING.test(b.expense)).map(b => b.amount))
  return keyed + bills
}

export async function marketingReadout(today: string): Promise<Readout> {
  const readings: Reading[] = []
  const alarms: Alarm[] = []
  if (!supabaseConfigured) return { readings, alarms }
  const month = addDays(today, -1).slice(0, 7)
  const prev = shift(month, -1), prev2 = shift(month, -2)

  const [days, spendNow, spendPrev, { data: links }, { count: reviews }] = await Promise.all([
    readAll<Day>((a, b) => supabase.from('daily_sales').select('sale_date, net_sales, pax, discount').gte('sale_date', `${prev2}-01`).lt('sale_date', today).order('sale_date').range(a, b)),
    spendIn(month),
    spendIn(prev),
    supabase.from('review_links').select('id'),
    supabase.from('review_events').select('id', { count: 'exact', head: true }).gte('created_at', `${month}-01T00:00:00+08:00`),
  ])
  const open = days.filter(d => Number(d.net_sales) > 0)
  const inMonth = (m: string) => open.filter(d => d.sale_date.startsWith(m))
  const salesOf = (m: string) => sum(inMonth(m).map(d => Number(d.net_sales)))
  const paxDay = (m: string) => { const ds = inMonth(m); return ds.length ? sum(ds.map(d => Number(d.pax))) / ds.length : null }

  // ① Marketing spend as % of sales.
  const useNow = spendNow > 0
  const spendMonth = useNow ? month : prev
  const spend = useNow ? spendNow : spendPrev
  const sales = salesOf(spendMonth)
  if (spend > 0 && sales > 0) {
    const share = (spend / sales) * 100
    const firing = share > K.spendLinePct
    readings.push({ kind: 'spend', label: `Marketing spend ${monthName(spendMonth)}`, value: `${rm(spend)} · ${pct(share)} of sales`, line: `${K.spendLinePct}%`, state: firing ? 'firing' : 'ok' })
    if (firing) {
      alarms.push({
        key: `${K.key}:spend:${spendMonth}`, kind: 'spend', impact: ((share - K.spendLinePct) / 100) * sales,
        s: {
          title: `Marketing ${pct(share)} of sales in ${monthName(spendMonth)}`,
          why: `${rm(spend)} on ${rm(sales)} sales. Line: ${K.spendLinePct}%.`,
          suggest: 'Ask the agency for results per post/ad (reach, clicks, walk-ins) before paying the next invoice.',
          task: 'Get the agency results report before the next payment',
          to: 'The Lit Social',
          draft: `Hi, before our next invoice could you send the results for ${monthName(spendMonth)}: reach, engagement, clicks to WhatsApp/Maps, and which posts did best? We'd like to see what's bringing customers in. Thanks! — Eric, Mama Lek`,
        },
      })
    }
  } else readings.push({ kind: 'spend', label: 'Marketing spend', value: 'None filed this or last month', line: `${K.spendLinePct}%`, state: 'nodata' })

  // ② Customers a day vs the month before, when money was spent.
  const pNow = paxDay(month), pPrev = paxDay(prev)
  if (pNow != null && pPrev != null && inMonth(month).length >= 5) {
    const lift = (pNow / pPrev - 1) * 100
    const firing = spend > 0 && lift <= K.paxLiftPct
    readings.push({ kind: 'pax', label: 'Customers a day vs last month', value: `${pNow.toFixed(0)} vs ${pPrev.toFixed(0)} (${lift >= 0 ? '+' : ''}${lift.toFixed(0)}%)`, line: spend > 0 ? 'should rise' : '—', state: firing ? 'firing' : 'ok' })
    if (firing) {
      const perPax = salesOf(month) / Math.max(1, sum(inMonth(month).map(d => Number(d.pax))))
      alarms.push({
        key: `${K.key}:pax:${month}`, kind: 'pax', impact: Math.max(spend * 0.5, (pPrev - pNow) * perPax * 26 * 0.5),
        s: {
          title: `Marketing spent, customers not up`,
          why: `${rm(spend)} spent; ${pNow.toFixed(0)} customers a day vs ${pPrev.toFixed(0)} in ${monthName(prev)}.`,
          suggest: 'Ask the agency to switch budget to an offer people can walk in with (e.g. show this post for a free drink) so we can count it.',
          task: 'Agree a trackable offer with the agency',
          to: 'The Lit Social',
          draft: `Hi, customer numbers haven't moved this month (${pNow.toFixed(0)}/day vs ${pPrev.toFixed(0)}). Can we run a trackable offer next, e.g. "show this post for a free drink", so we can count walk-ins from the ads? Thanks! — Eric`,
        },
      })
    }
  } else readings.push({ kind: 'pax', label: 'Customers a day vs last month', value: 'Not enough days yet', line: '—', state: 'nodata' })

  // ③ Discounts given away, last 30 days.
  const last30 = open.filter(d => d.sale_date >= addDays(today, -30))
  const disc = sum(last30.map(d => Number(d.discount))), s30 = sum(last30.map(d => Number(d.net_sales)))
  if (s30 > 0) {
    const share = (disc / s30) * 100
    const firing = share > K.discountLinePct
    readings.push({ kind: 'discount', label: 'Discounts (30 days)', value: `${rm(disc)} · ${pct(share)}`, line: `${K.discountLinePct}%`, state: firing ? 'firing' : 'ok' })
    if (firing) {
      alarms.push({
        key: `${K.key}:discount:${today.slice(0, 7)}`, kind: 'discount', impact: ((share - K.discountLinePct) / 100) * s30,
        s: {
          title: `Discounts ${pct(share)} of sales`,
          why: `${rm(disc)} given away in 30 days. Line: ${K.discountLinePct}%.`,
          suggest: 'Check which discounts are used and stop any that no longer bring people in.',
          task: 'Review discount codes in the POS',
          to: 'Outlet Manager',
          draft: `Hi, we gave ${rm(disc)} in discounts in the last 30 days (${pct(share)} of sales). Which discounts are staff using most? Please don't give any discount without a code from now on.`,
        },
      })
    }
  } else readings.push({ kind: 'discount', label: 'Discounts', value: 'No sales yet', line: `${K.discountLinePct}%`, state: 'nodata' })

  // ④ Google reviews collected through the review link.
  if ((links ?? []).length) {
    const n = reviews ?? 0
    const day = Number(today.slice(8, 10))
    const firing = day >= 15 && n < K.reviewsPerMonth / 2
    readings.push({ kind: 'reviews', label: `Reviews in ${monthName(month)}`, value: `${n}`, line: `${K.reviewsPerMonth}/month`, state: firing ? 'firing' : 'ok' })
    if (firing) {
      alarms.push({
        key: `${K.key}:reviews:${month}`, kind: 'reviews', impact: 200,
        s: {
          title: `Only ${n} reviews this month`,
          why: `Target ${K.reviewsPerMonth} a month. Reviews bring new customers from Google Maps for free.`,
          suggest: 'Ask FOH to show the review QR at payment to every happy table.',
          task: 'FOH: show the review QR at every payment',
          to: 'FOH Supervisor',
          draft: `Hi, we only got ${n} Google reviews this month. When a table is happy, please show them the review QR at payment. Thanks!`,
        },
      })
    }
  } else readings.push({ kind: 'reviews', label: 'Google reviews', value: 'No review link set up yet', line: `${K.reviewsPerMonth}/month`, state: 'nodata' })

  alarms.sort((a, b) => b.impact - a.impact)
  return { readings, alarms }
}

export const marketingCheck = async (today: string) => headCheck(K, await marketingReadout(today), today)
