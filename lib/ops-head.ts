import 'server-only'
import { supabase, supabaseConfigured } from './supabase'
import { rm } from './records'
import { foodByMonth } from './home'
import { dayOfIso, stateOf } from './clock'
import { OPS_HEAD as O } from '@/agents/ops-head/definition'
import { addDays, dayName, headCheck, pct, type Alarm, type Reading, type Readout } from './heads'

// The Head of Ops: attendance (late, no GPS, missing clock-outs), bills stuck waiting
// for approval, leave about to start without an answer, and food cost against target.

type Punch = { user_id: number; kind: string; punched_at: string; flags: string[] | null }

export async function opsReadout(today: string): Promise<Readout> {
  const readings: Reading[] = []
  const alarms: Alarm[] = []
  if (!supabaseConfigured) return { readings, alarms }
  const weekAgo = addDays(today, -7)

  const [{ data: punches }, { data: users }, { data: waiting }, { data: leaves }, food] = await Promise.all([
    supabase.from('punches').select('user_id, kind, punched_at, flags').gte('punched_at', `${addDays(weekAgo, -1)}T16:00:00Z`).order('punched_at'),
    supabase.from('app_users').select('id, name'),
    supabase.from('agent_actions').select('id, agent_key, payload, proposed_at').eq('status', 'proposed')
      .in('agent_key', ['stock-receipt', 'stock-draft', 'expense']).gt('expires_at', new Date().toISOString()).lt('proposed_at', `${addDays(today, -O.billWaitDays)}T00:00:00Z`),
    supabase.from('hr_leave_requests').select('id, person_id, leave_type, start_date, hr_people(name)').eq('status', 'pending')
      .lte('start_date', addDays(today, O.leaveWarnDays)),
    foodByMonth(today).catch(() => []),
  ])
  const name = new Map((users ?? []).map(u => [u.id as number, u.name as string]))
  const list = (punches ?? []) as Punch[]

  // ① Late clock-ins, last 7 days.
  const late = list.filter(p => p.kind === 'in' && (p.flags ?? []).includes('late'))
  const lateBy = new Map<number, number>()
  for (const p of late) lateBy.set(p.user_id, (lateBy.get(p.user_id) ?? 0) + 1)
  const worst = [...lateBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => `${name.get(id) ?? `#${id}`} ${n}x`)
  const lateFiring = late.length >= O.lateLine
  readings.push({ kind: 'late', label: 'Late clock-ins (7 days)', value: list.length ? `${late.length}${worst.length ? ` · ${worst.join(', ')}` : ''}` : 'No punches yet', line: `${O.lateLine}`, state: !list.length ? 'nodata' : lateFiring ? 'firing' : 'ok' })
  if (lateFiring) {
    const who = worst.join(', ')
    alarms.push({
      key: `${O.key}:late:${today}`, kind: 'late', impact: late.length * 50,
      s: {
        title: `${late.length} late clock-ins this week`,
        why: `Most late: ${who}. Late = more than 10 min after the shift starts.`,
        suggest: 'Have a word with the people late most, and check the roster times are right.',
        task: `Talk to late staff: ${who}`,
        to: 'Outlet Manager',
        draft: `Hi, this week we had ${late.length} late clock-ins (${who}). Please remind the team: clock in by shift start, 10 min grace max. If the roster time is wrong, tell me and I'll fix it. Thanks!`,
      },
    })
  }

  // ② No-GPS clock-ins.
  const noGps = list.filter(p => (p.kind === 'in' || p.kind === 'break_in') && (p.flags ?? []).includes('no_gps'))
  const gpsFiring = noGps.length >= O.noGpsLine
  readings.push({ kind: 'gps', label: 'Clock-ins without GPS (7 days)', value: `${noGps.length}`, line: `${O.noGpsLine}`, state: !list.length ? 'nodata' : gpsFiring ? 'firing' : 'ok' })
  if (gpsFiring) {
    const who = [...new Set(noGps.map(p => name.get(p.user_id) ?? `#${p.user_id}`))].slice(0, 4).join(', ')
    alarms.push({
      key: `${O.key}:gps:${today}`, kind: 'gps', impact: noGps.length * 30,
      s: {
        title: `${noGps.length} clock-ins without GPS`,
        why: `From ${who}. Their selfie and outlet photo are on the Attendance tab.`,
        suggest: 'Check their photos on the Attendance tab, and ask them to turn on Location for the app.',
        task: `Check no-GPS clock-ins: ${who}`,
        to: who,
        draft: `Hi, your clock-in came through without location. Please turn on Location (GPS) for the browser on your phone before clocking in. Thanks!`,
      },
    })
  }

  // ③ Shifts left open on a past day.
  const byDay = new Map<string, Punch[]>()
  for (const p of list) {
    const k = `${p.user_id}|${dayOfIso(p.punched_at)}`
    byDay.set(k, [...(byDay.get(k) ?? []), p])
  }
  const open = [...byDay.entries()].filter(([k, ps]) => k.split('|')[1] < today && k.split('|')[1] >= weekAgo && stateOf(ps).state !== 'off')
  const openFiring = open.length >= O.missingOutLine
  readings.push({ kind: 'open', label: 'Missing clock-outs (7 days)', value: `${open.length}`, line: `${O.missingOutLine}`, state: !list.length ? 'nodata' : openFiring ? 'firing' : 'ok' })
  if (openFiring) {
    const who = open.slice(0, 4).map(([k]) => `${name.get(Number(k.split('|')[0])) ?? '?'} ${dayName(k.split('|')[1])}`).join(', ')
    alarms.push({
      key: `${O.key}:open:${today}`, kind: 'open', impact: open.length * 80,
      s: {
        title: `${open.length} shift${open.length > 1 ? 's' : ''} with no clock-out`,
        why: `${who}. Hours for payroll are wrong until a clock-out is added.`,
        suggest: 'Add the missed clock-out on the Attendance tab (+ Add a missed punch) after checking with them.',
        task: `Fix missing clock-outs: ${who}`,
        to: 'Outlet Manager',
        draft: `Hi, these shifts have no clock-out: ${who}. What time did they finish? I'll add it for payroll.`,
      },
    })
  }

  // ④ Bills stuck waiting for an owner's Approve.
  const stuck = waiting ?? []
  const stuckRm = stuck.reduce((s, r) => s + (Number(r.payload?.total ?? r.payload?.amount ?? r.payload?.bill?.total) || 0), 0)
  readings.push({ kind: 'bills', label: `Bills waiting over ${O.billWaitDays} days`, value: stuck.length ? `${stuck.length} · ${rm(stuckRm)}` : '0', line: '0', state: stuck.length ? 'firing' : 'ok' })
  if (stuck.length) {
    alarms.push({
      key: `${O.key}:bills:${today}`, kind: 'bills', impact: Math.max(stuckRm * 0.1, 100),
      s: {
        title: `${stuck.length} bill${stuck.length > 1 ? 's' : ''} waiting for your Approve`,
        why: `${rm(stuckRm)} not yet in the stock sheet or P&L, so food cost is understated.`,
        suggest: 'Open Approvals and clear them today.',
        task: `Clear ${stuck.length} bills in Approvals`,
        to: 'Su Ni',
        draft: `Su Ni, ${stuck.length} bills (${rm(stuckRm)}) are still waiting for approval in the app. Can you check them today if I don't get to it?`,
      },
    })
  }

  // ⑤ Leave starting soon with no answer.
  const soon = leaves ?? []
  readings.push({ kind: 'leave', label: `Leave starting within ${O.leaveWarnDays} days, unanswered`, value: `${soon.length}`, line: '0', state: soon.length ? 'firing' : 'ok' })
  if (soon.length) {
    const who = soon.slice(0, 4).map(l => `${(l.hr_people as unknown as { name: string } | null)?.name ?? '?'} (${l.leave_type} ${dayName(l.start_date)})`).join(', ')
    alarms.push({
      key: `${O.key}:leave:${soon.map(l => l.id).join('-')}`, kind: 'leave', impact: 150 * soon.length,
      s: {
        title: `${soon.length} leave request${soon.length > 1 ? 's' : ''} need an answer`,
        why: `${who}. Staff need to know before the day.`,
        suggest: 'Approve or reject on the Leaves tab, then fix the roster.',
        task: `Answer leave: ${who}`,
        to: 'Outlet Manager',
        draft: `Hi, leave requests waiting: ${who}. Can we cover the shifts? Let me know today so I can answer them.`,
      },
    })
  }

  // ⑥ Food cost this month vs target.
  const cur = food.at(-1)
  if (cur && cur.pct != null && cur.sales > 0) {
    const firing = cur.pct > O.foodTargetPct
    readings.push({ kind: 'food', label: `Food cost ${cur.month}${cur.counted ? '' : ' (estimate)'}`, value: pct(cur.pct), line: `${O.foodTargetPct}%`, state: firing ? 'firing' : 'ok' })
    if (firing) {
      alarms.push({
        key: `${O.key}:food:${cur.month}`, kind: 'food', impact: ((cur.pct - O.foodTargetPct) / 100) * cur.sales,
        s: {
          title: `Food cost ${pct(cur.pct)}, target ${O.foodTargetPct}%`,
          why: `${rm(cur.cogs)} on ${rm(cur.sales)} sales this month. That's ${rm(((cur.pct - O.foodTargetPct) / 100) * cur.sales)} over target.`,
          suggest: 'Check portions on the top 5 items and wastage at closing this week.',
          task: 'Portion and wastage check, top 5 items',
          to: 'BOH Supervisor',
          draft: `Hi, food cost this month is ${pct(cur.pct)} (target ${O.foodTargetPct}%). This week please weigh portions on our top 5 items against the recipe, and note wastage at closing. Thanks!`,
        },
      })
    }
  } else {
    readings.push({ kind: 'food', label: 'Food cost this month', value: 'No sales yet', line: `${O.foodTargetPct}%`, state: 'nodata' })
  }

  alarms.sort((a, b) => b.impact - a.impact)
  return { readings, alarms }
}

export const opsCheck = async (today: string) => headCheck(O, await opsReadout(today), today)
