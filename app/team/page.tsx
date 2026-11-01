import Link from 'next/link'
import { requireOwner } from '@/lib/auth'
import { reportFor, type PersonReport, type Punch } from '@/lib/attendance'
import { ROLES } from '@/lib/access'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { CopyReport, OvertimeButtons, PinForm, ShiftForm, ShiftPicker } from './TeamControls'

export const dynamic = 'force-dynamic'

const TABS = [['week', 'Week'], ['ot', 'OT'], ['report', 'Report'], ['shift', 'Shift'], ['shop', 'Shop']]
const DEFAULT_RADIUS_M = 100
const iso = (d: Date) => d.toISOString().slice(0, 10)
const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`
const roleName = (role: string) => ROLES.find(r => r.key === role)?.label ?? role
const flagsOf = (r: PersonReport) => [
  r.days === 0 && 'No punches',
  r.noShift && 'No shift',
  r.farFromPin && 'Far from pin',
  r.noGps && 'No GPS',
  r.missingOut && 'Missing clock-out',
].filter(Boolean) as string[]

type Person = { id: number; name: string; role: string }

async function Week({ people, start }: { people: Person[]; start: string }) {
  const first = new Date(`${start}T00:00:00Z`)
  const days = Array.from({ length: 7 }, (_, i) => iso(new Date(first.getTime() + i * 86_400_000)))
  const [{ data: shifts }, { data: roster }] = await Promise.all([
    supabase.from('shift_types').select('code').order('code'),
    supabase.from('roster').select('user_id, work_date, shift_code').gte('work_date', days[0]).lte('work_date', days[6]),
  ])
  const codes = (shifts ?? []).map(s => s.code as string)
  const shiftFor = (id: number, day: string) => roster?.find(r => r.user_id === id && r.work_date === day)?.shift_code ?? ''
  const jump = (by: number) => iso(new Date(first.getTime() + by * 7 * 86_400_000))

  return (
    <>
      <div className="pulse-head">
        <Link className="btn ghost" href={`/team?week=${jump(-1)}`} aria-label="Previous week">‹</Link>
        <strong>{days[0]} to {days[6]}</strong>
        <Link className="btn ghost" href={`/team?week=${jump(1)}`} aria-label="Next week">›</Link>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>Person</th>{days.map(d => <th key={d}>{d.slice(5)}</th>)}</tr></thead>
          <tbody>
            {people.map(person => (
              <tr key={person.id}>
                <td>{person.name}</td>
                {days.map(day => (
                  <td key={`${day}-${shiftFor(person.id, day)}`}>
                    <ShiftPicker userId={person.id} day={day} value={shiftFor(person.id, day)} codes={codes} name={person.name} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

async function Overtime() {
  const { data } = await supabase
    .from('ot_requests')
    .select('id, work_date, hours, app_users!ot_requests_user_id_fkey(name)')
    .eq('status', 'pending')
    .order('work_date', { ascending: false })
  if (!data?.length) return <p className="cap">Nothing waiting. Overtime appears here when someone clocks out after their shift ends.</p>
  return (
    <>
      <p className="cap">Hours only, not pay.</p>
      {data.map(ot => (
        <div className="admin-card" key={ot.id}>
          <p className="rowlabel" style={{ marginBottom: 2 }}>{(ot.app_users as unknown as { name: string }).name} · {ot.hours}h</p>
          <p className="cap" style={{ margin: '0 0 10px' }}>{ot.work_date}</p>
          <OvertimeButtons id={ot.id} />
        </div>
      ))}
    </>
  )
}

async function Report({ people, month }: { people: Person[]; month: string }) {
  const from = `${month}-01`
  const next = new Date(`${from}T00:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const to = iso(next)
  const [{ data: punches }, { data: roster }, { data: pinRow }] = await Promise.all([
    supabase.from('punches').select('user_id, kind, punched_at, distance_m, lat').gte('punched_at', `${from}T00:00:00+08:00`).lt('punched_at', `${to}T00:00:00+08:00`),
    supabase.from('roster').select('user_id, work_date').gte('work_date', from).lt('work_date', to),
    supabase.from('app_settings').select('value').eq('key', 'shop_pin').maybeSingle(),
  ])
  const radius = (pinRow?.value as { radius?: number } | undefined)?.radius ?? DEFAULT_RADIUS_M
  const rows = people.map(person => {
    const report = reportFor(
      ((punches ?? []) as Punch[]).filter(p => p.user_id === person.id),
      new Set((roster ?? []).filter(r => r.user_id === person.id).map(r => r.work_date as string)),
      radius,
    )
    return { person, report, flags: flagsOf(report) }
  })
  const sheet = [
    ['Name', 'Role', 'Days present', 'Hours', 'Checks'].join('\t'),
    ...rows.map(r => [r.person.name, roleName(r.person.role), r.report.days, (r.report.minutes / 60).toFixed(2), r.flags.join(', ')].join('\t')),
  ].join('\n')

  return (
    <>
      <p className="cap">{month} · {rows.length} people · {rows.filter(r => r.flags.length).length} to check</p>
      <CopyReport text={sheet} />
      <table className="tbl" style={{ marginTop: 14 }}>
        <thead><tr><th>Person</th><th>Days</th><th>Hours</th><th>Checks</th></tr></thead>
        <tbody>
          {rows.map(({ person, report, flags }) => (
            <tr key={person.id}>
              <td data-label="Person">{person.name}</td>
              <td data-label="Days">{report.days}</td>
              <td data-label="Hours">{hours(report.minutes)}</td>
              <td data-label="Checks">{flags.join(' · ') || 'OK'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

async function Shifts() {
  const { data } = await supabase.from('shift_types').select('code, start_time, end_time').order('code')
  return (
    <>
      <ShiftForm />
      <table className="tbl" style={{ maxWidth: 640 }}>
        <tbody>
          {(data ?? []).map(s => (
            <tr key={s.code}>
              <td data-label="Shift">{s.code}</td>
              <td data-label="Hours">{String(s.start_time).slice(0, 5)}–{String(s.end_time).slice(0, 5)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

async function Shop() {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'shop_pin').maybeSingle()
  return <PinForm saved={(data?.value as { lat: number; lng: number; radius: number } | undefined) ?? null} />
}

export default async function TalentHQ({ searchParams }: { searchParams: Promise<{ tab?: string; week?: string; month?: string }> }) {
  await requireOwner()
  const { tab = 'week', week, month } = await searchParams
  const today = todayISO()
  const monday = new Date(`${today}T00:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  const { data } = await supabase.from('app_users').select('id, name, role').eq('active', true).order('name')
  const people = (data ?? []) as Person[]
  const { count } = await supabase.from('ot_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')

  return (
    <>
      <h1 className="ph">Talent HQ</h1>
      <p className="cap">Team, roster and overtime.</p>
      <div className="btnrow" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/team?tab=${key}`} className={`btn${tab === key ? '' : ' ghost'}`}>
            {label}{key === 'ot' && count ? ` · ${count}` : ''}
          </Link>
        ))}
        <Link href="/team/history" className="btn ghost">Clock history</Link>
      </div>
      {tab === 'ot' ? <Overtime /> : null}
      {tab === 'report' ? <Report people={people} month={/^\d{4}-\d{2}$/.test(month ?? '') ? (month as string) : today.slice(0, 7)} /> : null}
      {tab === 'shift' ? <Shifts /> : null}
      {tab === 'shop' ? <Shop /> : null}
      {tab === 'week' ? <Week people={people} start={/^\d{4}-\d{2}-\d{2}$/.test(week ?? '') ? (week as string) : iso(monday)} /> : null}
    </>
  )
}
