// Loads Stock 2026.xlsx into purchases and stock_counts. Each month replaces what was
// there, so running it again after the file changes is safe. A month whose rows don't
// add up to the sheet's own TOTAL is reported and skipped.
//   node --env-file=.env scripts/import-stock.mjs "path/to/Stock 2026.xlsx"          (check only)
//   node --env-file=.env scripts/import-stock.mjs "path/to/Stock 2026.xlsx" --write  (save)
import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'

const [file, flag] = process.argv.slice(2)
if (!file) throw new Error('Give the path to the Stock workbook.')

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }
const monthOf = name => {
  const hit = name.toUpperCase().match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s*(\d{4})/)
  return hit ? `${hit[2]}-${MONTHS[hit[1]]}` : null
}

const value = v => {
  if (v == null) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if ('result' in v) return value(v.result)
    if ('richText' in v) return v.richText.map(t => t.text).join('')
    if ('text' in v) return v.text
    return null
  }
  return v
}
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const round = n => Math.round(n * 100) / 100
const label = v => String(v ?? '').replace(/\s+/g, ' ').trim()

// Purchase sheets: dates down column A, suppliers across row 2, amounts where they meet.
function readPurchases(sheet, month) {
  const suppliers = {}
  sheet.getRow(2).eachCell((cell, col) => { const name = label(value(cell.value)); if (name) suppliers[col] = name })
  const byKey = new Map()
  let sheetTotal = 0
  const totals = {}
  sheet.eachRow((row, n) => {
    const first = value(row.getCell(1).value)
    if (label(first).toUpperCase() === 'TOTAL') {
      for (const col of Object.keys(suppliers)) {
        totals[col] = num(value(row.getCell(Number(col)).value))
        sheetTotal += totals[col]
      }
    }
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
  const rows = [...byKey].map(([key, amount]) => {
    const [purchase_date, supplier] = key.split('|')
    return { purchase_date, supplier, amount: round(amount) }
  })
  for (const [col, name] of Object.entries(suppliers)) {
    const days = rows.filter(r => r.supplier === name).reduce((s, r) => s + r.amount, 0)
    const same = Object.entries(suppliers).filter(([, other]) => other === name).reduce((s, [c]) => s + (totals[c] ?? 0), 0)
    if (Math.abs(days - same) > 0.5 && Object.keys(suppliers).find(c => suppliers[c] === name) === col) {
      console.log(`  ${month} ${name}: days add to ${round(days)}, TOTAL row says ${round(same)}`)
    }
  }
  return { rows, sheetTotal: round(sheetTotal) }
}

// Stock sheets: one item per row, under a section heading with nothing else on its line.
// Columns H to AL are days 1 to 31 of what came in, adding up to TOTAL PURCHASES.
const COL = { volume: 2, uom: 3, price: 4, openQty: 6, openAmt: 7, day1: 8, buyQty: 39, buyAmt: 40, closeQty: 41, closeAmt: 42 }
function readDays(row, month, price) {
  const days = []
  for (let col = COL.day1; col < COL.buyQty; col++) {
    const qty = num(value(row.getCell(col).value))
    if (!qty) continue
    const stock_date = `${month}-${String(col - COL.day1 + 1).padStart(2, '0')}`
    if (Number.isNaN(Date.parse(stock_date)) || new Date(stock_date).toISOString().slice(0, 7) !== month) throw new Error(`${month}: an amount sits on day ${col - COL.day1 + 1}, which doesn't exist`)
    days.push({ stock_date, qty, amount: round(qty * price) })
  }
  return days
}

function readStock(sheet, month) {
  const rows = []
  let area = ''
  let section = ''
  let total = null
  sheet.eachRow((row, n) => {
    if (n < 3) return
    const name = label(value(row.getCell(1).value))
    if (!name || total) return
    if (name.toUpperCase() === 'TOTAL') {
      const range = /SUM\([A-Z]+(\d+):[A-Z]+(\d+)\)/.exec(row.getCell(COL.closeAmt).value?.formula ?? '')
      total = {
        opening: num(value(row.getCell(COL.openAmt).value)), bought: num(value(row.getCell(COL.buyAmt).value)), closing: num(value(row.getCell(COL.closeAmt).value)),
        from: Number(range?.[1] ?? 0), to: Number(range?.[2] ?? 0),
      }
      return
    }
    const openAmt = num(value(row.getCell(COL.openAmt).value))
    const buyAmt = num(value(row.getCell(COL.buyAmt).value))
    const closeAmt = num(value(row.getCell(COL.closeAmt).value))
    const openQty = num(value(row.getCell(COL.openQty).value))
    const closeQty = num(value(row.getCell(COL.closeQty).value))
    const hasDetails = value(row.getCell(COL.uom).value) != null || value(row.getCell(COL.volume).value) != null
    if (!hasDetails && !openAmt && !buyAmt && !closeAmt) {
      if (/^(BAR|KITCHEN)$/i.test(name)) { area = name; section = '' } else section = name
      return
    }
    if (!openAmt && !buyAmt && !closeAmt && !openQty && !closeQty) return
    rows.push({
      sheet_row: n, month, area, section, item: name,
      uom: label(value(row.getCell(COL.uom).value)) || null,
      unit_price: num(value(row.getCell(COL.price).value)),
      opening_qty: openQty, opening_amount: round(openAmt),
      bought_qty: num(value(row.getCell(COL.buyQty).value)), bought_amount: round(buyAmt),
      closing_qty: closeQty, closing_amount: round(closeAmt),
      days: readDays(row, month, num(value(row.getCell(COL.price).value))),
    })
  })
  return { rows, total }
}

const sum = (rows, key) => round(rows.reduce((s, r) => s + r[key], 0))

const book = new ExcelJS.Workbook()
await book.xlsx.readFile(file)

const months = []
for (const sheet of book.worksheets) {
  const month = monthOf(sheet.name)
  if (!month) { console.log(`Skipped sheet "${sheet.name}"`); continue }
  let entry = months.find(m => m.month === month)
  if (!entry) months.push(entry = { month })
  if (/purchase/i.test(sheet.name)) entry.purchases = readPurchases(sheet, month)
  else entry.stock = readStock(sheet, month)
}

let bad = 0
for (const m of months) {
  const buy = sum(m.purchases.rows, 'amount')
  // The sheet's TOTAL is a SUM over a fixed row range that misses some items. Check
  // against that same range, and keep every item so the app shows the fuller figure.
  const counted = m.stock.rows.filter(r => r.sheet_row >= m.stock.total.from && r.sheet_row <= m.stock.total.to)
  const open = sum(counted, 'opening_amount')
  const bought = sum(counted, 'bought_amount')
  const close = sum(counted, 'closing_amount')
  const t = m.stock.total
  const bySection = {}
  for (const r of m.stock.rows) bySection[`${r.area}/${r.section}`] = round((bySection[`${r.area}/${r.section}`] ?? 0) + r.closing_amount)
  if (process.env.SHOW_SECTIONS) console.log(bySection)
  const off = (a, b) => Math.abs(a - b) > 0.5
  // Supplier TOTAL rows miss whole columns in some months, so the days are what we trust.
  m.ok = !off(open, t.opening) && !off(bought, t.bought) && !off(close, t.closing)
  if (!m.ok) bad++
  console.log(`${m.month} ${m.ok ? 'OK ' : 'BAD'} supplier purchases ${buy} (sheet ${m.purchases.sheetTotal}), ${m.purchases.rows.length} rows | stock ${m.stock.rows.length} items, opening ${open} (${t?.opening}), bought ${bought} (${t?.bought}), closing ${close} (${t?.closing})`)
}

for (const m of months) {
  const qty = m.stock.rows.reduce((s, r) => s + r.days.reduce((d, x) => d + x.qty, 0), 0)
  const sheetQty = m.stock.rows.reduce((s, r) => s + r.bought_qty, 0)
  const amount = sum(m.stock.rows.flatMap(r => r.days), 'amount')
  console.log(`${m.month} daily: qty ${round(qty)} (sheet ${round(sheetQty)}), amount ${amount} (sheet ${sum(m.stock.rows, 'bought_amount')})`)
}

if (flag !== '--write' && flag !== '--daily') {
  console.log(`\nChecked only. ${bad} month(s) failed. Add --write to save, or --daily for the daily rows alone.`)
  process.exit(0)
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const check = ({ error }) => { if (error) throw new Error(error.message) }
for (const m of months) {
  if (!m.ok) { console.log(`Not saved: ${m.month}`); continue }
  const [y, mo] = m.month.split('-').map(Number)
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)
  if (flag === '--write') {
    check(await db.from('purchases').delete().gte('purchase_date', `${m.month}-01`).lte('purchase_date', last))
    check(await db.from('purchases').insert(m.purchases.rows))
    check(await db.from('stock_counts').delete().eq('month', m.month))
    check(await db.from('stock_counts').insert(m.stock.rows.map(({ sheet_row, days, ...row }) => row)))
  }
  check(await db.from('stock_daily').delete().gte('stock_date', `${m.month}-01`).lte('stock_date', last))
  check(await db.from('stock_daily').insert(m.stock.rows.flatMap(r => r.days.map(d => ({ ...d, item: r.item })))))
  console.log(`Saved ${m.month}`)
}
