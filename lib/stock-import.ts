import 'server-only'
import ExcelJS from 'exceljs'
import { supabase } from './supabase'

// Reads Stock 2026.xlsx from Drive each morning (through the stock sheet's Apps Script)
// and loads it into purchases, stock_counts and stock_daily, the same way
// scripts/import-stock.mjs does by hand. Each month replaces what was there. A month
// whose rows don't add up to the sheet's own TOTAL is skipped and reported.

const MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }
const monthOf = (name: string) => {
  const hit = name.toUpperCase().match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s*(\d{4})/)
  return hit ? `${hit[2]}-${MONTHS[hit[1]]}` : null
}

type Cell = ExcelJS.CellValue
const value = (v: Cell): unknown => {
  if (v == null) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if ('result' in v) return value(v.result as Cell)
    if ('richText' in v) return v.richText.map(t => t.text).join('')
    if ('text' in v) return v.text
    return null
  }
  return v
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const round = (n: number) => Math.round(n * 100) / 100
const label = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

// Purchase sheets: dates down column A, suppliers across row 2, amounts where they meet.
function readPurchases(sheet: ExcelJS.Worksheet, month: string) {
  const suppliers: Record<number, string> = {}
  sheet.getRow(2).eachCell((cell, col) => { const name = label(value(cell.value)); if (name) suppliers[col] = name })
  const byKey = new Map<string, number>()
  sheet.eachRow((row, n) => {
    const first = value(row.getCell(1).value)
    if (!(first instanceof Date) || n < 3) return
    const date = first.toISOString().slice(0, 10)
    if (date.slice(0, 7) !== month) throw new Error(`${sheet.name} row ${n}: date ${date} is outside ${month}`)
    for (const [col, supplier] of Object.entries(suppliers)) {
      const amount = num(value(row.getCell(Number(col)).value))
      if (!amount) continue
      const key = `${date}|${supplier}`
      byKey.set(key, (byKey.get(key) ?? 0) + amount)
    }
  })
  return [...byKey].map(([key, amount]) => {
    const [purchase_date, supplier] = key.split('|')
    return { purchase_date, supplier, amount: round(amount) }
  })
}

// Stock sheets: one item per row, under a section heading with nothing else on its line.
// Columns H to AL are days 1 to 31 of what came in, adding up to TOTAL PURCHASES.
const COL = { volume: 2, uom: 3, price: 4, openQty: 6, openAmt: 7, day1: 8, buyQty: 39, buyAmt: 40, closeQty: 41, closeAmt: 42 }
type StockRow = {
  sheet_row: number; month: string; area: string; section: string; item: string; uom: string | null; unit_price: number
  opening_qty: number; opening_amount: number; bought_qty: number; bought_amount: number; closing_qty: number; closing_amount: number
  days: { stock_date: string; qty: number; amount: number }[]
}

type Total = { opening: number; bought: number; closing: number; from: number; to: number }
function readStock(sheet: ExcelJS.Worksheet, month: string): { rows: StockRow[]; total: Total | null } {
  const rows: StockRow[] = []
  let area = ''
  let section = ''
  let total = null as Total | null
  sheet.eachRow((row, n) => {
    if (n < 3) return
    const name = label(value(row.getCell(1).value))
    if (!name || total) return
    const cell = (c: number) => value(row.getCell(c).value)
    if (name.toUpperCase() === 'TOTAL') {
      const formula = (row.getCell(COL.closeAmt).value as { formula?: string } | null)?.formula ?? ''
      const range = /SUM\([A-Z]+(\d+):[A-Z]+(\d+)\)/.exec(formula)
      total = { opening: num(cell(COL.openAmt)), bought: num(cell(COL.buyAmt)), closing: num(cell(COL.closeAmt)), from: Number(range?.[1] ?? 0), to: Number(range?.[2] ?? 0) }
      return
    }
    const openAmt = num(cell(COL.openAmt)), buyAmt = num(cell(COL.buyAmt)), closeAmt = num(cell(COL.closeAmt))
    const openQty = num(cell(COL.openQty)), closeQty = num(cell(COL.closeQty))
    const hasDetails = cell(COL.uom) != null || cell(COL.volume) != null
    if (!hasDetails && !openAmt && !buyAmt && !closeAmt) {
      if (/^(BAR|KITCHEN)$/i.test(name)) { area = name; section = '' } else section = name
      return
    }
    if (!openAmt && !buyAmt && !closeAmt && !openQty && !closeQty) return
    const price = num(cell(COL.price))
    const days = []
    for (let col = COL.day1; col < COL.buyQty; col++) {
      const qty = num(cell(col))
      if (!qty) continue
      const stock_date = `${month}-${String(col - COL.day1 + 1).padStart(2, '0')}`
      if (Number.isNaN(Date.parse(stock_date)) || new Date(stock_date).toISOString().slice(0, 7) !== month) throw new Error(`${month}: an amount sits on day ${col - COL.day1 + 1}, which doesn't exist`)
      days.push({ stock_date, qty, amount: round(qty * price) })
    }
    rows.push({
      sheet_row: n, month, area, section, item: name, uom: label(cell(COL.uom)) || null, unit_price: price,
      opening_qty: openQty, opening_amount: round(openAmt), bought_qty: num(cell(COL.buyQty)), bought_amount: round(buyAmt),
      closing_qty: closeQty, closing_amount: round(closeAmt), days,
    })
  })
  return { rows, total }
}

const sum = <T>(rows: T[], key: keyof T) => round(rows.reduce((s, r) => s + Number(r[key]), 0))
const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

// Fetches the workbook from the Apps Script and saves every month that checks out.
export async function syncStockSheet(): Promise<{ saved: string[]; skipped: string[] }> {
  const url = process.env.STOCK_SCRIPT_URL?.trim()
  const secret = process.env.STOCK_SCRIPT_SECRET?.trim()
  if (!url || !secret) throw new Error('STOCK_SCRIPT_URL is not set')
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ secret, action: 'stockFile' }), redirect: 'follow' })
  const body = await res.json() as { ok: boolean; error?: string; data?: string }
  if (!body.ok || !body.data) throw new Error(`Reading Stock 2026 failed: ${body.error ?? res.status}`)

  const book = new ExcelJS.Workbook()
  await book.xlsx.load(Buffer.from(body.data, 'base64') as unknown as ArrayBuffer)
  const months = new Map<string, { purchases?: ReturnType<typeof readPurchases>; stock?: ReturnType<typeof readStock> }>()
  for (const sheet of book.worksheets) {
    const month = monthOf(sheet.name)
    if (!month) continue
    const entry = months.get(month) ?? {}
    if (/purchase/i.test(sheet.name)) entry.purchases = readPurchases(sheet, month)
    else entry.stock = readStock(sheet, month)
    months.set(month, entry)
  }

  const saved: string[] = []
  const skipped: string[] = []
  const check = ({ error }: { error: { message: string } | null }) => { if (error) throw new Error(error.message) }
  for (const [month, m] of [...months].sort()) {
    const t = m.stock?.total
    if (!m.stock || !m.purchases || !t) { skipped.push(month); continue }
    // The sheet's TOTAL is a SUM over a fixed row range that misses some items. Check
    // against that same range, and keep every item so the app shows the fuller figure.
    const counted = m.stock.rows.filter(r => r.sheet_row >= t.from && r.sheet_row <= t.to)
    const off = (a: number, b: number) => Math.abs(a - b) > 0.5
    if (off(sum(counted, 'opening_amount'), t.opening) || off(sum(counted, 'bought_amount'), t.bought) || off(sum(counted, 'closing_amount'), t.closing)) {
      skipped.push(month)
      continue
    }
    const last = lastDay(month)
    check(await supabase.from('purchases').delete().gte('purchase_date', `${month}-01`).lte('purchase_date', last))
    if (m.purchases.length) check(await supabase.from('purchases').insert(m.purchases))
    check(await supabase.from('stock_counts').delete().eq('month', month))
    check(await supabase.from('stock_counts').insert(m.stock.rows.map(({ sheet_row, days, ...row }) => row)))
    check(await supabase.from('stock_daily').delete().gte('stock_date', `${month}-01`).lte('stock_date', last))
    const daily = m.stock.rows.flatMap(r => r.days.map(d => ({ ...d, item: r.item })))
    if (daily.length) check(await supabase.from('stock_daily').insert(daily))
    saved.push(month)
  }
  return { saved, skipped }
}
