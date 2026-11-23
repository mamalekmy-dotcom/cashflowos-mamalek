import 'server-only'
import { NOT_STOCK, matchItem, matchSupplier, ymOf, type Context } from './stock-logic'
import { sheetContext } from './stock-sheet'
import { categories } from './expenses'
import { todayISO } from './records'

// The question a bill waiting in Telegram is stuck on, worked out the same way the bot
// asks them, so it can be answered on the Approvals page as well. Answers go through the
// same functions as the Telegram buttons (answerStockQuestion, answerStockCategory).

export type Choice = { value: string; label: string }
export type DraftQuestion = {
  id: number
  kind: 'duplicate' | 'supplier' | 'item' | 'expense' | 'ready'
  ask: string
  choices: Choice[]
}

export async function draftQuestions(drafts: { id: number; payload: any }[]): Promise<Map<number, DraftQuestion>> {
  const out = new Map<number, DraftQuestion>()
  if (!drafts.length) return out
  const months = [...new Set(drafts.map(d => ymOf(d.payload?.bill?.date || todayISO())))]
  const ctxs = new Map<string, Context>()
  await Promise.all(months.map(async m => { ctxs.set(m, await sheetContext(m)) }))
  const cats = await categories()

  for (const d of drafts) {
    const bill = d.payload?.bill
    if (!bill) continue
    const ctx = ctxs.get(ymOf(bill.date || todayISO()))!
    const id = d.id
    if (d.payload.dupOf && !d.payload.dupOk) {
      out.set(id, {
        id, kind: 'duplicate', ask: `Looks the same as another bill (same date, amount and items): ${String(d.payload.dupOf).replace(/<[^>]+>/g, '')}. Same bill sent twice?`,
        choices: [{ value: `smd:${id}:d`, label: 'Duplicate, skip it' }, { value: `smd:${id}:r`, label: 'Real 2nd bill, record it' }],
      })
      continue
    }
    const supplier = bill.supplier ? matchSupplier(ctx, bill.supplier) : null
    if (!supplier) {
      out.set(id, {
        id, kind: 'supplier', ask: `Which Purchase column is "${bill.supplier || 'name not readable'}"?`,
        choices: [
          ...ctx.suppliers.filter(s => s.name !== 'OTHERS').map(s => ({ value: `sms:${id}:k${s.col}`, label: s.name })),
          { value: `sms:${id}:o`, label: 'OTHERS column' },
        ],
      })
      continue
    }
    const index = (bill.lines ?? []).findIndex((l: any) => !matchItem(ctx, l.text))
    if (index >= 0) {
      const line = bill.lines[index]
      out.set(id, {
        id, kind: 'item',
        ask: `Line ${index + 1} of ${bill.lines.length}: "${line.text}" (${line.qty ?? '?'} ${line.unit ?? ''} = RM${line.amount ?? '?'}). Which stock row?`,
        choices: [
          { value: `smi:${id}:${index}:a`, label: '🧾 Whole bill is Others (not food)' },
          { value: `smi:${id}:${index}:x`, label: 'This line is Others (not COGS)' },
          ...ctx.items.map(i => ({ value: `smi:${id}:${index}:r${i.row}`, label: i.name })),
        ],
      })
      continue
    }
    const others = (bill.lines ?? []).filter((l: any) => matchItem(ctx, l.text) === NOT_STOCK)
    if (others.length && !d.payload.expense) {
      out.set(id, {
        id, kind: 'expense', ask: `Not food: ${others.map((l: any) => l.text).join(', ')}. Which expense category?`,
        choices: cats.map(c => ({ value: `sxc:${id}:${c.name}`, label: c.name })),
      })
      continue
    }
    out.set(id, { id, kind: 'ready', ask: 'All answered. Tap Send to make the Approve card.', choices: [{ value: `ready:${id}`, label: 'Send for approval' }] })
  }
  return out
}
