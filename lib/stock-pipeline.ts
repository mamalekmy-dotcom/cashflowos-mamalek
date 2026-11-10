import 'server-only'
import { randomUUID } from 'crypto'
import { supabase } from './supabase'
import { sendMessage, sendWithButtons, editMessageText, getFilePath, downloadFileBytes, type InlineKeyboard } from './telegram'
import { propose, proposeAndNotify, approveRow, claim, markExecuted, type ActionRow } from './actions'
import { todayISO, rm } from './records'
import {
  NOT_STOCK, readBill, billProblems, matchSupplier, matchItem, candidates, guessNames, billKey, ymOf, spikesIn, perUnit,
  type Bill, type Context, type Spike,
} from './stock-logic'
import { sheetContext, addAlias, setPrice, writeReceipt, stockConfigured } from './stock-sheet'
import { categories, categoryKeyboard } from './expenses'

// Supplier bill to stock sheet, from Telegram or the app's Scan page. Nothing reaches
// the sheet until an owner taps Approve.

type Sender = { chatId: number; approvalChat: number; name: string; fromId: unknown }
// A Telegram bill carries its fileId and message; a Scan bill its file in the vault bucket.
// `expense` is the Management Report category for the bill's Others lines, once picked.
type Draft = { bill: Bill; fileId?: string; storagePath?: string; scanDocId?: number; mime: string; sender: Sender; msg?: any; expense?: string }

const OTHERS = 'OTHERS'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const shown = (iso: string) => iso.split('-').reverse().join('/')

export function pickFile(msg: any): { fileId: string; mime: string } | null {
  if (msg.photo?.length) return { fileId: msg.photo[msg.photo.length - 1].file_id, mime: 'image/jpeg' }
  if (msg.document) return { fileId: msg.document.file_id, mime: (msg.document.mime_type || '').toLowerCase() }
  return null
}

async function fileBase64(fileId: string): Promise<string | null> {
  const info = await getFilePath(fileId)
  if (!info) return null
  const bytes = await downloadFileBytes(info.file_path)
  return bytes ? bytes.toString('base64') : null
}

// Returns false when this isn't a supplier bill, so the caller can use the normal Vault path.
export async function runStockPipeline(msg: any, sender: Sender): Promise<boolean> {
  const file = pickFile(msg)
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!file || !apiKey) return false
  const base64 = await fileBase64(file.fileId)
  if (!base64) return false
  const bill = await readBill(base64, file.mime, apiKey).catch(e => {
    console.error('[CFO] bill read failed:', e)
    return null
  })
  if (!bill || bill.type === 'other') return false
  if (bill.type === 'statement') {
    await sendMessage(sender.chatId, `📄 That's a statement of account from ${esc(bill.supplier)}, not a bill, so I recorded nothing.`)
    return true
  }
  await advance({ bill, fileId: file.fileId, mime: file.mime, sender, msg: { chat: msg.chat, from: msg.from, photo: msg.photo, document: msg.document } })
  return true
}

// A bill uploaded on the app's Scan page. The owner gets the same questions and Approve
// card on Telegram as for a photo sent to the bot. Returns what the staff member sees.
export async function runScanPipeline(args: {
  bill: Bill; mime: string; storagePath: string; scanDocId: number; staffName: string
}): Promise<string> {
  const owner = Number(process.env.OWNER_CHAT_ID?.trim())
  if (!owner) return 'Saved. An owner will check it in Doc Center.'
  const sender: Sender = { chatId: owner, approvalChat: owner, name: args.staffName, fromId: null }
  return advance({ bill: args.bill, storagePath: args.storagePath, scanDocId: args.scanDocId, mime: args.mime, sender })
}

// Reads a scanned file as a supplier bill. Null when it can't be read or isn't one.
export async function readScannedBill(base64: string, mime: string): Promise<Bill | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey || !stockConfigured()) return null
  const bill = await readBill(base64, mime, apiKey).catch(e => {
    console.error('[CFO] scan bill read failed:', e)
    return null
  })
  return bill?.type === 'bill' ? bill : null
}

// Works through what's still unknown, one question at a time, then sends the Approve card.
// Returns a short status for whoever sent the bill.
async function advance(draft: Draft, draftId?: number): Promise<string> {
  const { bill, sender } = draft
  const today = todayISO()
  const ctx = await sheetContext(ymOf(bill.date || today), bill.date || undefined)

  // A handwritten cash bill often has no readable shop name. Ask anyway, and remember the
  // answer against the first item, so the next "Baby Ice" bill with no name goes to ICE.
  if (!bill.supplier && bill.lines[0]?.text) bill.supplier = `No name: ${bill.lines[0].text}`
  // With no items either, there is nothing to remember a match against.
  if (!bill.supplier) {
    if (draftId) await closeDraft(draftId)
    await sendMessage(sender.chatId, `📷 I can't read the supplier name on that bill (${esc(bill.invoice || 'no invoice no.')}). Nothing was recorded. Please resend the whole bill.`)
    return "Couldn't read the bill. Please take the photo again, showing the whole bill."
  }

  // A bill read with no items or no total would record an empty line and then block the
  // real read of the same invoice as "already done". Ask for a clearer copy instead.
  if (!bill.lines.length || !(Number(bill.total) > 0)) {
    if (draftId) await closeDraft(draftId)
    await sendMessage(sender.chatId, `📷 I read ${esc(bill.supplier)} ${esc(bill.invoice || '')} but not its ${bill.lines.length ? 'total' : 'items'}. Nothing was recorded. Please send a clearer photo of the whole bill.`)
    return "Couldn't read the items or total. Please take the photo again, showing the whole bill."
  }

  const supplier = matchSupplier(ctx, bill.supplier)
  if (!supplier) {
    const id = draftId ?? (await saveDraft(draft))
    if (id) await askSupplier(id, draft, ctx)
    return 'Waiting for the owner to check the supplier.'
  }

  // A row the sheet counts one whole thing at a time (1 TONG, 1 BTL) takes that unit, so a
  // gas bill that only says "14kg" reads 1 TONG. Packs (1000 PCS a carton) and rows by
  // weight or volume keep the bill's unit.
  const lines = bill.lines.map(l => {
    const item = matchItem(ctx, l.text) ?? ''
    const row = ctx.items.find(i => i.name === item)
    const uom = String(row?.uom ?? '').toUpperCase()
    const whole = row && Number(row.volume) === 1 && uom && !/^(G|GM|KG|ML|L)$/.test(uom)
    return { ...l, item, unit: whole ? uom : l.unit }
  })
  const missing = lines.findIndex(l => !l.item)
  if (missing >= 0) {
    const id = draftId ?? (await saveDraft(draft))
    if (id) await askItem(id, draft, ctx, missing)
    return 'Waiting for the owner to match the items.'
  }

  // Lines that aren't stock go to the Management Report, so they need a category first.
  const others = lines.filter(l => l.item === NOT_STOCK)
  if (others.length && !draft.expense) {
    const id = draftId ?? (await saveDraft(draft))
    if (id) await askExpense(id, draft, others)
    return 'Waiting for the owner to pick the expense category.'
  }

  if (draftId) await closeDraft(draftId)
  const key = billKey(supplier, bill)
  if (ctx.log.some(l => l.key === key) || (await isPending(key))) {
    await sendMessage(sender.chatId, `📁 Already done: ${esc(supplier)} ${esc(bill.invoice)}. I didn't add it twice.`)
    return 'This bill was already sent in. Nothing was added twice.'
  }

  const spikes = spikesIn(lines, ctx.log, bill.date)
  const problems = billProblems(bill, today)
  const text = card(supplier, bill, lines, spikes, problems, ctx, draft)
  const sheetPrices = offSheetPrice(lines, ctx)
  const row = await proposeAndNotify({
    agentKey: 'stock-receipt',
    idempotencyKey: `stock:${key}:${randomUUID()}`,
    payload: {
      key, text, date: bill.date, supplier, printed: bill.supplier, invoice: bill.invoice, total: bill.total, lines, spikes,
      fileId: draft.fileId, storagePath: draft.storagePath, scanDocId: draft.scanDocId, mime: draft.mime, sentBy: sender.name,
      sheetPrices, expense: draft.expense,
    },
    chatId: sender.approvalChat,
    text,
    extraRows: id => sheetPriceRow(id, sheetPrices),
  })
  if (row && sender.approvalChat !== sender.chatId) {
    await sendMessage(sender.chatId, `📨 Got it: ${esc(supplier)} ${rm(bill.total ?? 0)}. Sent to the owner to approve.`)
  }
  return row ? 'Sent to the owner to approve.' : 'Could not send this to the owner. Please try again.'
}

// Handwritten cash bills get misread (28 read as 29). Lines whose price isn't the stock
// sheet's price, with the sheet's price, for the "Use sheet price" button.
function offSheetPrice(lines: (Bill['lines'][number] & { item: string })[], ctx: Context): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of lines) {
    const sheet = Number(ctx.items.find(i => i.name === l.item)?.price)
    if (l.item && l.item !== NOT_STOCK && sheet > 0 && l.price != null && Math.abs(l.price - sheet) > 0.005) out[l.item] = sheet
  }
  return out
}

function sheetPriceRow(id: number, prices: Record<string, number>): InlineKeyboard {
  const items = Object.entries(prices)
  if (!items.length) return []
  const label = items.length === 1 ? `✏️ Use sheet price RM${items[0][1].toFixed(2)}` : `✏️ Use sheet prices (${items.length} items)`
  return [[{ text: label, callback_data: `ssp:${id}` }]]
}

// The "Use sheet price" tap: each line that was off takes the sheet's price, the total
// follows, and the Approve card is rewritten in place. Only while it's still waiting.
export async function useSheetPrices(id: number): Promise<string> {
  const { data: row } = await supabase.from('agent_actions').select('*')
    .eq('id', id).eq('agent_key', 'stock-receipt').eq('status', 'proposed').maybeSingle()
  if (!row) return 'This bill is already decided.'
  const p = row.payload
  const prices: Record<string, number> = p.sheetPrices ?? {}
  if (!Object.keys(prices).length) return 'Nothing to change.'

  let before = 0
  let after = 0
  const lines = (p.lines as (Bill['lines'][number] & { item: string })[]).map(l => {
    const price = prices[l.item]
    if (price == null) return l
    const amount = Math.round((l.qty ?? 1) * price * 100) / 100
    before += Number(l.amount) || 0
    after += amount
    return { ...l, price, amount }
  })
  const total = Math.round((Number(p.total) - before + after) * 100) / 100
  const bill: Bill = { type: 'bill', supplier: p.printed ?? p.supplier, invoice: p.invoice ?? '', date: p.date, total, lines }
  const ctx = await sheetContext(ymOf(p.date), p.date)
  const spikes = spikesIn(lines, ctx.log, p.date)
  const text = card(p.supplier, bill, lines, spikes, billProblems(bill, todayISO()), ctx, { scanDocId: p.scanDocId, sender: { name: p.sentBy }, expense: p.expense } as Draft)
  const payload = { ...p, lines, total, spikes, text, key: billKey(p.supplier, bill), sheetPrices: {} }

  const { data: saved } = await supabase.from('agent_actions').update({ payload }).eq('id', id).eq('status', 'proposed').select('id')
  if (!saved?.length) return 'This bill is already decided.'
  if (row.notify_chat_id && row.notify_message_id) await editMessageText(row.notify_chat_id, row.notify_message_id, text, approveRow(id))
  return `Changed to the sheet price. Total now ${rm(total)}.`
}

function card(supplier: string, bill: Bill, lines: (Bill['lines'][number] & { item: string })[], spikes: Spike[], problems: string[], ctx: Context, draft: Draft): string {
  const body = lines.map(l =>
    l.item === NOT_STOCK
      ? `• ${esc(l.text)}: Others${draft.expense ? ` → ${esc(draft.expense)}` : ''}, RM${l.amount?.toFixed(2) ?? '?'}`
      : `• ${esc(l.item)}: ${l.qty ?? '?'} ${esc(l.unit)} × RM${l.price?.toFixed(2) ?? '?'} = <b>RM${l.amount?.toFixed(2) ?? '?'}</b>`,
  )
  const parts = [
    `🧾 <b>${esc(supplier)}</b> · ${bill.date ? shown(bill.date) : 'no date'} · ${esc(bill.invoice || 'no invoice no.')}`,
    `Total <b>${rm(bill.total ?? 0)}</b>${draft.scanDocId ? ` · scanned by ${esc(draft.sender.name)}` : ''}`,
    ...body,
  ]
  if (spikes.length) {
    parts.push('', ...spikes.map(s => {
      const item = ctx.items.find(i => i.name === s.item)
      return `🔺 ${esc(s.item)}: ${s.base.toFixed(2)} → <b>${s.price.toFixed(2)}</b> (+${s.percent}%)${perUnit(item, s.price)}`
    }))
  }
  if (problems.length) parts.push('', ...problems.map(p => `⚠️ ${esc(p)}`))
  // Ice and gas bills are often keyed into the sheet by hand as well, so ask before adding.
  const already = ctx.filled?.find(f => f.supplier === supplier && f.amount > 0)
  if (already && bill.date) {
    parts.push('', `❓ The sheet already has <b>${rm(already.amount)}</b> under ${esc(supplier)} on ${shown(bill.date)}, maybe keyed in by hand.`,
      'Same bill? Tap Reject so it isn\'t counted twice. A second bill that day? Tap Approve.')
    return parts.join('\n')
  }
  parts.push('', 'Approve to record in the stock sheet?')
  return parts.join('\n')
}

async function saveDraft(draft: Draft): Promise<number | null> {
  const row = await propose({ agentKey: 'stock-draft', idempotencyKey: `stockdraft:${randomUUID()}`, payload: draft, expiresInH: 72 })
  if (!row) await sendMessage(draft.sender.chatId, '⚠️ I could not hold that receipt for checking. Please send it again.')
  return row?.id ?? null
}

async function closeDraft(id: number): Promise<void> {
  const row = await claim(id, null, 'executing')
  if (row) await markExecuted(id, { kind: 'stock_draft_done' })
}

async function isPending(key: string): Promise<boolean> {
  const { data } = await supabase
    .from('agent_actions')
    .select('id')
    .eq('agent_key', 'stock-receipt')
    .eq('status', 'proposed')
    .eq('payload->>key', key)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
  return Boolean(data?.length)
}

const rows = (buttons: InlineKeyboard[number]): InlineKeyboard => buttons.map(b => [b])

async function askSupplier(id: number, draft: Draft, ctx: Context): Promise<void> {
  const { bill, sender } = draft
  const names = [...new Set(ctx.suppliers.map(s => s.name))].filter(n => n !== OTHERS)
  let guess = candidates(bill.supplier, names)
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!guess.length && apiKey) {
    const about = `${bill.supplier}; ${bill.lines.map(l => l.text).join(', ')}`.slice(0, 400)
    guess = await guessNames(about, names, apiKey, 'supplier').catch(e => {
      console.error('[CFO] supplier guess failed:', e)
      return []
    })
  }
  // Buttons carry the column, so a guess list that changes later can't pick the wrong one.
  const column = (name: string) => ctx.suppliers.find(s => s.name === name)?.col
  await sendWithButtons(
    sender.approvalChat,
    `🏷 New supplier on a bill: <b>${esc(bill.supplier || 'name not readable')}</b>, ${rm(bill.total ?? 0)}.\nWhich Purchase column is this?`,
    rows([
      ...guess.map(name => ({ text: name.slice(0, 40), callback_data: `sms:${id}:k${column(name)}` })),
      { text: 'OTHERS column', callback_data: `sms:${id}:o` },
      { text: 'Not a stock purchase', callback_data: `sms:${id}:x` },
      { text: '🛑 Cancel this bill', callback_data: `sms:${id}:c` },
    ]),
  )
}

// What this supplier's earlier approved bills were matched to, most often first. A gas
// bill that only says "14kg" is still GAS TONG.
async function boughtBefore(supplier: string, names: string[]): Promise<string[]> {
  const { data } = await supabase.from('agent_actions').select('payload').eq('agent_key', 'stock-receipt').eq('status', 'executed')
    .eq('payload->>supplier', supplier).order('id', { ascending: false }).limit(20)
  const count = new Map<string, number>()
  for (const row of data ?? []) {
    for (const l of (row.payload?.lines ?? []) as { item?: string }[]) {
      if (l.item && l.item !== NOT_STOCK && names.includes(l.item)) count.set(l.item, (count.get(l.item) ?? 0) + 1)
    }
  }
  return [...count].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 3)
}

async function askItem(id: number, draft: Draft, ctx: Context, index: number): Promise<void> {
  const line = draft.bill.lines[index]
  const names = ctx.items.map(i => i.name)
  const supplier = matchSupplier(ctx, draft.bill.supplier) ?? draft.bill.supplier
  // Word matches miss Malay names (BEBOLA AYAM is CHICKEN BALL), so the AI's picks come
  // before word matches, and what this supplier usually sells comes before both. The AI
  // is told the supplier too, since a line like "14kg" means nothing on its own.
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  const [usual, smart] = await Promise.all([
    boughtBefore(supplier, names),
    apiKey
      ? guessNames(`${line.text} (on a bill from ${supplier})`, names, apiKey, 'item').catch(e => {
        console.error('[CFO] item guess failed:', e)
        return [] as string[]
      })
      : Promise.resolve([] as string[]),
  ])
  const guess = [...new Set([...usual, ...smart, ...candidates(line.text, names)])].slice(0, 6)
  await sendWithButtons(
    draft.sender.approvalChat,
    `🥬 New item on a bill: <b>${esc(line.text)}</b> (${line.qty ?? '?'} ${esc(line.unit)} × RM${line.price?.toFixed(2) ?? '?'} = RM${line.amount?.toFixed(2) ?? '?'}).\n` +
      `Which stock row is it? Not an ingredient: tap Others, it stays out of COGS but the money stays on the Purchase tab. ` +
      `A new ingredient: tap Cancel, add it to the sheet, and resend.`,
    rows([
      ...guess.map(name => ({ text: name.slice(0, 40), callback_data: `smi:${id}:${index}:r${ctx.items.find(i => i.name === name)?.row}` })),
      { text: 'Others (not COGS)', callback_data: `smi:${id}:${index}:x` },
      { text: '🧾 Whole bill is Others', callback_data: `smi:${id}:${index}:a` },
      { text: '🛑 Cancel this bill', callback_data: `smi:${id}:${index}:c` },
    ]),
  )
}

// The bill's lines that aren't stock: which Management Report expense are they?
async function askExpense(id: number, draft: Draft, others: { text: string; amount?: number | null }[]): Promise<void> {
  const sum = others.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const list = others.slice(0, 5).map(l => esc(l.text)).join(', ')
  await sendWithButtons(
    draft.sender.approvalChat,
    `🧾 <b>${esc(draft.bill.supplier)}</b>: ${list}${others.length > 5 ? '…' : ''} = <b>${rm(sum)}</b> is not food cost.
` +
      `Which expense is it? It goes to the Management Report, and stays in the sheet's OTHERS column.`,
    categoryKeyboard('sxc', id, await categories()),
  )
}

// A category picked (tapped or typed) for a stock bill's Others lines.
export async function answerStockCategory(id: number, name: string): Promise<{ toast: string }> {
  const row = await loadDraft(id)
  if (!row || row.agent_key !== 'stock-draft') return { toast: 'Already handled.' }
  const draft = { ...(row.payload as Draft), expense: name }
  await supabase.from('agent_actions').update({ payload: draft }).eq('id', id).eq('status', 'proposed')
  await advance(draft, id)
  return { toast: `Saved as ${name}.` }
}

async function loadDraft(id: number): Promise<ActionRow | null> {
  const { data } = await supabase.from('agent_actions').select('*').eq('id', id).eq('status', 'proposed').maybeSingle()
  return (data as ActionRow) ?? null
}

// A tap on one of the question buttons. Returns the toast, and a draft to send down the
// normal Vault path when the owner says a bill isn't a stock purchase.
export async function answerStockQuestion(data: string): Promise<{ toast: string; notStock?: any }> {
  const [verb, idStr, a, b] = data.split(':')
  const id = Number(idStr)
  const row = await loadDraft(id)
  if (!row) return { toast: 'Already handled.' }
  const draft = row.payload as Draft
  const ctx = await sheetContext(ymOf(draft.bill.date || todayISO()))

  if (verb === 'sms') {
    if (a === 'x') {
      await closeDraft(id)
      // A scanned bill is already in Doc Center, so there's nothing more to file.
      return draft.msg ? { toast: 'Not stock.', notStock: draft.msg } : { toast: 'Not stock. It stays in Doc Center.' }
    }
    if (a === 'c') {
      await closeDraft(id)
      await sendMessage(draft.sender.approvalChat, '🛑 Cancelled. Nothing was recorded.')
      return { toast: 'Cancelled.' }
    }
    // Older buttons carry a place in the word-match list instead of a column.
    const target = a === 'o' ? OTHERS
      : a.startsWith('k') ? ctx.suppliers.find(s => `k${s.col}` === a)?.name
      : candidates(draft.bill.supplier, ctx.suppliers.map(s => s.name))[Number(a)]
    if (!target) return { toast: 'That choice has gone. Send the bill again.' }
    await addAlias('supplier', draft.bill.supplier, target)
  } else {
    const line = draft.bill.lines[Number(a)]
    if (!line) return { toast: 'Unknown line.' }
    if (b === 'c') {
      await closeDraft(id)
      await sendMessage(draft.sender.approvalChat, '🛑 Cancelled. Nothing was recorded.')
      return { toast: 'Cancelled.' }
    }
    if (b === 'a') {
      // Every line not matched yet is not stock, so the bill only goes to the Purchase tab.
      for (const l of draft.bill.lines) if (!matchItem(ctx, l.text)) await addAlias('item', l.text, NOT_STOCK)
      await advance(draft, id)
      return { toast: 'Whole bill marked Others.' }
    }
    const target = b === 'x' ? NOT_STOCK : ctx.items.find(i => `r${i.row}` === b)?.name
    if (!target) return { toast: 'That choice has gone. Send the bill again.' }
    await addAlias('item', line.text, target)
  }
  await advance(draft, id)
  return { toast: 'Saved. I will remember this.' }
}

async function scanBase64(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('vault').download(path)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer()).toString('base64')
}

export async function recordReceipt(p: any) {
  const base64 = p.fileId ? await fileBase64(p.fileId) : p.storagePath ? await scanBase64(p.storagePath) : null
  const res = await writeReceipt({
    key: p.key, date: p.date, supplier: p.supplier, printed: p.printed, invoice: p.invoice, total: p.total, lines: p.lines, sentBy: p.sentBy,
    photo: base64 ? { base64, mime: p.mime } : null,
  })
  if (res.duplicate) return { kind: 'stock_duplicate', supplier: p.supplier, invoice: p.invoice }

  // The app's Stock and Suppliers pages read these. A monthly import of the workbook
  // replaces the month, and the sheet holds the same bill, so nothing is counted twice.
  const stockLines = (p.lines ?? []).filter((l: any) => l.item && l.item !== NOT_STOCK)
  const saved = await Promise.all([
    supabase.from('purchases').insert({ purchase_date: p.date, supplier: p.supplier, amount: Number(p.total) || 0 }),
    stockLines.length
      ? supabase.from('stock_daily').insert(stockLines.map((l: any) => ({ stock_date: p.date, item: l.item, qty: Number(l.qty) || 0, amount: Number(l.amount) || 0 })))
      : Promise.resolve({ error: null }),
  ])
  for (const s of saved) if (s.error) console.error('[CFO] app stock copy failed:', s.error.message)

  // The Others lines are an expense for the Management Report.
  const othersAmount = (p.lines ?? []).filter((l: any) => l.item === NOT_STOCK).reduce((s: number, l: any) => s + (Number(l.amount) || 0), 0)
  if (othersAmount > 0) {
    const { error } = await supabase.from('records').insert({
      title: `${p.supplier} — ${p.expense || 'Others'}`,
      status: 'filed', amount: Math.round(othersAmount * 100) / 100, category: 'cash_out', due_date: p.date || null,
      notes: `Others lines on stock bill ${p.invoice || ''}`.trim(),
      meta: { merchant: p.supplier, expense: p.expense || undefined, source: 'stock-others', key: p.key },
    })
    if (error) console.error('[CFO] others expense failed:', error.message)
  }

  const owner = process.env.OWNER_CHAT_ID?.trim()
  for (const s of (p.spikes ?? []) as Spike[]) {
    if (!owner) break
    const text =
      `🔺 <b>Price up: ${esc(s.item)}</b>\n` +
      `${esc(p.supplier)}, ${shown(p.date)}: ${s.base.toFixed(2)} → <b>${s.price.toFixed(2)}</b>${s.unit ? ` per ${esc(s.unit)}` : ''} (+${s.percent}%).\n` +
      `Approve updates the price in the stock tab. Reject leaves it.`
    await proposeAndNotify({
      agentKey: 'stock-price',
      idempotencyKey: `stockprice:${p.key}:${s.item}`,
      payload: { text, ym: ymOf(p.date), item: s.item, price: s.price },
      chatId: owner,
      text,
      expiresInH: 168,
    })
  }
  return { kind: 'stock_receipt', supplier: p.supplier, total: p.total, wrote: res.wrote, link: res.link, photoSaved: Boolean(res.link) }
}

export async function changePrice(p: any) {
  const res = await setPrice(p.ym, p.item, p.price)
  return { kind: 'stock_price', item: p.item, from: res.old, to: p.price, tab: res.tab }
}
