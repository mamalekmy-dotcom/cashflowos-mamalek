import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth'
import { posConfigured, posDays } from '@/lib/geniuspos'
import { supabase } from '@/lib/supabase'

// Owner-only check of what GeniusPOS returns for a date range. It saves nothing, so it
// can be run as often as needed while the figures are being matched to the POS reports.
//   /api/pos-sync?from=2026-10-01&to=2026-10-31

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
