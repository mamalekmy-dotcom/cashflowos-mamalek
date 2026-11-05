// 👉 THIS FILE IS YOURS TO EDIT — the SUGGEST knob: the words the Head of Finance
// writes. Each alarm gives you a recommendation, a task title and a draft message.
// The draft is for YOU to copy and send. Nothing here is ever sent on its own.

import { rm as rmExact } from '@/lib/records'
import { FINANCE_HEAD as F } from './definition'

export type Suggestion = { title: string; why: string; suggest: string; task: string; to: string; draft: string }

// Whole ringgit reads better in a message than RM 2,281.333.
const rm = (n: number) => rmExact(Math.round(n))
const pct = (n: number) => `${n.toFixed(1)}%`
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })

export function salesDrop(a: { date: string; actual: number; usual: number; dropPct: number }): Suggestion {
  const weekday = day(a.date).split(' ')[0]
  return {
    title: `Sales down ${a.dropPct.toFixed(0)}% on ${day(a.date)}`,
    why: `${rm(a.actual)} vs a usual ${weekday} of ${rm(a.usual)}. Line: ${F.salesDropPct}% below.`,
    suggest: 'Ask the outlet team what happened before it becomes a pattern.',
    task: `Find out why sales dropped on ${day(a.date)}`,
    to: 'Outlet team',
    draft:
      `Team, sales on ${day(a.date)} were ${rm(a.actual)}, about ${a.dropPct.toFixed(0)}% below a normal ${weekday} (${rm(a.usual)}). ` +
      `Anything happen? Rain, short staff, item 86, Grab offline, a complaint? Please reply by today. Thanks!`,
  }
}

// "PXL MARKETING SDN BHD (TAKEAWAY PACKAGING)" → "PXL Marketing", so it fits a phone screen.
const shortName = (s: string) =>
  s.replace(/\(.*?\)/g, '').replace(/\bSDN\.?\s*BHD\.?/gi, '').trim()
    .split(/\s+/).map(w => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase())).join(' ')

export function supplierJump(a: { supplier: string; recent: number; usual: number; upPct: number }): Suggestion {
  a = { ...a, supplier: shortName(a.supplier) || a.supplier }
  return {
    title: `${a.supplier} up ${a.upPct.toFixed(0)}%`,
    why: `${rm(a.recent)} in the last 30 days vs a usual ${rm(a.usual)}. That's ${rm(a.recent - a.usual)} more.`,
    suggest: 'Check whether their prices went up or we ordered more than we need.',
    task: `Check ${a.supplier} prices and order size (+${a.upPct.toFixed(0)}%)`,
    to: a.supplier,
    draft:
      `Hi ${a.supplier}, our bills from you in the last 30 days came to ${rm(a.recent)}, higher than our usual ${rm(a.usual)}. ` +
      `Could you send your latest price list so we can check if any prices changed? Thank you. — Eric, Mama Lek`,
  }
}

export function monthlyCost(a: { month: string; sales: number; labourPct: number | null; foodPct: number | null; over: string[] }): Suggestion {
  const labour = a.labourPct != null ? `labour ${pct(a.labourPct)} (line ${F.labourLinePct}%)` : null
  const food = a.foodPct != null ? `food cost ${pct(a.foodPct)} (line ${F.foodLinePct}%)` : null
  const overParts = [a.over.includes('labour') ? labour : null, a.over.includes('food cost') ? food : null].filter(Boolean)
  const checks = [a.over.includes('labour') ? 'the roster and overtime' : null, a.over.includes('food cost') ? 'portions on our top items' : null].filter(Boolean)
  const m = monthName(a.month)
  return {
    title: `${m}: ${a.over.join(' and ')} over the line`,
    why: `On ${rm(a.sales)} sales: ${[labour, food].filter(Boolean).join(', ')}.`,
    suggest: a.over.includes('labour')
      ? 'Sit down with Su Ni this week on the roster and overtime.'
      : 'Check portions and the top 5 items against the recipe book.',
    task: `Review ${m} ${a.over.join(' and ')} with Su Ni`,
    to: 'Su Ni',
    draft:
      `Su Ni, ${m} ${overParts.join(' and ')} on ${rm(a.sales)} sales. ` +
      `Can we look at it together this week? I'd like to check ${checks.join(' and ')}.`,
  }
}

export function buyingTooMuch(a: { bought: number; sales: number; buyPct: number }): Suggestion {
  return {
    title: `Buying ${pct(a.buyPct)} of sales`,
    why: `${rm(a.bought)} bought vs ${rm(a.sales)} sales in the last 30 days. Line: ${F.buyingLinePct}%.`,
    suggest: 'Hold orders to par levels this week and check stock before every order.',
    task: 'Hold orders to par levels this week',
    to: 'Eddy and BOH SPV',
    draft:
      `Eddy, in the last 30 days we bought ${rm(a.bought)}, which is ${pct(a.buyPct)} of sales (our line is ${F.buyingLinePct}%). ` +
      `This week please order only up to par, and check the freezer and store before every order. Thanks!`,
  }
}
