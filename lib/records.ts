import { supabase, supabaseConfigured } from './supabase'

// One row of the business spine. The whole app reads this single table.
// `meta` is a free-form bag of extra fields each tab can use (a lead's next
// follow-up, a content item's platform/format/views) — so we stay ONE table.
export type Rec = {
  id: number
  title: string
  status: string
  amount: number
  category: string | null
  due_date: string | null
  notes: string | null
  meta: Record<string, any>
  created_at: string
}

// The 7 categories that make up a complete generic business. Each tab owns one
// (or two, for the money tabs) so the numbers never bleed across tabs.
export const CATEGORIES = ['cash_in', 'cash_out', 'lead', 'customer', 'content', 'task', 'doc'] as const
export type Category = (typeof CATEGORIES)[number]

// The lead funnel stages, in order. A lead's `status` moves down this ladder.
// ('new' and 'contacted' are both "top of funnel" and count together as Leads.)
export const LEAD_STAGES = ['new', 'contacted', 'appointment', 'closed', 'nurture'] as const

// Every tab calls this, then filters in its own way.
export async function getRecords(): Promise<Rec[]> {
  // Before Supabase is wired (placeholder env), skip the fetch entirely — a bad
  // or unreachable URL otherwise hangs ~7s per request before failing. The
  // ConnStatus banner tells the user to add their keys. (Found in the live run.)
  if (!supabaseConfigured) return []
  const { data, error } = await supabase
    .from('records')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) console.warn('[CFO] could not read records:', error.message)
  // Default meta to {} so a row added before the meta column existed never crashes a tab.
  return (data ?? []).map(r => ({ ...r, meta: r.meta ?? {} })) as Rec[]
}

// Read one field out of a record's meta bag, with a dash fallback for display.
export const m = (r: Rec, k: string) => {
  const v = r.meta?.[k]
  return v === undefined || v === null || v === '' ? '—' : v
}

// Format a number as Malaysian Ringgit for display.
export const rm = (n: number) => 'RM ' + Number(n || 0).toLocaleString('en-MY')

// The business runs on Malaysia time, so "today" must not lag 8 hours behind UTC.
const TIME_ZONE = 'Asia/Kuala_Lumpur'

// Today as YYYY-MM-DD (for due-date comparisons + seeds).
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE })

// Today's weekday name, so the bot can turn "Friday" into a real date.
export const todayWeekday = () => new Date().toLocaleDateString('en-GB', { timeZone: TIME_ZONE, weekday: 'long' })

// The next 7 days with their weekdays, so the bot copies dates instead of doing
// calendar maths, which it gets wrong.
export const upcomingDays = () =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + (i + 1) * 86_400_000)
    const weekday = d.toLocaleDateString('en-GB', { timeZone: TIME_ZONE, weekday: 'long' })
    return `${weekday} ${d.toLocaleDateString('en-CA', { timeZone: TIME_ZONE })}`
  }).join(', ')

// Cash In means money that actually landed. An unpaid invoice is "Who Owes Me",
// and a reversed row never arrived, so neither counts here.
const RECEIVED = new Set(['paid', 'received', 'done', 'closed'])
export const isCashReceived = (r: Rec) =>
  r.category === 'cash_in' && RECEIVED.has((r.status || '').toLowerCase())

// When the money landed, in ms. Uses the paid_at stamp when there is one. Older rows
// fall back to a due date already passed when the row was created, then created_at.
export function cashReceivedAt(r: Rec): number {
  const paidAt = Date.parse(r.meta?.paid_at || '')
  if (Number.isFinite(paidAt)) return paidAt
  const created = Date.parse(r.created_at)
  const due = r.due_date ? Date.parse(r.due_date) : NaN
  return Number.isFinite(due) && due < created ? due : created
}

// Sales for the latest month that has any, from daily_sales. Shop takings live there
// rather than in records, so the Dashboard and the brief read them from here.
export async function latestMonthSales(): Promise<{ month: string; total: number; days: number; lastDate: string } | null> {
  if (!supabaseConfigured) return null
  const { data: latest } = await supabase.from('daily_sales').select('sale_date').order('sale_date', { ascending: false }).limit(1)
  const lastDate = latest?.[0]?.sale_date as string | undefined
  if (!lastDate) return null
  const month = lastDate.slice(0, 7)
  const { data } = await supabase.from('daily_sales').select('net_sales').gte('sale_date', `${month}-01`).lte('sale_date', lastDate)
  const rows = data ?? []
  return { month, total: rows.reduce((sum, r) => sum + Number(r.net_sales), 0), days: rows.length, lastDate }
}

// How many proposals are waiting for a YES right now (status 'proposed', unexpired).
// Powers the 🙋 sidebar badge. Returns 0 before Supabase is wired (no hang).
export async function getPendingCount(): Promise<number> {
  if (!supabaseConfigured) return 0
  const { count, error } = await supabase
    .from('agent_actions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'proposed')
    .gt('expires_at', new Date().toISOString())
  if (error) return 0
  return count ?? 0
}

// ============================================================
// THE FUNNEL — the whole-business river the Dashboard + morning brief show.
// Views → Leads → Appointments → Closed → Nurture.
//   • views        = sum of every `content` row's meta.views
//   • leads        = leads still at the top (status new OR contacted)
//   • appointments = leads at status 'appointment'
//   • closed       = leads at status 'closed'
//   • nurture      = leads at status 'nurture'
//   • pct[]        = stage-to-stage conversion %, one entry BETWEEN each pair of
//                    the 5 stages (so 4 numbers: views→leads, leads→appts,
//                    appts→closed, closed→nurture). 0 when the upstream stage is 0.
// ============================================================
export type Funnel = {
  views: number
  leads: number
  appointments: number
  closed: number
  nurture: number
  pct: number[]
}

export function getFunnel(rows: Rec[]): Funnel {
  const leadRows = rows.filter(r => r.category === 'lead')
  const countStatus = (...statuses: string[]) =>
    leadRows.filter(r => statuses.includes((r.status || '').toLowerCase())).length

  const views = rows
    .filter(r => r.category === 'content')
    .reduce((sum, r) => sum + Number(r.meta?.views || 0), 0)
  const leads = countStatus('new', 'contacted')
  const appointments = countStatus('appointment')
  const closed = countStatus('closed')
  const nurture = countStatus('nurture')

  const stages = [views, leads, appointments, closed, nurture]
  const pct: number[] = []
  for (let i = 0; i < stages.length - 1; i++) {
    // Conversion from this stage to the next. Guard divide-by-zero → 0%.
    pct.push(stages[i] > 0 ? Math.round((stages[i + 1] / stages[i]) * 100) : 0)
  }
  return { views, leads, appointments, closed, nurture, pct }
}
