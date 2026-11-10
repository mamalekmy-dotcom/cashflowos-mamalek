import 'server-only'
import { supabase } from './supabase'
import { claim, executeClaimed, summarizeResult, propose, attachNotify } from './actions'
import { sendWithButtons, editMessageReplyMarkup, type InlineKeyboard } from './telegram'

// Expenses for the Management Report. Every bill that isn't food cost gets a category,
// picked by an owner on Telegram. Nothing is filed until a category is tapped.

export type Category = { id: number; name: string; sort: number }

export async function categories(): Promise<Category[]> {
  const { data } = await supabase.from('expense_categories').select('id, name, sort').order('sort').order('name')
  return (data ?? []) as Category[]
}

// A category typed on Telegram or on the page. Same name in any case is the same one.
export async function categoryNamed(raw: string): Promise<Category | null> {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!name) return null
  const all = await categories()
  const found = all.find(c => c.name.toLowerCase() === name.toLowerCase())
  if (found) return found
  const { data } = await supabase.from('expense_categories').insert({ name, sort: 900 }).select('id, name, sort').maybeSingle()
  return (data as Category) ?? (await categories()).find(c => c.name.toLowerCase() === name.toLowerCase()) ?? null
}

// Two categories a row, then "type another" and Reject. `prefix` is xc (a bill to file)
// or sxc (the Others lines on a stock bill); the id is the action or draft.
export function categoryKeyboard(prefix: 'xc' | 'sxc', id: number, cats: Category[], reject = true): InlineKeyboard {
  const rows: InlineKeyboard = []
  for (let i = 0; i < cats.length; i += 2) {
    rows.push(cats.slice(i, i + 2).map(c => ({ text: c.name.slice(0, 32), callback_data: `${prefix}:${id}:${c.id}` })))
  }
  rows.push([{ text: '✏️ Type another category', callback_data: `${prefix}t:${id}` }])
  if (reject) rows.push([{ text: '❌ Reject', callback_data: prefix === 'xc' ? `rej:${id}` : `smi:${id}:0:c` }])
  return rows
}

// The words the "type it" prompt carries, so a reply to it can be traced back.
export const typePrompt = (kind: 'expense' | 'bill', id: number) =>
  `✏️ Reply to this message with the expense category for ${kind} #${id}.`
export const typedFor = (text: string): { kind: 'expense' | 'bill'; id: number } | null => {
  const m = text.match(/expense category for (expense|bill) #(\d+)/)
  return m ? { kind: m[1] as 'expense' | 'bill', id: Number(m[2]) } : null
}

// Sends a non-food bill to an owner with the category buttons. Tapping one files it.
export async function proposeExpense(args: { payload: any; chatId: number; text: string }): Promise<number | null> {
  const row = await propose({ agentKey: 'expense', idempotencyKey: args.payload.idempotencyKey, payload: args.payload })
  if (!row) return null
  const cats = await categories()
  const messageId = await sendWithButtons(args.chatId, `${args.text}\n\nWhich expense is it? Tapping one files it.`, categoryKeyboard('xc', row.id, cats))
  if (messageId != null) await attachNotify(row.id, args.chatId, messageId)
  return row.id
}

// A category tapped (or typed) for a waiting expense: stamp it, then approve and file.
export async function fileWithCategory(actionId: number, category: string, approverId: number | null): Promise<string> {
  const { data: row } = await supabase.from('agent_actions').select('payload, notify_chat_id, notify_message_id')
    .eq('id', actionId).eq('agent_key', 'expense').eq('status', 'proposed').maybeSingle()
  if (!row) return 'Already handled.'
  const payload = { ...row.payload, category, expense: category }
  await supabase.from('agent_actions').update({ payload }).eq('id', actionId).eq('status', 'proposed')
  const claimed = await claim(actionId, approverId, 'executing')
  if (!claimed) return 'Already handled.'
  if (row.notify_chat_id && row.notify_message_id) await editMessageReplyMarkup(row.notify_chat_id, row.notify_message_id)
  const outcome = await executeClaimed(claimed)
  return outcome.ok ? summarizeResult(outcome.result) : `⚠️ It could not be filed: ${outcome.error}. Nothing half-happened.`
}

// Expense lines of a month, from bills filed on Telegram.
export async function billedExpenses(from: string, to: string) {
  const { data } = await supabase.from('records').select('id, title, amount, due_date, created_at, status, meta')
    .eq('category', 'cash_out').neq('status', 'reversed')
  return (data ?? [])
    .map(r => ({ ...r, day: (r.due_date || String(r.created_at).slice(0, 10)) as string }))
    .filter(r => r.day >= from && r.day <= to)
    .map(r => ({
      id: r.id as number, day: r.day, title: r.title as string, amount: Number(r.amount) || 0,
      expense: (r.meta?.expense || r.meta?.category || '') as string,
    }))
}
