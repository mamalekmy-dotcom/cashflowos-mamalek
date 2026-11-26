// Stock sheet writer. The Telegram bot posts here, so it only ever touches the sheet
// through these actions. Script property BOT_SECRET must match STOCK_SCRIPT_SECRET in Vercel.
// It works on the sheet named by SHEET_ID, whichever file the script itself sits in.

// "Copy of Stock 2026 Test or AI DASHBOARD" (Google Sheet). The bot writes bills here
// and the COGS Report reads it. Change this one line to move to another sheet.
const SHEET_ID = '1ByUebLuUYp8neYAZEhglIVVzi5__3Bc2Vm2w8EwwmUU'
let openBook = null
const book = () => openBook || (openBook = SpreadsheetApp.openById(SHEET_ID))

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
    const run = { context, addAlias, writeReceipt, setPrice, ensureMonth, syncOpening, stockFile, mgmtReport, saveInvoice, trashInvoice, saveDoc, removeReceipt }[req.action]
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

// "Mama Lek Management Report 2026": the app rewrites it every morning. A Summary tab
// with one row a month, and one tab a month with every line.
const MGMT_ID = '1BDY-rFBAPFcwB25nZhxqe88al0nKQ44mpS2AH0KJPfo'

function mgmtReport(req) {
  const ss = SpreadsheetApp.openById(MGMT_ID)
  const write = (name, rows, money) => {
    const tab = ss.getSheetByName(name) || ss.insertSheet(name)
    tab.clear()
    if (!rows.length) return tab
    tab.getRange(1, 1, rows.length, rows[0].length).setValues(rows)
    tab.getRange(1, 1, 1, rows[0].length).setFontWeight('bold')
    if (money) tab.getRange(2, money, rows.length - 1, 1).setNumberFormat('#,##0.00')
    tab.autoResizeColumns(1, rows[0].length)
    return tab
  }
  const summary = write('Summary', req.summary, null)
  if (req.summary.length > 1) summary.getRange(2, 2, req.summary.length - 1, 5).setNumberFormat('#,##0.00')
  ss.setActiveSheet(summary)
  ss.moveActiveSheet(1)
  for (const m of req.months) write(m.month, m.rows, 2)
  const blank = ss.getSheetByName('Sheet1')
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank)
  return { months: req.months.length, link: ss.getUrl() }
}

// The sheet as an .xlsx, for the app's morning COGS refresh. Read only.
function stockFile() {
  const file = DriveApp.getFileById(SHEET_ID)
  const xlsx = UrlFetchApp.fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`, {
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
  })
  return { name: file.getName(), modified: file.getLastUpdated().toISOString(), data: Utilities.base64Encode(xlsx.getBlob().getBytes()) }
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
const isoDate = d => Utilities.formatDate(d, book().getSpreadsheetTimeZone(), 'yyyy-MM-dd')

function tab(name, headers) {
  const ss = book()
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
  const ss = book()
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
  const suppliers = readSuppliers(purchase)
  return { items: readItems(stock), suppliers, aliases, log, filled: filledOn(purchase, suppliers, req.date) }
}

// What each Purchase column already holds on one date, so the bot can ask before
// adding a bill that was also keyed in by hand.
function filledOn(purchase, suppliers, date) {
  if (!date) return []
  const dates = purchase.getRange(PURCHASE_FIRST_ROW, 1, PURCHASE_LAST_ROW - PURCHASE_FIRST_ROW + 1, 1).getValues()
  const at = dates.findIndex(r => r[0] instanceof Date && isoDate(r[0]) === date)
  if (at < 0) return []
  const row = purchase.getRange(PURCHASE_FIRST_ROW + at, 1, 1, purchase.getLastColumn()).getValues()[0]
  return suppliers.map(s => ({ supplier: s.name, amount: Number(row[s.col - 1]) || 0 })).filter(f => f.amount)
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
  const ss = book()
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
  const ss = book()
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
  if (formula) { range.setFormula(`${formula}${amount < 0 ? "" : "+"}${amount}`); return }
  const now = range.getValue()
  const base = typeof now === 'number' ? now : 0
  range.setValue(Math.round((base + amount) * 1000) / 1000)
}

// Bills are kept under STOCK COUNT in one folder a year, "Suppliers Invoices 2026",
// then one folder per supplier, then month as "11 NOV". A new year's folder is made
// the first time a bill from that year arrives. The 2026 folder was "Suppliers
// Invoices" (supplier > year > month) until migrateInvoiceFolders() reshaped it.
const STOCK_COUNT_FOLDER_ID = '1ZXHsKifom1cc1nmFhE8k_PEF9EvZeBT2'
const INVOICES_FOLDER_ID = '1ejOvbXgotMGAhI5xN5I5MGSYY0TryPYN' // "Suppliers Invoices 2026"
const MONTH_FOLDERS = ['01 JAN', '02 FEB', '03 MAR', '04 APR', '05 MAY', '06 JUN', '07 JUL', '08 AUG', '09 SEP', '10 OCT', '11 NOV', '12 DEC']
const FOLDER_NOISE = ['SDN', 'BHD', 'THE', 'AND', 'TRADING', 'MARKETING', 'ENTERPRISE', 'FROZEN', 'FOOD', 'FRESH', 'CASH', 'CARRY', 'MOHD', 'BIN']
const folderWords = s => clean(s).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && FOLDER_NOISE.indexOf(w) < 0)
const yearFolderName = year => `Suppliers Invoices ${year}`

function subFolder(folder, name) {
  const hit = folder.getFoldersByName(name)
  return hit.hasNext() ? hit.next() : folder.createFolder(name)
}

function yearRoot(year) {
  if (String(year) === '2026') return DriveApp.getFolderById(INVOICES_FOLDER_ID)
  return subFolder(DriveApp.getFolderById(STOCK_COUNT_FOLDER_ID), yearFolderName(year))
}

// The owner names supplier folders their own way ("ATLAS (ICE)", "ZEST FROZEN FOOD
// SDN BHD"), so match on the main word of the sheet column, then of the name printed
// on the bill. With no match, a folder is made under the clearest name.
function supplierFolder(root, names) {
  const folders = []
  const it = root.getFolders()
  while (it.hasNext()) {
    const f = it.next()
    if (f.getName() !== '_Rejected') folders.push(f)
  }
  const squash = s => clean(s).toUpperCase().replace(/[^A-Z0-9]+/g, '')
  for (const name of names) {
    const want = folderWords(name)
    const flat = squash(name)
    if (!flat) continue
    const exact = folders.find(f => same(f.getName(), name))
    if (exact) return exact
    // "MR D.I.Y. (KUCHAI)" holds "MRDIY"; "IRAS SELERA (BEEF BALL)" holds "IRASSELERA".
    const inside = folders.find(f => squash(f.getName()).length >= 4 && (flat.indexOf(squash(f.getName())) >= 0 || squash(f.getName()).indexOf(flat) >= 0))
    if (inside) return inside
    // One word in common, only when no other folder shares it ("VEGETABLES" is in three).
    const hits = want.length ? folders.filter(f => folderWords(f.getName()).indexOf(want[0]) >= 0) : []
    if (hits.length === 1) return hits[0]
  }
  const label = names.find(n => folderWords(n).length) || 'OTHERS'
  return root.createFolder(clean(label).replace(/[\\/:*?"<>|]/g, ' '))
}

const fileSafe = s => String(s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()

// "2026-11-03 LUCKY FROZEN SG26-151219 RM11562.pdf" in Suppliers Invoices 2026 > LUCKY FROZEN > 11 NOV.
function savePhoto(photo, date, supplier, invoice, printed, total) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd')
  // OTHERS is a Purchase column, not a supplier, so the printed name decides the folder.
  const names = (supplier === 'OTHERS' ? [printed, supplier] : [supplier, printed]).filter(Boolean)
  const folder = subFolder(supplierFolder(yearRoot(day.slice(0, 4)), names.length ? names : ['OTHERS']), MONTH_FOLDERS[Number(day.slice(5, 7)) - 1])
  const ext = photo.mime === 'application/pdf' ? 'pdf' : photo.mime === 'image/png' ? 'png' : 'jpg'
  const who = fileSafe(supplier === 'OTHERS' && printed ? printed : supplier || printed || 'Unknown')
  const amount = Number(total) > 0 ? ` RM${Math.round(Number(total) * 100) / 100}` : ''
  const name = `${day} ${who}${invoice ? ' ' + fileSafe(invoice) : ''}${amount}.${ext}`
  const blob = Utilities.newBlob(Utilities.base64Decode(photo.base64), photo.mime, name)
  const file = folder.createFile(blob)
  return { link: file.getUrl(), fileId: file.getId() }
}

// Saved as soon as a bill is uploaded and read, before anyone approves it.
function saveInvoice(req) {
  if (!req.photo || !req.photo.base64) throw new Error('No file')
  return savePhoto(req.photo, req.date, req.supplier || '', req.invoice || '', req.printed || '', req.total)
}

// A rejected, cancelled or duplicate bill comes out of the folders (Drive trash keeps it
// 30 days). Only files inside a "Suppliers Invoices" folder can be trashed this way.
function trashInvoice(req) {
  const file = DriveApp.getFileById(req.fileId)
  let parent = file.getParents().hasNext() ? file.getParents().next() : null
  for (let i = 0; parent && i < 4; i++) {
    if (/^Suppliers Invoices/.test(parent.getName())) {
      file.setTrashed(true)
      return { trashed: true }
    }
    parent = parent.getParents().hasNext() ? parent.getParents().next() : null
  }
  throw new Error('That file is not in a Suppliers Invoices folder')
}

// Doc Center files (utilities, maintenance, claims, menus...): STOCK COUNT > Doc Center <year>
// > folder > month, named "2026-11-24 TNB electricity RM2910.pdf".
const DOC_FOLDERS = ['Claim', 'Utilities & Rental', 'Maintenance', 'Sales Report', 'Menu', 'Quotation & Market Research', 'Other']
function saveDoc(req) {
  if (!req.photo || !req.photo.base64) throw new Error('No file')
  if (DOC_FOLDERS.indexOf(req.folder) < 0) throw new Error('Unknown folder')
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.date || '')) ? req.date : Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd')
  const root = subFolder(DriveApp.getFolderById(STOCK_COUNT_FOLDER_ID), 'Doc Center ' + day.slice(0, 4))
  const folder = subFolder(subFolder(root, req.folder), MONTH_FOLDERS[Number(day.slice(5, 7)) - 1])
  const ext = req.photo.mime === 'application/pdf' ? 'pdf' : req.photo.mime === 'image/png' ? 'png' : 'jpg'
  const amount = Number(req.total) > 0 ? ' RM' + Math.round(Number(req.total) * 100) / 100 : ''
  const name = day + ' ' + (fileSafe(req.title) || req.folder) + amount + '.' + ext
  const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.photo.base64), req.photo.mime, name))
  return { link: file.getUrl(), fileId: file.getId() }
}

// One-off, run from the editor: rename "Suppliers Invoices" to "Suppliers Invoices 2026"
// and move each supplier's 2026 > month folders up to supplier > month. Any other
// year moves to its own "Suppliers Invoices <year>" folder.
function migrateInvoiceFolders() {
  const root = DriveApp.getFolderById(INVOICES_FOLDER_ID)
  root.setName(yearFolderName(2026))
  // Whole folders move in one step; only a name already there is merged file by file.
  const moveInto = (from, to) => {
    const files = from.getFiles()
    while (files.hasNext()) files.next().moveTo(to)
    const subs = from.getFolders()
    while (subs.hasNext()) {
      const sub = subs.next()
      const there = to.getFoldersByName(sub.getName())
      if (!there.hasNext()) { sub.moveTo(to); continue }
      moveInto(sub, there.next())
      sub.setTrashed(true)
    }
  }
  const moved = []
  const suppliers = root.getFolders()
  while (suppliers.hasNext()) {
    const sup = suppliers.next()
    const years = sup.getFolders()
    while (years.hasNext()) {
      const y = years.next()
      if (!/^\d{4}$/.test(y.getName())) continue
      const target = y.getName() === '2026' ? sup : supplierFolder(yearRoot(y.getName()), [sup.getName()])
      moveInto(y, target)
      y.setTrashed(true)
      moved.push(`${sup.getName()} ${y.getName()}`)
    }
  }
  Logger.log('Moved: ' + moved.join(', '))
}

function writeReceipt(req) {
  const { key, date, supplier, invoice, total, lines, photo, sentBy, logOnly, printed } = req
  // A bill saved to Drive on upload brings its link; older ones still bring the photo.
  const savedLink = req.link || ''
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
    const ss = book()
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

  const link = savedLink || (photo ? savePhoto(photo, date, supplier, invoice, printed, total).link : '')
  const now = new Date()
  const rows = (lines.length ? lines : [{}]).map(l => [
    now, date, supplier, invoice || '', l.item === NOT_STOCK ? '' : l.item || '', l.text || '',
    l.qty == null ? '' : l.qty, l.unit || '', l.price == null ? '' : l.price, l.amount == null ? '' : l.amount,
    total, link, sentBy || '', key,
  ])
  logSheet.getRange(logSheet.getLastRow() + 1, 1, rows.length, LOG_HEADERS.length).setValues(rows)
  return { duplicate: false, link, wrote: cells.length }
}

// Undo a recorded bill (the app's Undo button): take its quantities back off the stock
// tab, its total off the Purchase tab, and delete its Receipt Log rows.
function removeReceipt(req) {
  const logSheet = tab(LOG_TAB, LOG_HEADERS)
  const n = logSheet.getLastRow() - 1
  if (n < 1 || !req.key) return { removed: 0 }
  const vals = logSheet.getRange(2, 1, n, LOG_HEADERS.length).getValues()
  const hits = []
  vals.forEach((r, i) => { if (same(r[13], req.key)) hits.push({ r: r, row: i + 2 }) })
  if (!hits.length) return { removed: 0 }
  const first = hits[0].r
  const date = first[1] instanceof Date ? isoDate(first[1]) : String(first[1]).slice(0, 10)
  const ym = date.slice(0, 7)
  const day = Number(date.slice(8, 10))
  const t = tabsFor(ym)
  const ss = book()
  const stock = ss.getSheetByName(t.stock)
  const purchase = ss.getSheetByName(t.purchase)
  if (stock && purchase) {
    const items = readItems(stock)
    const header = stock.getRange(1, COL.day1, 1, COL.day31 - COL.day1 + 1).getValues()[0]
    const dayAt = header.findIndex(v => Number(v) === day)
    if (dayAt >= 0) {
      hits.forEach(h => {
        const item = h.r[4]
        const qty = Number(h.r[6])
        if (!item || !qty) return
        const it = items.find(x => same(x.name, item))
        if (it) addTo(stock.getRange(it.row, COL.day1 + dayAt), -qty)
      })
    }
    const sup = readSuppliers(purchase).find(x => same(x.name, first[2]))
    const dates = purchase.getRange(PURCHASE_FIRST_ROW, 1, PURCHASE_LAST_ROW - PURCHASE_FIRST_ROW + 1, 1).getValues()
    const at = dates.findIndex(r => r[0] instanceof Date && isoDate(r[0]) === date)
    if (sup && at >= 0 && Number(first[10])) addTo(purchase.getRange(PURCHASE_FIRST_ROW + at, sup.col), -Number(first[10]))
  }
  hits.map(h => h.row).sort((x, y) => y - x).forEach(row => logSheet.deleteRow(row))
  return { removed: hits.length }
}

function setPrice(req) {
  const t = tabsFor(req.ym)
  const stock = book().getSheetByName(t.stock)
  if (!stock) throw new Error(`No tab ${t.stock}`)
  const it = readItems(stock).find(x => same(x.name, req.item))
  if (!it) throw new Error(`Item not in ${t.stock}: ${req.item}`)
  stock.getRange(it.row, COL.price).setValue(Number(req.price))
  return { old: it.price, tab: t.stock }
}
