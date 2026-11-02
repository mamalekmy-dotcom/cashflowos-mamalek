import 'server-only'
import { supabase } from './supabase'
import { posDays } from './geniuspos'

// Copies GeniusPOS days into daily_sales, the table the dashboard reads. Days already
// loaded from the X Reading reports (source colmo or manual) are left alone: those were
// checked by hand, and on October they match GeniusPOS on net sales, receipts and every
// payment type. Pax and voids differ a little, so a day's source shows where it came from.

const CARD = new Set(['Master', 'MyDebit', 'Visa', 'AMEX'])
const round = (x: number) => Math.round(x * 100) / 100

export async function syncPosDays(from: string, to: string): Promise<{ written: string[]; kept: string[] }> {
  const [days, { data: existing }] = await Promise.all([
    posDays(from, to),
    supabase.from('daily_sales').select('sale_date, source').gte('sale_date', from).lte('sale_date', to),
  ])
  const keep = new Set((existing ?? []).filter(r => r.source !== 'geniuspos').map(r => r.sale_date as string))

  const rows = days.filter(d => !keep.has(d.date) && d.receipts > 0).map(d => {
    let cash = 0, qr = 0, card = 0, online = 0
    for (const [name, amount] of Object.entries(d.payments)) {
      if (name === 'Cash') cash += amount
      else if (name === 'QR Pay') qr += amount
      else if (CARD.has(name)) card += amount
      else online += amount
    }
    return {
      sale_date: d.date,
      // Matches the X Reading net sales: before discounts, without tax and rounding.
      net_sales: round(d.grand_total - d.tax + d.discount - d.rounding),
      service_charge: d.service_charge,
      sst: d.sst,
      discount: d.discount,
      voids: d.void_amount,
      receipts: d.receipts,
      pax: d.pax,
      cash: round(cash), qr: round(qr), card: round(card), online: round(online),
      source: 'geniuspos',
      updated_at: new Date().toISOString(),
    }
  })
  if (rows.length) {
    const { error } = await supabase.from('daily_sales').upsert(rows, { onConflict: 'sale_date' })
    if (error) throw new Error(`Saving POS days failed: ${error.message}`)
  }
  // The X Reading imports carry no service charge or SST, so only those two are filled in.
  for (const d of days.filter(x => keep.has(x.date))) {
    const { error } = await supabase.from('daily_sales').update({ service_charge: d.service_charge, sst: d.sst }).eq('sale_date', d.date)
    if (error) throw new Error(`Saving service charge for ${d.date} failed: ${error.message}`)
  }
  return { written: rows.map(r => r.sale_date), kept: [...keep].sort() }
}
