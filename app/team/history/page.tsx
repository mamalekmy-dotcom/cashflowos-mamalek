import Link from 'next/link'
import { requireOwner } from '@/lib/auth'
import { todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SIGNED_URL_SECONDS = 3600
const PERSON_DAYS = 31
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const timeOf = (at: string) => new Date(at).toLocaleString('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
})

type Row = { id: number; user_id: number; kind: string; punched_at: string; lat: number | null; lng: number | null; distance_m: number | null; photo_path: string | null }

// Every punch for one day, or one person's last month, with the selfie and the place
// it was taken. Selfies are private, so each link only lasts an hour.
export default async function ClockHistory({ searchParams }: { searchParams: Promise<{ day?: string; person?: string }> }) {
  await requireOwner()
  const { day: askedDay, person: askedPerson } = await searchParams
  const today = todayISO()
  const day = /^\d{4}-\d{2}-\d{2}$/.test(askedDay ?? '') ? (askedDay as string) : today
  const person = /^\d+$/.test(askedPerson ?? '') ? Number(askedPerson) : null
  const from = person ? addDays(day, 1 - PERSON_DAYS) : day

  let query = supabase.from('punches').select('id, user_id, kind, punched_at, lat, lng, distance_m, photo_path')
    .gte('punched_at', `${from}T00:00:00+08:00`).lt('punched_at', `${addDays(day, 1)}T00:00:00+08:00`)
    .order('punched_at', { ascending: false })
  if (person) query = query.eq('user_id', person)

  const [{ data: punches }, { data: users }, { data: staff }, { data: pinRow }] = await Promise.all([
    query,
    supabase.from('app_users').select('id, name').order('name'),
    supabase.from('hr_people').select('user_id, staff_no'),
    supabase.from('app_settings').select('value').eq('key', 'shop_pin').maybeSingle(),
  ])
  const rows = (punches ?? []) as Row[]
  const nameOf = (id: number) => users?.find(u => u.id === id)?.name ?? '—'
  const staffNo = (id: number) => staff?.find(s => s.user_id === id)?.staff_no ?? ''
  const radius = (pinRow?.value as { radius?: number } | undefined)?.radius

  const paths = rows.map(r => r.photo_path).filter((p): p is string => !!p)
  const { data: signed } = paths.length
    ? await supabase.storage.from('vault').createSignedUrls(paths, SIGNED_URL_SECONDS)
    : { data: [] }
  const photoUrl = (path: string | null) => signed?.find(s => s.path === path)?.signedUrl ?? null
  const link = (d: string) => `/team/history?day=${d}${person ? `&person=${person}` : ''}`

  return (
    <>
      <h1 className="ph">Clock history</h1>
      <p className="cap">{person ? `${nameOf(person)}, the ${PERSON_DAYS} days up to ${day}` : day} · {rows.length} punches · <Link href="/team">Team Roster</Link></p>

      <div className="pulse-head">
        <Link className="btn ghost" href={link(addDays(day, -1))} aria-label="Previous day">‹</Link>
        <strong>{day}</strong>
        <Link className="btn ghost" href={link(addDays(day, 1))} aria-label="Next day">›</Link>
      </div>

      <form method="get" className="btnrow" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        <input className="login-input" type="date" name="day" defaultValue={day} aria-label="Day" style={{ maxWidth: 180 }} />
        <select className="login-input" name="person" defaultValue={person ?? ''} aria-label="Person" style={{ maxWidth: 220 }}>
          <option value="">Everyone</option>
          {(users ?? []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button className="btn" type="submit">Show</button>
      </form>

      {rows.length ? (
        <table className="tbl">
          <thead><tr><th>When</th><th>Staff</th><th>Punch</th><th>Location</th><th>Selfie</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const photo = photoUrl(r.photo_path)
              const far = radius != null && r.distance_m != null && r.distance_m > radius
              return (
                <tr key={r.id}>
                  <td data-label="When">{timeOf(r.punched_at)}</td>
                  <td data-label="Staff">{nameOf(r.user_id)}{staffNo(r.user_id) ? ` · ${staffNo(r.user_id)}` : ''}</td>
                  <td data-label="Punch">{r.kind === 'in' ? 'In' : 'Out'}</td>
                  <td data-label="Location">
                    {r.lat != null && r.lng != null
                      ? <a href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer">Map</a>
                      : 'None'}
                    {r.distance_m != null ? ` · ${r.distance_m}m from shop` : ''}
                    {far ? <> <span className="pill overdue">far</span></> : null}
                  </td>
                  <td data-label="Selfie">
                    {photo ? (
                      <a href={photo} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo} alt={`${nameOf(r.user_id)} selfie`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                      </a>
                    ) : 'None'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : <div className="empty"><p>No punches for this {person ? 'person' : 'day'}.</p></div>}
    </>
  )
}
