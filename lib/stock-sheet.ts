import 'server-only'
import type { Context } from './stock-logic'

// The bot's only door into the stock sheet: the Apps Script in scripts/stock-sheet/Code.gs.
export const stockConfigured = () =>
  Boolean(process.env.STOCK_SCRIPT_URL?.trim() && process.env.STOCK_SCRIPT_SECRET?.trim())

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(process.env.STOCK_SCRIPT_URL!.trim(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ ...body, action, secret: process.env.STOCK_SCRIPT_SECRET!.trim() }),
  })
  const data = await res.json().catch(() => null)
  if (!data?.ok) throw new Error(data?.error || `stock sheet answered ${res.status}`)
  return data as T
}

// With a date, it also says what that day's Purchase row already holds.
export const sheetContext = (ym: string, date?: string) => call<Context>('context', { ym, date })
export const addAlias = (kind: 'item' | 'supplier', text: string, target: string) => call('addAlias', { kind, text, target })
export const ensureMonth = (ym: string) => call<{ created: boolean; stock: string; purchase: string }>('ensureMonth', { ym })
export const syncOpening = (ym: string) => call<{ filled: number; blank: number }>('syncOpening', { ym })
export const setPrice = (ym: string, item: string, price: number) => call<{ old: number; tab: string }>('setPrice', { ym, item, price })
export const writeReceipt = (receipt: Record<string, unknown>) =>
  call<{ duplicate: boolean; link: string; wrote: number }>('writeReceipt', receipt)
