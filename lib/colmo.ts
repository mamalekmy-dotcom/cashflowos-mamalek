// Reads a Colmo "X Reading Report": one row per metric, one column per day. Rows are
// found by label, never by position, because the list changes between months (AMEX
// only appears in some). Plain data in, plain data out, so it's easy to test.

export type DaySales = {
  sale_date: string
  net_sales: number
  dine_in: number
  to_go: number
  delivery: number
  discount: number
  voids: number
  receipts: number
  pax: number
  cash: number
  qr: number
  card: number
  online: number
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// "Cash - 316" and "Cash" are the same row: the number is a transaction count.
const label = (cell: unknown) => String(cell ?? '').trim().replace(/\s*-\s*\d+$/, '').toLowerCase()

function amount(cell: unknown): number {
  const n = typeof cell === 'number' ? cell : Number(String(cell ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

// Day columns come from the header, e.g. "1 Sep, Tuesday". The report only states the
// year in its "Date From" line, so a run crossing New Year rolls forward.
function dayColumns(rows: unknown[][]): Map<number, string> {
  const start = rows.flat().map(c => String(c ?? '').match(/Date From:\s*(\d{4})-(\d{2})/)).find(Boolean)
  if (!start) throw new Error("This doesn't look like a Colmo X Reading Report.")
  const header = rows.find(r => r.some(c => label(c) === 'description'))
  if (!header) throw new Error('Could not find the day columns in this report.')

  const startMonth = Number(start[2]) - 1
  const columns = new Map<number, string>()
  header.forEach((cell, col) => {
    const match = String(cell ?? '').match(/^(\d{1,2}) ([A-Za-z]{3}),/)
    if (!match) return
    const month = MONTHS.indexOf(match[2].toLowerCase())
    if (month < 0) return
    const year = Number(start[1]) + (month < startMonth ? 1 : 0)
    const mm = String(month + 1).padStart(2, '0')
    columns.set(col, `${year}-${mm}-${match[1].padStart(2, '0')}`)
  })
  if (columns.size === 0) throw new Error('Could not find the day columns in this report.')
  return columns
}

export function parseColmo(rows: unknown[][]): DaySales[] {
  const columns = dayColumns(rows)
  const metric = (...names: string[]) => (col: number) =>
    names.reduce((sum, name) => {
      const row = rows.find(r => r.some(c => label(c) === name))
      if (!row) return sum
      return sum + amount(row[col])
    }, 0)

  const netSales = metric('net sales')
  const dineIn = metric('net sales (dine in)')
  const toGo = metric('net sales (to go)')
  const delivery = metric('net sales (delivery)', 'net sales (collection)')
  const discount = metric('total discount')
  const voids = metric('voided sales')
  const receipts = metric('no of receipt')
  const pax = metric('pax')
  const cash = metric('cash')
  const qr = metric('qr pay')
  const card = metric('visa', 'master', 'mydebit', 'amex')
  const online = metric('online order', 'grabfood', 'shopee')

  const days: DaySales[] = []
  for (const [col, sale_date] of columns) {
    if (netSales(col) === 0 && receipts(col) === 0) continue // closed day
    days.push({
      sale_date,
      net_sales: netSales(col),
      dine_in: dineIn(col),
      to_go: toGo(col),
      delivery: delivery(col),
      discount: discount(col),
      voids: voids(col),
      receipts: receipts(col),
      pax: pax(col),
      cash: cash(col),
      qr: qr(col),
      card: card(col),
      online: online(col),
    })
  }
  return days
}
