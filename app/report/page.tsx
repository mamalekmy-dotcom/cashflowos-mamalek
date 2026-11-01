import Link from 'next/link'
import Stat from '@/app/_components/Stat'
import { rm, todayISO } from '@/lib/records'
import { supabase } from '@/lib/supabase'
import { SALES_COLUMNS, type SalesValues } from './fields'
import { PurchaseForm, RemovePurchase, SalesForm } from './ReportForms'

export const dynamic = 'force-dynamic'

const SUPPLIER_DAYS = 90
const SIGNED_URL_SECONDS = 3600
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

type Sales = SalesValues & { report_date: string }
type Bought = { id: number; purchase_date: string; supplier: string; amount: number; note: string | null; photo_path: string | null }
const collected = (s: Sales) => Number(s.cash) + Number(s.qr) + Number(s.card)

// What the team keys in each day. It's kept apart from POS sales and Stock 2026, so a
// typing mistake here can't change those figures. POS numbers show alongside as a check.
export default async function DailyReport({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day: asked } = await searchParams
  const today = todayISO()
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asked ?? '') && (asked as string) <= today ? (asked as string) : today
  const monthStart = `${day.slice(0, 7)}-01`
  const monthEnd = addDays(addDays(monthStart, 32).slice(0, 7) + '-01', -1)

  const [{ data: sales }, { data: bought }, { data: pos }, { data: known }] = await Promise.all([
    supabase.from('daily_reports').select(`report_date, ${SALES_COLUMNS}`).gte('report_date', monthStart).lte('report_date', monthEnd).order('report_date', { ascending: false }),
    supabase.from('daily_purchases').select('id, purchase_date, supplier, amount, note, photo_path').gte('purchase_date', monthStart).lte('purchase_date', monthEnd).order('id'),
    supabase.from('daily_sales').select('cash, qr, card').eq('sale_date', day).maybeSingle(),
    supabase.from('purchases').select('supplier').gte('purchase_date', addDays(today, -SUPPLIER_DAYS)),
  ])
  const month = (sales ?? []) as unknown as Sales[]
  const buys = (bought ?? []) as Bought[]
  const saved = month.find(s => s.report_date === day) ?? null
  const dayBuys = buys.filter(b => b.purchase_date === day)
  const add = (list: Bought[]) => list.reduce((sum, b) => sum + Number(b.amount), 0)
  const boughtOn = (d: string) => add(buys.filter(b => b.purchase_date === d))
  const suppliers = [...new Set([...(known ?? []).map(k => k.supplier as string), ...buys.map(b => b.supplier)])].sort()
  const days = [...new Set([...month.map(s => s.report_date), ...buys.map(b => b.purchase_date)])].sort().reverse()

  // Invoice photos are private, so each link only lasts an hour.
  const paths = dayBuys.map(b => b.photo_path).filter((p): p is string => !!p)
  const { data: signed } = paths.length
    ? await supabase.storage.from('vault').createSignedUrls(paths, SIGNED_URL_SECONDS)
    : { data: [] }
  const photoUrl = (path: string | null) => signed?.find(s => s.path === path)?.signedUrl ?? null

  const posTotal = pos ? Number(pos.cash) + Number(pos.qr) + Number(pos.card) : 0
  const gap = saved && pos ? collected(saved) - posTotal : null

  return (
    <>
      <h1 className="ph">Daily Report</h1>
      <p className="cap">Key in the day&apos;s sales and purchasing.</p>

      <div className="pulse-head">
        <Link className="btn ghost" href={`/report?day=${addDays(day, -1)}`} aria-label="Previous day">‹</Link>
        <strong>{day}</strong>
        {day < today
          ? <Link className="btn ghost" href={`/report?day=${addDays(day, 1)}`} aria-label="Next day">›</Link>
          : <span />}
      </div>

      <div className="grid">
        <Stat label="Sales collected" value={rm(saved ? collected(saved) : 0)} />
        <Stat label="Purchasing" value={rm(add(dayBuys))} />
        <Stat label={`Sales, ${day.slice(0, 7)}`} value={rm(month.reduce((sum, s) => sum + collected(s), 0))} />
        <Stat label={`Purchasing, ${day.slice(0, 7)}`} value={rm(add(buys))} />
      </div>

      {gap !== null ? (
        <p className={Math.abs(gap) >= 1 ? 'login-error' : 'cap'} style={{ marginBottom: 16 }}>
          POS for this day: {rm(posTotal)}. {Math.abs(gap) >= 1 ? `Keyed in is ${rm(Math.abs(gap))} ${gap > 0 ? 'more' : 'less'}.` : 'Matches what was keyed in.'}
        </p>
      ) : null}

      <SalesForm key={day} day={day} saved={saved} />
      <PurchaseForm key={`buy-${day}`} day={day} suppliers={suppliers} />

      <p className="rowlabel" style={{ marginTop: 20 }}>Purchases on {day}</p>
      {dayBuys.length ? (
        <table className="tbl" style={{ marginBottom: 24 }}>
          <thead><tr><th>Supplier</th><th>Note</th><th>Amount</th><th>Photo</th><th></th></tr></thead>
          <tbody>
            {dayBuys.map(b => {
              const photo = photoUrl(b.photo_path)
              return (
                <tr key={b.id}>
                  <td data-label="Supplier">{b.supplier}</td>
                  <td data-label="Note">{b.note ?? ''}</td>
                  <td data-label="Amount">{rm(Number(b.amount))}</td>
                  <td data-label="Photo">
                    {photo ? (
                      <a href={photo} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo} alt={`${b.supplier} invoice`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                      </a>
                    ) : 'None'}
                  </td>
                  <td><RemovePurchase id={b.id} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : <p className="cap">None yet.</p>}

      <p className="rowlabel" style={{ marginTop: 20 }}>This month</p>
      {days.length ? (
        <table className="tbl">
          <thead><tr><th>Day</th><th>Cash</th><th>QR</th><th>Card</th><th>Sales</th><th>Purchasing</th></tr></thead>
          <tbody>
            {days.map(d => {
              const s = month.find(x => x.report_date === d)
              return (
                <tr key={d}>
                  <td data-label="Day"><Link href={`/report?day=${d}`}>{d}</Link></td>
                  <td data-label="Amount">{rm(Number(s?.cash ?? 0))}</td>
                  <td data-label="Amount">{rm(Number(s?.qr ?? 0))}</td>
                  <td data-label="Amount">{rm(Number(s?.card ?? 0))}</td>
                  <td data-label="Amount">{rm(s ? collected(s) : 0)}</td>
                  <td data-label="Amount">{rm(boughtOn(d))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : <p className="cap">Nothing keyed in this month yet.</p>}
    </>
  )
}
