// Stock sheet writer. Paste this into the sheet: Extensions > Apps Script.
// The Telegram bot posts here, so it only ever touches the sheet through these actions.
// Script property BOT_SECRET must match STOCK_SCRIPT_SECRET in Vercel.

const LOG_TAB = 'Receipt Log'
const MATCH_TAB = 'Bot Matches'
const LOG_HEADERS = ['Logged', 'Receipt date', 'Supplier', 'Invoice', 'Item', 'Receipt text', 'Qty', 'Unit', 'Unit price', 'Amount', 'Bill total', 'Photo', 'Sent by', 'Key']
const MATCH_HEADERS = ['Kind', 'Receipt text', 'Sheet name']
const NOT_STOCK = '(not stock)'

// Column layout of the stock tabs, 1-based.
const COL = { name: 1, volume: 2, uom: 3, price: 4, open: 6, day1: 8, day31: 38, close: 41 }
const PURCHASE_FIRST_ROW = 3
const PURCHASE_LAST_ROW = 34
const SUPPLIER_ROW = 2

const STOCK_MONTHS = ['JANUARY.', 'FEBRUARY.', 'MARCH.', 'APR.', 'MAY.', 'JUNE.', 'JULY.', 'AUG.', 'SEPT.', 'OCT.', 'NOV.', 'DEC.']
const PURCHASE_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May.', 'June.', 'July.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']

function doPost(e) {
  const out = body => ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON)
  try {
    const req = JSON.parse(e.postData.contents)
    const secret = PropertiesService.getScriptProperties().getProperty('BOT_SECRET')
    if (!secret || req.secret !== secret) return out({ ok: false, error: 'forbidden' })
    const run = { context, addAlias, writeReceipt, setPrice, ensureMonth, syncOpening }[req.action]
    if (!run) return out({ ok: false, error: 'unknown action' })
    const lock = LockService.getScriptLock()
    lock.waitLock(25000)
    try {
      return out(Object.assign({ ok: true }, run(req)))
    } finally {
      lock.releaseLock()
    }
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) })
  }
}

const tabsFor = ym => {
  const [y, m] = ym.split('-').map(Number)
  return { stock: `${STOCK_MONTHS[m - 1]} ${y}`, purchase: `Purchase for ${PURCHASE_MONTHS[m - 1]} ${y}` }
}
const prevYm = ym => {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
const same = (a, b) => clean(a).toUpperCase() === clean(b).toUpperCase()
const isoDate = d => Utilities.formatDate(d, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd')

function tab(name, headers) {
  const ss = SpreadsheetApp.getActive()
  let sheet = ss.getSheetByName(name)
  if (!sheet) {
    sheet = ss.insertSheet(name, ss.getSheets().length)
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold')
    sheet.setFrozenRows(1)
  }
  return sheet
}

// The row holding TOTAL ends the item list.
function totalRow(sheet) {
  const names = sheet.getRange(1, COL.name, sheet.getLastRow(), 1).getValues()
  for (let i = 2; i < names.length; i++) if (same(names[i][0], 'TOTAL')) return i + 1
  throw new Error(`No TOTAL row in ${sheet.getName()}`)
}

function readItems(sheet) {
  const last = totalRow(sheet) - 1
  const rows = sheet.getRange(1, 1, last, COL.price).getValues()
  const items = []
  let section = ''
  rows.forEach((r, i) => {
    if (i < 2 || !clean(r[0])) return
    if (r[1] === '' && r[3] === '') { section = clean(r[0]); return }
    items.push({ row: i + 1, name: clean(r[0]), volume: r[1], uom: clean(r[2]), price: r[3], section })
  })
  return items
}

function readSuppliers(sheet) {
  const row = sheet.getRange(SUPPLIER_ROW, 2, 1, sheet.getLastColumn() - 1).getValues()[0]
  const list = []
  row.forEach((v, i) => { if (clean(v)) list.push({ col: i + 2, name: clean(v) }) })
  return list
}

// Falls back to the newest existing tabs when the receipt's month has none yet.
function latestTabs(ym) {
  const ss = SpreadsheetApp.getActive()
  let at = ym
  for (let i = 0; i < 24; i++) {
    const t = tabsFor(at)
    const stock = ss.getSheetByName(t.stock)
    const purchase = ss.getSheetByName(t.purchase)
    if (stock && purchase) return { stock, purchase }
    at = prevYm(at)
  }
  throw new Error('No month tabs found')
}

function context(req) {
  const { stock, purchase } = latestTabs(req.ym)
  const matches = tab(MATCH_TAB, MATCH_HEADERS)
  const aliases = matches.getLastRow() < 2 ? [] : matches.getRange(2, 1, matches.getLastRow() - 1, 3).getValues()
    .map(r => ({ kind: clean(r[0]), text: clean(r[1]), target: clean(r[2]) }))
  const logSheet = tab(LOG_TAB, LOG_HEADERS)
  const rows = logSheet.getLastRow() < 2 ? [] : logSheet.getRange(2, 1, logSheet.getLastRow() - 1, LOG_HEADERS.length).getValues()
  const log = rows.map(r => ({
    date: r[1] instanceof Date ? isoDate(r[1]) : clean(r[1]),
    supplier: clean(r[2]),
    item: clean(r[4]),
    unit: clean(r[7]),
    price: Number(r[8]) || 0,
    key: clean(r[13]),
  }))
  return { items: readItems(stock), suppliers: readSuppliers(purchase), aliases, log }
}

function addAlias(req) {
  const matches = tab(MATCH_TAB, MATCH_HEADERS)
  const rows = matches.getLastRow() < 2 ? [] : matches.getRange(2, 1, matches.getLastRow() - 1, 2).getValues()
  const at = rows.findIndex(r => same(r[0], req.kind) && same(r[1], req.text))
  if (at >= 0) matches.getRange(at + 2, 3).setValue(req.target)
  else matches.appendRow([req.kind, req.text, req.target])
  return {}
}

function ensureMonth(req) {
  const ss = SpreadsheetApp.getActive()
  const t = tabsFor(req.ym)
  if (ss.getSheetByName(t.stock) && ss.getSheetByName(t.purchase)) return { created: false, stock: t.stock, purchase: t.purchase }
  const before = tabsFor(prevYm(req.ym))
  const oldStock = ss.getSheetByName(before.stock)
  const oldPurchase = ss.getSheetByName(before.purchase)
  if (!oldStock || !oldPurchase) throw new Error(`Previous month tabs missing: ${before.stock}`)

  const stock = ss.getSheetByName(t.stock) || oldStock.copyTo(ss).setName(t.stock)
  const last = totalRow(stock) - 1
  const rows = last - 2
  const closing = oldStock.getRange(3, COL.close, rows, 1).getValues()
  stock.getRange(3, COL.open, rows, 1).setValues(closing.map(r => [typeof r[0] === 'number' ? r[0] : '']))
  stock.getRange(3, COL.day1, rows, COL.day31 - COL.day1 + 1).clearContent()
  stock.getRange(3, COL.close, rows, 1).clearContent()

  const purchase = ss.getSheetByName(t.purchase) || oldPurchase.copyTo(ss).setName(t.purchase)
  const count = PURCHASE_LAST_ROW - PURCHASE_FIRST_ROW + 1
  purchase.getRange(PURCHASE_FIRST_ROW, 2, count, purchase.getLastColumn() - 1).clearContent()
  const [y, m] = req.ym.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  // Midnight in the sheet's own time zone, or the day shows one off when the two differ.
  const zone = ss.getSpreadsheetTimeZone()
  const day = d => Utilities.parseDate(`${req.ym}-${String(d).padStart(2, '0')}`, zone, 'yyyy-MM-dd')
  const dates = []
  for (let i = 0; i < count; i++) dates.push([i < days ? day(i + 1) : ''])
  purchase.getRange(PURCHASE_FIRST_ROW, 1, count, 1).setValues(dates)
  return { created: true, stock: t.stock, purchase: t.purchase }
}

// After a stock count: bring last month's Closing into this month's Opening.
function syncOpening(req) {
  const ss = SpreadsheetApp.getActive()
  const t = tabsFor(req.ym)
  const before = tabsFor(prevYm(req.ym))
  const stock = ss.getSheetByName(t.stock)
  const oldStock = ss.getSheetByName(before.stock)
  if (!stock || !oldStock) throw new Error('Month tabs missing')
  const closing = {}
  readItems(oldStock).forEach(it => { closing[it.name.toUpperCase()] = oldStock.getRange(it.row, COL.close).getValue() })
  let filled = 0
  let blank = 0
  readItems(stock).forEach(it => {
    const v = closing[it.name.toUpperCase()]
    if (typeof v === 'number') { stock.getRange(it.row, COL.open).setValue(v); filled++ } else blank++
  })
  return { filled, blank }
}

function addTo(range, amount) {
  const formula = range.getFormula()
  if (formula) { range.setFormula(`${formula}+${amount}`); return }
  const now = range.getValue()
  const base = typeof now === 'number' ? now : 0
  range.setValue(Math.round((base + amount) * 1000) / 1000)
}

function savePhoto(photo, date, supplier, invoice) {
  const ss = SpreadsheetApp.getActive()
  const parent = DriveApp.getFileById(ss.getId()).getParents().next()
  const sub = (folder, name) => {
    const hit = folder.getFoldersByName(name)
    return hit.hasNext() ? hit.next() : folder.createFolder(name)
  }
  const safe = supplier.replace(/[\\/:*?"<>|]/g, ' ').trim()
  const folder = sub(sub(sub(parent, 'Receipts'), date.slice(0, 7)), safe)
  const ext = photo.mime === 'application/pdf' ? 'pdf' : photo.mime === 'image/png' ? 'png' : 'jpg'
  const name = `${date} ${safe}${invoice ? ' ' + invoice.replace(/[\\/:*?"<>|]/g, '-') : ''}.${ext}`
  const blob = Utilities.newBlob(Utilities.base64Decode(photo.base64), photo.mime, name)
  return folder.createFile(blob).getUrl()
}

function writeReceipt(req) {
  const { key, date, supplier, invoice, total, lines, photo, sentBy, logOnly } = req
  const logSheet = tab(LOG_TAB, LOG_HEADERS)
  if (logSheet.getLastRow() > 1) {
    const keys = logSheet.getRange(2, LOG_HEADERS.length, logSheet.getLastRow() - 1, 1).getValues()
    if (keys.some(r => same(r[0], key))) return { duplicate: true }
  }

  const ym = date.slice(0, 7)
  const day = Number(date.slice(8, 10))
  const stockLines = lines.filter(l => l.item && l.item !== NOT_STOCK)
  const cells = []
  let purchaseCell = null

  if (!logOnly) {
    ensureMonth({ ym })
    const t = tabsFor(ym)
    const ss = SpreadsheetApp.getActive()
    const stock = ss.getSheetByName(t.stock)
    const purchase = ss.getSheetByName(t.purchase)

    // Find every cell first, so a bad line stops the whole bill before anything is written.
    const items = readItems(stock)
    const header = stock.getRange(1, COL.day1, 1, COL.day31 - COL.day1 + 1).getValues()[0]
    const dayAt = header.findIndex(v => Number(v) === day)
    if (dayAt < 0) throw new Error(`No day ${day} column in ${t.stock}`)
    stockLines.forEach(l => {
      const it = items.find(x => same(x.name, l.item))
      if (!it) throw new Error(`Item not in ${t.stock}: ${l.item}`)
      cells.push({ range: stock.getRange(it.row, COL.day1 + dayAt), qty: Number(l.qty) })
    })

    const sup = readSuppliers(purchase).find(s => same(s.name, supplier))
    if (!sup) throw new Error(`Supplier not in ${t.purchase}: ${supplier}`)
    const dates = purchase.getRange(PURCHASE_FIRST_ROW, 1, PURCHASE_LAST_ROW - PURCHASE_FIRST_ROW + 1, 1).getValues()
    const at = dates.findIndex(r => r[0] instanceof Date && isoDate(r[0]) === date)
    if (at < 0) throw new Error(`No ${date} row in ${t.purchase}`)
    purchaseCell = purchase.getRange(PURCHASE_FIRST_ROW + at, sup.col)

    cells.forEach(c => addTo(c.range, c.qty))
    addTo(purchaseCell, Number(total))
  }

  const link = photo ? savePhoto(photo, date, supplier, invoice) : ''
  const now = new Date()
  const rows = (lines.length ? lines : [{}]).map(l => [
    now, date, supplier, invoice || '', l.item === NOT_STOCK ? '' : l.item || '', l.text || '',
    l.qty == null ? '' : l.qty, l.unit || '', l.price == null ? '' : l.price, l.amount == null ? '' : l.amount,
    total, link, sentBy || '', key,
  ])
  logSheet.getRange(logSheet.getLastRow() + 1, 1, rows.length, LOG_HEADERS.length).setValues(rows)
  return { duplicate: false, link, wrote: cells.length }
}

function setPrice(req) {
  const t = tabsFor(req.ym)
  const stock = SpreadsheetApp.getActive().getSheetByName(t.stock)
  if (!stock) throw new Error(`No tab ${t.stock}`)
  const it = readItems(stock).find(x => same(x.name, req.item))
  if (!it) throw new Error(`Item not in ${t.stock}: ${req.item}`)
  stock.getRange(it.row, COL.price).setValue(Number(req.price))
  return { old: it.price, tab: t.stock }
}
