import Link from 'next/link'
import { rm, todayISO } from '@/lib/records'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import Stat from '@/app/_components/Stat'
import { SALES_COLUMNS, changeText, type SalesValues } from '@/app/report/fields'
import HealthStrip from '@/app/flr/HealthStrip'
import { costsUpTo, liveDay, salesOverview, type Takings } from '@/lib/dashboard'
import { FOOD_TARGET, foodByMonth, salesByDay, topSuppliers } from '@/lib/home'
import { attentionItems } from '@/lib/attention'
import { leaveBoard } from '@/lib/leaves'
import DayPicker from './DayPicker'
import { DailyBars, FoodCostLine, SalesCogsBars, SupplierBars } from './dash/Charts'
import LeaveDecide from './dash/LeaveDecide'
import { AbsentButton, AddPunchForm, DeviceButtons } from './dash/AttendanceControls'
import { monthReport, todayBoard, type BoardRow } from '@/lib/attendance-board'
import { FLAG_LABEL, hoursText, timeText } from '@/lib/clock'

export const dynamic = 'force-dynamic'

// The owners' homepage: one date picker, five tabs. Overview carries the food cost
// headline, "Needs your attention" and the charts; the other tabs hold the detail.

const TABS = [
  { key: 'overview', label: 'Overview', icon: '🥩' },
  { key: 'sales', label: 'Sales', icon: '💰' },
  { key: 'costs', label: 'Costs', icon: '🧮' },
  { key: 'ops', label: 'Daily Ops', icon: '📋' },
  { key: 'attendance', label: 'Attendance', icon: '⏰' },
  { key: 'leaves', label: 'Leaves', icon: '🌴' },
] as const
type Tab = (typeof TABS)[number]['key']

const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthOf = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const monthShort = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
const pickDay = (asked: string | undefined, today: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(asked ?? '') && asked! <= today && asked! >= '2026-01-01' ? asked! : today
const dayName = (day: string, today: string, yesterday: string) =>
  day === today ? `Today, ${shortDate(day)}` : day === yesterday ? `Yesterday, ${shortDate(day)}` : shortDate(day)

// **bold** inside an attention line.
function Bold({ text }: { text: string }) {
  return <>{text.split('**').map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>))}</>
}

function SalesTable({ day, month, year, monthDays, monthLabel }: { day: Takings | null; month: Takings; year: Takings; monthDays: number; monthLabel: string }) {
  const cols = [`${monthLabel} so far (${monthDays} day${monthDays === 1 ? '' : 's'})`, 'Year so far']
  const cell = (t: Takings | null, f: (t: Takings) => number) => (t ? rm(f(t)) : '–')
  const lines: [string, (t: Takings) => number, boolean][] = [
    ['Nett sales', t => t.nett, true],
    ['Service charge 10%', t => t.service, false],
    ['SST 6%', t => t.sst, false],
    ['Total sales', t => t.nett + t.service + t.sst, true],
  ]
  return (
    <table className="tbl sales3">
      <thead><tr><th></th><th>Day</th><th>{cols[0]}</th><th>{cols[1]}</th></tr></thead>
      <tbody>
        {lines.map(([label, f, bold]) => (
          <tr key={label} className={bold ? 'strong' : undefined}>
            <td data-label="">{label}</td>
            <td data-label="Day">{cell(day, f)}</td>
            <td data-label={cols[0]}>{cell(month, f)}</td>
            <td data-label={cols[1]}>{cell(year, f)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const OPS_TILES: { key: keyof SalesValues; label: string; count?: boolean }[] = [
  { key: 'sales_total', label: 'Sales total' },
  { key: 'receipt_count', label: 'Receipts', count: true },
  { key: 'total_pax', label: 'Pax', count: true },
  { key: 'avg_per_pax', label: 'Average per pax' },
  { key: 'receipt_avg', label: 'Receipt average' },
  { key: 'total_discount', label: 'Discounts' },
  { key: 'total_void', label: 'Voids' },
  { key: 'total_pay_in', label: 'Pay in' },
  { key: 'total_pay_out', label: 'Pay out' },
]

async function reportFor(day: string) {
  const { data } = await supabase.from('daily_reports').select(`report_date, ${SALES_COLUMNS}`)
    .lte('report_date', day).or('sales_total.gt.0,cash.gt.0,qr.gt.0,card.gt.0')
    .order('report_date', { ascending: false }).limit(1)
  const latest = data?.[0] as unknown as (SalesValues & { report_date: string }) | undefined
  if (!latest) return null
  const prevDay = dayBefore(latest.report_date)
  const { data: prev } = await supabase.from('daily_reports').select(SALES_COLUMNS).eq('report_date', prevDay).maybeSingle()
  return { day: latest.report_date, latest, prevDay, previous: prev as unknown as SalesValues | null }
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ tab?: string; day?: string }> }) {
  const asked = await searchParams
  const today = todayISO()
  const yesterday = dayBefore(today)
  const day = pickDay(asked.day, today)
  const tab: Tab = (TABS.find(t => t.key === asked.tab)?.key ?? 'overview') as Tab
  const asOf = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short', year: 'numeric' })
  const link = (t: Tab) => {
    const q = new URLSearchParams()
    if (t !== 'overview') q.set('tab', t)
    if (day !== today) q.set('day', day)
    const s = q.toString()
    return s ? `/?${s}` : '/'
  }

  return (
    <>
      <div className="home-head">
        <div className="home-brand">
          <img src="/icons/logo.png" alt="" className="home-logo" />
          <div>
            <h1 className="ph" style={{ margin: 0 }}>Mama Lek-Thai Beef Noodle</h1>
            <p className="cap" style={{ margin: 0 }}>Owner&apos;s dashboard · Eric Yeap &amp; Aw Su Ni</p>
          </div>
        </div>
        <div className="home-tools">
          <span className="pill-soft">Data as of {asOf}</span>
          <DayPicker param="day" day={day} today={today} yesterday={yesterday} />
        </div>
      </div>

      <nav className="home-tabs" aria-label="Dashboard sections">
        {TABS.map(t => (
          <Link key={t.key} href={link(t.key)} className={t.key === tab ? 'on' : undefined} scroll={false}>
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </Link>
        ))}
      </nav>

      {!supabaseConfigured ? <p className="cap">Database not connected.</p>
        : tab === 'overview' ? <Overview day={day} today={today} />
        : tab === 'sales' ? <SalesTab day={day} today={today} yesterday={yesterday} />
        : tab === 'costs' ? <CostsTab day={day} today={today} />
        : tab === 'ops' ? <OpsTab day={day} />
        : tab === 'attendance' ? <AttendanceTab day={day} today={today} />
        : <LeavesTab today={today} />}
    </>
  )
}

// ------------------------------------------------------------------ Overview
async function Overview({ day, today }: { day: string; today: string }) {
  const live = day === today ? await liveDay(today) : null
  const [food, days, suppliers] = await Promise.all([
    foodByMonth(day),
    salesByDay(day.slice(0, 7), day, live?.t ? { date: today, nett: live.t.nett } : null),
    topSuppliers(day),
  ])
  const items = await attentionItems(today, food)
  const counted = food.filter(f => f.counted && f.pct !== null)
  const head = counted[counted.length - 1]
  const prev = counted[counted.length - 2]
  const current = food[food.length - 1]
  const diff = head && prev && head.pct !== null && prev.pct !== null ? head.pct - prev.pct : null

  return (
    <>
      <div className="home-top">
        <section className="card hero">
          <div className="card-head">
            <span className="eyebrow">{head ? `${monthOf(`${head.month}-01`).toUpperCase()} FOOD COST %` : 'FOOD COST %'}</span>
            <span className="tag-soft">stock count</span>
          </div>
          {head && head.pct !== null ? (
            <>
              <p className={`hero-num${head.pct > FOOD_TARGET ? ' bad' : ''}`}>{head.pct.toFixed(1)}%</p>
              <p className="hero-sub">
                {diff !== null ? <span className={`delta ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(1)} pts</span> : null}
                {prev ? ` vs ${monthShort(prev.month)} · ` : ' '}COGS <strong>{rm(head.cogs)}</strong> on sales of <strong>{rm(head.sales)}</strong>
              </p>
              <p className="hero-target">Target {FOOD_TARGET}% · {head.pct <= FOOD_TARGET ? 'on target ✅' : `${(head.pct - FOOD_TARGET).toFixed(1)} pts over`}</p>
            </>
          ) : <p className="cap">No month has its stock count done yet.</p>}
          {current && !current.counted && current.pct !== null ? (
            <p className="hero-now">
              <strong>{monthShort(current.month)} so far: {current.pct.toFixed(1)}%</strong> <span className="tag-soft">estimate</span>
              <br /><span className="cap">COGS {rm(current.cogs)} on sales of {rm(current.sales)}. Real once the {monthShort(current.month)} stock count is done.</span>
            </p>
          ) : null}
        </section>

        <section className="card attention">
          <p className="eyebrow">⚠️ NEEDS YOUR ATTENTION</p>
          {items.length ? (
            <div className="att-list">
              {items.map((it, i) => (
                <Link key={i} href={it.href} className="att-item">
                  <span className="att-icon" aria-hidden="true">{it.icon}</span>
                  <span><Bold text={it.text} /></span>
                </Link>
              ))}
            </div>
          ) : <p className="cap">All clear. Nothing needs you right now. ✅</p>}
        </section>
      </div>

      <div className="chart-grid">
        <section className="card">
          <p className="card-title">Food cost % by month</p>
          <p className="cap">Lower is better. Hollow dots are estimates. Hover a point for the exact value.</p>
          <FoodCostLine target={FOOD_TARGET}
            points={food.map(f => ({ label: monthShort(f.month), value: f.pct, estimate: !f.counted }))} />
        </section>
        <section className="card">
          <p className="card-title">Sales vs cost of goods</p>
          <p className="cap">RM per month · <span className="key soft" /> Nett sales <span className="key" /> COGS</p>
          <SalesCogsBars items={food.map(f => ({ label: monthShort(f.month), sales: f.sales, cogs: f.cogs, estimate: !f.counted }))} />
        </section>
        <section className="card">
          <p className="card-title">Daily sales · {monthOf(day)}</p>
          <p className="cap">Nett sales per day. Red bars are 25%+ below the month&apos;s average.</p>
          <DailyBars items={days} today={today} />
        </section>
        <section className="card">
          <p className="card-title">Top suppliers · {monthOf(day)}</p>
          <p className="cap">Spend to {shortDate(day)}; the grey bar is last month to the same day.</p>
          <SupplierBars items={suppliers} />
        </section>
      </div>
    </>
  )
}

// ------------------------------------------------------------------ Sales
async function SalesTab({ day, today, yesterday }: { day: string; today: string; yesterday: string }) {
  const sales = await salesOverview(day, today)
  return (
    <section className="card">
      <p className="card-title">Sales · {dayName(day, today, yesterday)}{sales.live ? ' · live from POS' : ''}</p>
      <SalesTable day={sales.dayTakings} month={sales.monthTakings} year={sales.yearTakings}
        monthDays={sales.monthDays} monthLabel={monthOf(day).split(' ')[0]} />
      {sales.live && sales.liveError ? <p className="cap">Could not reach the POS ({sales.liveError}), so this day shows no sales yet.</p> : null}
      {sales.live && day === today && !sales.liveError ? <p className="cap">Still trading: today keeps growing. Reload for the latest.</p> : null}
      {sales.tmsMonths.length ? <p className="cap">Year so far: {sales.tmsMonths.map(monthShort).join(', ')} use TMS nett sales (no service charge / SST split).</p> : null}
    </section>
  )
}

// ------------------------------------------------------------------ Costs
async function CostsTab({ day, today }: { day: string; today: string }) {
  const c = await costsUpTo(day, today)
  const share = (n: number) => (c.netSales ? `${((n / c.netSales) * 100).toFixed(1)}%` : '–')
  const est = (keyed: boolean) => (keyed ? '' : ' · estimate')
  const range = c.dayNo === 1 ? shortDate(day) : `1–${shortDate(day)}`
  return (
    <>
      <section className="card">
        <p className="card-title">FLR · {monthOf(day)}, {range}</p>
        <HealthStrip percent={c.flrPercent} href="/flr" label={c.estimatedFrom ? `labour est. from ${c.estimatedFrom}` : undefined} />
        <div className="grid">
          <Stat label="Food cost" value={share(c.food)} sub={`${rm(c.food)}${c.foodNote ? ' · estimate' : ''}`} href="/cogs" />
          <Stat label="Labour cost" value={share(c.labour)} sub={!c.costsKeyed ? 'Not keyed in yet' : `${rm(c.labour)}${est(!c.estimatedFrom)}`} href="/flr" />
          <Stat label="Rental cost" value={share(c.rent)} sub={!c.costsKeyed ? 'Not keyed in yet' : `${rm(c.rent)}${est(!c.estimatedFrom)}`} href="/flr" />
          <Stat label="Total cost" value={share(c.total)} sub={`${rm(c.total)} of ${rm(c.netSales)} nett sales`} />
        </div>
        {c.foodNote || c.estimatedFrom ? (
          <p className="cap">
            <span className="tag-soft">estimate</span>{' '}
            {[c.foodNote ? 'food until the stock count is done' : '', c.estimatedFrom ? `labour and rental from ${c.estimatedFrom} until this month's are keyed in` : '']
              .filter(Boolean).join('; ')}. Labour and rental count {c.dayNo} of {c.days} days.
          </p>
        ) : null}
      </section>
    </>
  )
}

// ------------------------------------------------------------------ Daily Ops
async function OpsTab({ day }: { day: string }) {
  const r = await reportFor(day)
  if (!r) return <section className="card"><p className="cap">No daily report saved yet. <a href="/report">Open Daily Report</a></p></section>
  return (
    <section className="card">
      <p className="card-title">Daily report · {shortDate(r.day)} vs {shortDate(r.prevDay)}</p>
      {r.day !== day ? <p className="cap">No POS report for {shortDate(day)} yet (it arrives the next morning), so this is the latest one.</p> : null}
      <div className="grid ops">
        {OPS_TILES.map(f => {
          const show = (n: number) => (f.count ? n.toLocaleString('en-MY') : rm(n))
          const now = Number(r.latest[f.key])
          return (
            <Stat key={f.key} label={f.label} value={show(now)} href={`/report?day=${r.day}`}
              sub={r.previous ? changeText(now, Number(r.previous[f.key]), show) : 'No report the day before'} />
          )
        })}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ Leaves
async function LeavesTab({ today }: { today: string }) {
  const b = await leaveBoard(today)
  const pill = (n: number | null) => n === null
    ? <span className="cap">not set</span>
    : <span className={`lv ${n <= 0 ? 'zero' : n <= 2 ? 'low' : 'ok'}`}>{n} day{n === 1 ? '' : 's'}</span>
  return (
    <>
      {b.pending.length ? (
        <section className="card">
          <p className="card-title">Waiting for approval</p>
          <table className="tbl">
            <thead><tr><th>Name</th><th>Leave</th><th>When</th><th>Days</th><th>Annual left after</th><th></th></tr></thead>
            <tbody>
              {b.pending.map(p => (
                <tr key={p.id}>
                  <td data-label="Name"><strong>{p.name}</strong>{p.reason ? <span className="cap"> · {p.reason}</span> : null}</td>
                  <td data-label="Leave">{p.typeName}</td>
                  <td data-label="When">{p.start === p.end ? shortDate(p.start) : `${shortDate(p.start)} – ${shortDate(p.end)}`}</td>
                  <td data-label="Days">{p.days}</td>
                  <td data-label="Annual left after">{p.annualAfter === null ? '–' : pill(p.annualAfter)}</td>
                  <td data-label=""><LeaveDecide id={p.id} version={p.version} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="card">
        <p className="card-title">Team &amp; leave left</p>
        <p className="cap" style={{ marginTop: 0 }}>
          <strong>{b.summary.active} active</strong> · {b.summary.foh} FOH · {b.summary.boh} BOH · {b.pending.length} pending · {b.summary.onLeaveToday} on leave today.
          MC is 2 days a month, no carry-over. Tap a name to adjust their balance.
        </p>
        {b.rows.length ? (
          <table className="tbl leave-tbl">
            <thead><tr><th>Name</th><th>Role</th><th>Annual left</th><th>Next leave</th></tr></thead>
            <tbody>
              {b.rows.map(r => (
                <tr key={r.id}>
                  <td data-label="Name"><Link href={`/hr/people/${r.id}`}><strong>{r.name}</strong></Link>{r.onLeaveToday ? <span className="tag-soft"> on leave</span> : null}</td>
                  <td data-label="Role">{r.position ?? ''}</td>
                  <td data-label="Annual left">{pill(r.annualLeft)}</td>
                  <td data-label="Next leave">{r.nextLeave ? shortDate(r.nextLeave) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="cap">No staff profiles yet.</p>}
      </section>
    </>
  )
}

// ------------------------------------------------------------------ Attendance
const STATUS: Record<BoardRow['status'], { text: string; cls: string }> = {
  missing: { text: 'Missing', cls: 'zero' }, break: { text: 'On break', cls: 'low' }, in: { text: 'In', cls: 'ok' },
  not_yet: { text: 'Not in yet', cls: '' }, out: { text: 'Done', cls: '' }, absent: { text: 'Absent', cls: 'zero' }, off: { text: 'Off', cls: '' },
}
const t5 = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : '')

async function AttendanceTab({ day, today }: { day: string; today: string }) {
  const month = day.slice(0, 7)
  const [board, report] = await Promise.all([todayBoard(day), monthReport(month)])
  const working = board.rows.filter(r => r.status !== 'off')
  const count = (st: BoardRow['status']) => board.rows.filter(r => r.status === st).length
  return (
    <>
      {board.devices.length ? (
        <section className="card attention">
          <p className="card-title">📱 New phones waiting for approval</p>
          <table className="tbl">
            <tbody>
              {board.devices.map(d => (
                <tr key={d.id}>
                  <td data-label="Staff"><strong>{d.name}</strong> <span className="cap">· {d.label}</span></td>
                  <td data-label=""><DeviceButtons id={d.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="card">
        <p className="card-title">{day === today ? 'Today' : shortDate(day)} · {count('in')} in · {count('break')} on break · {count('missing')} missing · {count('out')} done</p>
        <p className="cap" style={{ marginTop: 0 }}>Late = more than 10 min after the shift starts. Late from break = break length + 10 min (you also get a Telegram notice).</p>
        {working.length ? (
          <table className="tbl att-tbl">
            <thead><tr><th>Name</th><th>Shift</th><th>Status</th><th>Worked</th><th>Flags</th><th>Photos</th><th></th></tr></thead>
            <tbody>
              {working.map(r => (
                <tr key={r.userId}>
                  <td data-label="Name"><strong>{r.name}</strong></td>
                  <td data-label="Shift">{r.shift ? `${r.shift.code} ${t5(r.shift.start_time)}–${t5(r.shift.end2 || r.shift.end_time)}` : <span className="cap">no shift</span>}</td>
                  <td data-label="Status">
                    <span className={`lv ${r.overBreak ? 'zero' : STATUS[r.status].cls}`}>{r.overBreak ? 'Break over' : STATUS[r.status].text}</span>
                    {r.since && (r.status === 'in' || r.status === 'break' || r.status === 'out') ? <span className="cap"> since {timeText(r.since)}</span> : null}
                  </td>
                  <td data-label="Worked">{r.worked ? hoursText(r.worked) : '–'}</td>
                  <td data-label="Flags">{r.flags.map(f => <span key={f} className="pill overdue" style={{ marginRight: 4 }}>{FLAG_LABEL[f] ?? f}</span>)}</td>
                  <td data-label="Photos">
                    {r.selfie ? <a href={r.selfie} target="_blank" rel="noreferrer"><img className="att-photo" src={r.selfie} alt="Selfie" /></a> : null}
                    {r.shop ? <a href={r.shop} target="_blank" rel="noreferrer"><img className="att-photo" src={r.shop} alt="Outlet photo" /></a> : null}
                  </td>
                  <td data-label="">{r.status === 'missing' || r.status === 'absent' ? <AbsentButton userId={r.userId} day={day} absent={r.status === 'absent'} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="cap">Nobody is rostered or has punched on this day. Set shifts on Team Roster.</p>}
        <div style={{ marginTop: 12 }}><AddPunchForm staff={board.staff} day={day} /></div>
      </section>

      <section className="card">
        <div className="card-head">
          <p className="card-title">Punch report · {monthOf(day)}</p>
          <a className="btn" href={`/api/attendance-report?month=${month}`}>⬇ Download Excel</a>
        </div>
        <p className="cap" style={{ marginTop: 0 }}>For payroll: hours worked (breaks taken out) and flags per person. Pick another month with the date picker.</p>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Days</th><th>Hours</th><th>Late</th><th>Late break</th><th>No GPS</th><th>No shift</th><th>Missing out</th><th>Absent</th></tr></thead>
          <tbody>
            {report.rows.map(r => (
              <tr key={r.userId}>
                <td data-label="Name"><strong>{r.name}</strong></td>
                <td data-label="Days">{r.days}</td>
                <td data-label="Hours">{hoursText(r.minutes)}</td>
                <td data-label="Late">{r.late || '–'}</td>
                <td data-label="Late break">{r.lateBreak || '–'}</td>
                <td data-label="No GPS">{r.noGps || '–'}</td>
                <td data-label="No shift">{r.offRoster || '–'}</td>
                <td data-label="Missing out">{r.missingOut || '–'}</td>
                <td data-label="Absent">{r.absent || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
