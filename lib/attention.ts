import 'server-only'
import { supabase } from './supabase'
import { rm } from './records'
import { FOOD_TARGET, topSuppliers, type MonthFood } from './home'
import { leaveBoard } from './leaves'
import { daysUntil } from './subscriptions'

// "Needs your attention" on the homepage. Each item is one short line with the money
// in **bold**, and opens the page that fixes it. Checks that fail just drop out.

export type Attention = { icon: string; text: string; href: string; group: string }

const ymAdd = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}
const dayAdd = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const pct = (n: number) => `${n.toFixed(1)}%`
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

async function safe<T>(f: () => Promise<T>): Promise<T | null> {
  try { return await f() } catch (e) { console.error('[CFO] attention check failed:', e); return null }
}

export async function attentionItems(today: string, food: MonthFood[]): Promise<Attention[]> {
  const out: Attention[] = []
  const nowIso = new Date().toISOString()
  const month = today.slice(0, 7)
  const dayNo = Number(today.slice(8, 10))

  // ---- Bills
  await safe(async () => {
    const { data } = await supabase.from('agent_actions').select('agent_key, expires_at')
      .eq('status', 'proposed').in('agent_key', ['stock-receipt', 'stock-draft', 'expense', 'vault', 'stock-price']).gt('expires_at', nowIso)
    const rows = data ?? []
    const cards = rows.filter(r => r.agent_key !== 'stock-draft' && r.agent_key !== 'stock-price').length
    const questions = rows.filter(r => r.agent_key === 'stock-draft').length
    const soon = rows.filter(r => Date.parse(r.expires_at) - Date.now() < 12 * 3_600_000).length
    if (cards || questions) {
      out.push({
        icon: '🧾', group: 'Bills', href: '/approvals',
        text: `**${plural(cards + questions, 'bill')} waiting on you**: ${cards} to approve, ${questions} with a question.${soon ? ` **${soon} expire within 12 hours.**` : ''}`,
      })
    }
    const prices = rows.filter(r => r.agent_key === 'stock-price').length
    if (prices) out.push({ icon: '🔺', group: 'Stock', href: '/approvals', text: `**${plural(prices, 'price rise')}** from suppliers waiting for your OK.` })
  })

  // ---- People
  const board = await safe(() => leaveBoard(today))
  if (board) {
    if (board.pending.length) {
      out.push({ icon: '🌴', group: 'People', href: '/?tab=leaves', text: `**${plural(board.pending.length, 'leave request')}** waiting for approval.` })
    }
    const zero = board.rows.filter(r => r.annualLeft !== null && r.annualLeft <= 0).map(r => r.name)
    if (zero.length) {
      out.push({ icon: '🧑‍🍳', group: 'People', href: '/?tab=leaves', text: `**${plural(zero.length, 'staff')} have 0 annual leave left**: ${zero.slice(0, 5).join(', ')}${zero.length > 5 ? '…' : ''}.` })
    }
  }
  await safe(async () => {
    const y = dayAdd(today, -1)
    const { data } = await supabase.from('punches').select('user_id, kind, punched_at, app_users!punches_user_id_fkey(name)')
      .gte('punched_at', `${y}T00:00:00+08:00`).lt('punched_at', `${today}T00:00:00+08:00`).order('punched_at')
    const last = new Map<number, { kind: string; name: string }>()
    for (const p of data ?? []) last.set(p.user_id, { kind: p.kind, name: (p.app_users as any)?.name ?? `#${p.user_id}` })
    const open = [...last.values()].filter(v => v.kind !== 'out').map(v => v.name)
    if (open.length) out.push({ icon: '⏰', group: 'People', href: '/team/history', text: `**${plural(open.length, 'staff')} didn't clock out** yesterday: ${open.join(', ')}.` })
  })
  await safe(async () => {
    const { data } = await supabase.from('hr_people').select('full_name').is('staff_no', null).not('user_id', 'is', null).neq('employment_status', 'left')
    const names = (data ?? []).map(p => p.full_name)
    if (names.length) out.push({ icon: '🆕', group: 'People', href: '/hr/people', text: `**${plural(names.length, 'new sign-up')}** need an HR number: ${names.slice(0, 4).join(', ')}.` })
  })

  // ---- Admin
  await safe(async () => {
    const { data } = await supabase.from('subscriptions').select('name, amount, currency, next_renewal').eq('active', true)
    for (const s of data ?? []) {
      const d = daysUntil(s.next_renewal, today)
      if (d >= 0 && d <= 14) {
        const amt = s.currency === 'MYR' ? rm(Number(s.amount)) : `${s.currency} ${Number(s.amount).toLocaleString('en-MY')}`
        out.push({ icon: '💳', group: 'Admin', href: '/subscriptions', text: `**${s.name}** renews ${d === 0 ? '**today**' : `in **${plural(d, 'day')}**`} (${amt}).` })
      }
    }
  })
  await safe(async () => {
    const last = ymAdd(month, -1)
    if (dayNo >= 3) {
      const { data } = await supabase.from('monthly_costs').select('labour').eq('month', last).gt('labour', 0).maybeSingle()
      if (!data) out.push({ icon: '💼', group: 'Admin', href: `/flr?month=${last}`, text: `**${monthName(last)} salaries not keyed in yet**. FLR uses an estimate until they are.` })
    }
    if (dayNo >= 5) {
      const { data } = await supabase.from('stock_closed').select('month').eq('month', last).maybeSingle()
      if (!data) out.push({ icon: '📦', group: 'Admin', href: '/cogs', text: `**${monthName(last)} stock count not marked done**, so its food cost is still an estimate.` })
    }
  })
  await safe(async () => {
    const { data } = await supabase.from('daily_sales').select('sale_date').order('sale_date', { ascending: false }).limit(1)
    const lastSale = data?.[0]?.sale_date as string | undefined
    if (lastSale && lastSale < dayAdd(today, -2)) out.push({ icon: '🔌', group: 'Admin', href: '/report', text: `**POS sales last saved on ${dayLabel(lastSale)}**. The morning sync may have failed.` })
  })
  await safe(async () => {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'ai_alert_at').maybeSingle()
    const at = Date.parse(String((data?.value as any)?.at ?? ''))
    if (Number.isFinite(at) && Date.now() - at < 24 * 3_600_000) out.push({ icon: '🤖', group: 'Admin', href: '/subscriptions', text: `**The AI couldn't read bills** in the last 24 hours (credit or key problem). Check Anthropic billing.` })
  })

  // ---- Costs
  const counted = food.filter(f => f.counted && f.pct !== null)
  const lastCounted = counted[counted.length - 1]
  const before = counted[counted.length - 2]
  if (lastCounted?.pct != null) {
    if (lastCounted.pct > FOOD_TARGET) {
      const worth = ((lastCounted.pct - FOOD_TARGET) / 100) * lastCounted.sales
      out.push({ icon: '🥩', group: 'Costs', href: '/cogs', text: `**Food cost ${pct(lastCounted.pct)}** in ${monthName(lastCounted.month)}, over your ${FOOD_TARGET}% target. Back to ${FOOD_TARGET}% is worth about **${rm(Math.round(worth))}/month**.` })
    } else if (before?.pct != null && lastCounted.pct - before.pct >= 1) {
      out.push({ icon: '🥩', group: 'Costs', href: '/cogs', text: `**Food cost up to ${pct(lastCounted.pct)}** in ${monthName(lastCounted.month)}, from ${pct(before.pct)} in ${monthName(before.month)}.` })
    }
  }
  await safe(async () => {
    const prev = ymAdd(month, -1)
    const prevTo = `${prev}-${String(Math.min(dayNo, 28)).padStart(2, '0')}`
    const [{ data: a }, { data: b }] = await Promise.all([
      supabase.from('daily_sales').select('voids, discount').gte('sale_date', `${month}-01`).lte('sale_date', today),
      supabase.from('daily_sales').select('voids, discount').gte('sale_date', `${prev}-01`).lte('sale_date', prevTo),
    ])
    const sum = (rows: any[] | null, k: string) => (rows ?? []).reduce((s, r) => s + Number(r[k] || 0), 0)
    for (const [k, label, icon] of [['voids', 'Voided sales', '🧾'], ['discount', 'Discounts', '🏷️']] as const) {
      const now = sum(a, k), was = sum(b, k)
      if (was > 0 && now > was * 1.3 && now - was > 100) {
        out.push({ icon, group: 'Costs', href: '/?tab=ops', text: `**${label} up ${Math.round(((now - was) / was) * 100)}%**: ${rm(now)} this month vs ${rm(was)} by the same day last month. Worth asking FOH why.` })
      }
    }
  })

  // ---- Sales drops: a day in the last week clearly below its usual weekday
  await safe(async () => {
    const from = dayAdd(today, -35)
    const { data } = await supabase.from('daily_sales').select('sale_date, net_sales').gte('sale_date', from).lt('sale_date', today)
    const rows = data ?? []
    const drops: string[] = []
    for (let i = 1; i <= 7 && drops.length < 2; i++) {
      const d = dayAdd(today, -i)
      const row = rows.find(r => r.sale_date === d)
      if (!row) continue
      const same = [7, 14, 21, 28].map(k => rows.find(r => r.sale_date === dayAdd(d, -k))).filter(Boolean).map(r => Number(r!.net_sales))
      if (same.length < 2) continue
      const usual = same.reduce((s, v) => s + v, 0) / same.length
      const now = Number(row.net_sales)
      if (usual > 0 && now < usual * 0.75) {
        drops.push(`**${dayLabel(d)} sales ${rm(now)}**, ${Math.round((1 - now / usual) * 100)}% below a usual ${dayLabel(d).split(' ')[0]} (${rm(Math.round(usual))}).`)
      }
    }
    for (const t of drops) out.push({ icon: '📉', group: 'Sales', href: '/?tab=sales', text: t })
  })

  // ---- Suppliers: spend well above the same point last month
  await safe(async () => {
    const top = await topSuppliers(today, 10)
    const jumps = top.filter(s => s.before > 0 && s.now > s.before * 1.3 && s.now - s.before > 1500).slice(0, 2)
    for (const s of jumps) {
      out.push({ icon: '📦', group: 'Stock', href: '/suppliers', text: `**${s.supplier} spend up ${Math.round(((s.now - s.before) / s.before) * 100)}%**: ${rm(s.now)} this month vs ${rm(s.before)} by the same day last month. Price or more stock-in?` })
    }
  })

  return out
}
