import 'server-only'
import { randomUUID } from 'crypto'
import { supabase } from './supabase'
import { sendMessage, sendWithButtons, getFilePath, downloadFileBytes, type InlineKeyboard } from './telegram'
import { propose, proposeAndNotify, claim, markExecuted, type ActionRow } from './actions'
import { todayISO, rm } from './records'
import {
  NOT_STOCK, readBill, billProblems, matchSupplier, matchItem, candidates, guessNames, billKey, ymOf, spikesIn, perUnit,
  type Bill, type Context, type Spike,
} from './stock-logic'
import { sheetContext, addAlias, setPrice, writeReceipt, stockConfigured } from './stock-sheet'

// Supplier bill to stock sheet, from Telegram or the app's Scan page. Nothing reaches
// the sheet until an owner taps Approve.

type Sender = { chatId: number; approvalChat: number; name: string; fromId: unknown }
// A Telegram bill carries its fileId and message; a Scan bill its file in the vault bucket.
type Draft = { bill: Bill; fileId?: string; storagePath?: string; scanDocId?: number; mime: string; sender: Sender; msg?: any }

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
  const ctx = await sheetContext(ymOf(bill.date || today))

  // A handwritten cash bill often has no readable shop name. Ask anyway, and remember the
  // answer against the first item, so the next "Baby Ice" bill with no name goes to ICE.
  if (!bill.supplier && bill.lines[0]?.text) bill.supplier = `No name: ${bill.lines[0].text}`
  // With no items either, there is nothing to remember a match against.
  if (!bill.supplier) {
    if (draftId) await closeDraft(draftId)
    await sendMessage(sender.chatId, `📷 I can't read the supplier name on that bill (${esc(bill.invoice || 'no invoice no.')}). Nothing was recorded. Please resend the whole bill.`)
    return "Couldn't read the bill. Please take the photo again, showing the whole bill."
  }

  const supplier = matchSupplier(ctx, bill.supplier)
  if (!supplier) {
    const id = draftId ?? (await saveDraft(draft))
    if (id) await askSupplier(id, draft, ctx)
    return 'Waiting for the owner to check the supplier.'
  }

  const lines = bill.lines.map(l => ({ ...l, item: matchItem(ctx, l.text) ?? '' }))
  const missing = lines.findIndex(l => !l.item)
  if (missing >= 0) {
    const id = draftId ?? (await saveDraft(draft))
    if (id) await askItem(id, draft, ctx, missing)
    return 'Waiting for the owner to match the items.'
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
  const row = await proposeAndNotify({
    agentKey: 'stock-receipt',
    idempotencyKey: `stock:${key}:${randomUUID()}`,
    payload: {
      key, text, date: bill.date, supplier, printed: bill.supplier, invoice: bill.invoice, total: bill.total, lines, spikes,
      fileId: draft.fileId, storagePath: draft.storagePath, scanDocId: draft.scanDocId, mime: draft.mime, sentBy: sender.name,
    },
    chatId: sender.approvalChat,
    text,
  })
  if (row && sender.approvalChat !== sender.chatId) {
    await sendMessage(sender.chatId, `📨 Got it: ${esc(supplier)} ${rm(bill.total ?? 0)}. Sent to the owner to approve.`)
  }
  return row ? 'Sent to the owner to approve.' : 'Could not send this to the owner. Please try again.'
}

function card(supplier: string, bill: Bill, lines: (Bill['lines'][number] & { item: string })[], spikes: Spike[], problems: string[], ctx: Context, draft: Draft): string {
  const body = lines.map(l =>
    l.item === NOT_STOCK
      ? `• ${esc(l.text)}: Others, RM${l.amount?.toFixed(2) ?? '?'}`
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
