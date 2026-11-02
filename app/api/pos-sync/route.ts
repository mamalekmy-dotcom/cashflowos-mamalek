import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth'
import { posConfigured, posDays } from '@/lib/geniuspos'
import { supabase } from '@/lib/supabase'
import { syncPosDays } from '@/lib/pos-sync'

// Owner-only check of what GeniusPOS returns for a date range, next to what daily_sales
// holds. It saves nothing unless ?save=1 is added.
//   /api/pos-sync?from=2026-10-01&to=2026-10-31
//   /api/pos-sync?from=2026-11-01&to=2026-11-03&save=1

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isDate = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)

export async function GET(req: Request) {
  await requireOwner()
  if (!posConfigured()) return NextResponse.json({ ok: false, message: 'GeniusPOS keys are not in Vercel yet.' })
  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to') ?? from
  if (!isDate(from) || !isDate(to)) return NextResponse.json({ ok: false, message: 'Add ?from=YYYY-MM-DD&to=YYYY-MM-DD' })
  // ?save=1 copies the days into daily_sales now, the same as the morning run does.
  if (url.searchParams.get('save') === '1') {
    try {
      return NextResponse.json({ ok: true, ...(await syncPosDays(from as string, to as string)) })
    } catch (e) {
      return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : 'POS sync failed.' }, { status: 502 })
    }
  }
  try {
    const days = await posDays(from as string, to as string)
    const sum = (key: 'grand_total' | 'tax' | 'rounding' | 'discount' | 'void_amount' | 'cost' | 'receipts' | 'pax') =>
      Math.round(days.reduce((s, d) => s + d[key], 0) * 100) / 100
    const payments: Record<string, number> = {}
    for (const d of days) for (const [k, v] of Object.entries(d.payments)) payments[k] = Math.round(((payments[k] ?? 0) + v) * 100) / 100
    // What the X Reading imports already hold for these days, to line the two up.
    const { data: stored } = await supabase.from('daily_sales')
      .select('sale_date, net_sales, receipts, pax, cash, qr, card, discount, voids, source')
      .gte('sale_date', from as string).lte('sale_date', to as string).order('sale_date')
    return NextResponse.json({
      ok: true, from, to, days: days.length, stored: stored ?? [],
      totals: {
        grand_total: sum('grand_total'), tax: sum('tax'), rounding: sum('rounding'), discount: sum('discount'),
        void_amount: sum('void_amount'), cost: sum('cost'), receipts: sum('receipts'), pax: sum('pax'), payments,
      },
      byDay: days,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : 'GeniusPOS request failed.' }, { status: 502 })
  }
}
