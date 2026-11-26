import 'server-only'
import type { Context } from './stock-logic'

// The bot's only door into the stock sheet: the Apps Script in scripts/stock-sheet/Code.gs.
export const stockConfigured = () =>
  Boolean(process.env.STOCK_SCRIPT_URL?.trim() && process.env.STOCK_SCRIPT_SECRET?.trim())

// The script handles one request at a time. When many bills arrive together (an album
// of 20+), a tap can wait behind them and time out, so busy answers are tried again.
const BUSY = /lock|timed? ?out|too many|try again|service invoked|rate|50\d|429/i

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  let last: Error | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 3000 * attempt))
    try {
      const res = await fetch(process.env.STOCK_SCRIPT_URL!.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ ...body, action, secret: process.env.STOCK_SCRIPT_SECRET!.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (data?.ok) return data as T
      last = new Error(data?.error || `stock sheet answered ${res.status}`)
      if (data?.error && !BUSY.test(data.error)) throw last // a real refusal: retrying won't help
    } catch (e: any) {
      if (e === last) throw e
      last = e instanceof Error ? e : new Error(String(e))
    }
    console.warn(`[CFO] stock sheet busy on ${action}, attempt ${attempt + 1}:`, last?.message)
  }
  throw last ?? new Error('stock sheet did not answer')
}

// With a date, it also says what that day's Purchase row already holds.
export const sheetContext = (ym: string, date?: string) => call<Context>('context', { ym, date })
export const addAlias = (kind: 'item' | 'supplier', text: string, target: string) => call('addAlias', { kind, text, target })
export const ensureMonth = (ym: string) => call<{ created: boolean; stock: string; purchase: string }>('ensureMonth', { ym })
export const syncOpening = (ym: string) => call<{ filled: number; blank: number }>('syncOpening', { ym })
export const setPrice = (ym: string, item: string, price: number) => call<{ old: number; tab: string }>('setPrice', { ym, item, price })
export const writeReceipt = (receipt: Record<string, unknown>) =>
  call<{ duplicate: boolean; link: string; wrote: number }>('writeReceipt', receipt)
// Rewrites the "Mama Lek Management Report 2026" Google Sheet (same Apps Script).
export const writeMgmtSheet = (body: { summary: (string | number)[][]; months: { month: string; rows: (string | number)[][] }[] }) =>
  call<{ months: number; link: string }>('mgmtReport', body)
// Bills to Google Drive on upload, and out again when rejected (same Apps Script).
export const saveInvoice = (body: Record<string, unknown>) => call<{ fileId: string; link: string }>('saveInvoice', body)
export const trashInvoice = (fileId: string) => call<{ trashed: boolean }>('trashInvoice', { fileId })
// Doc Center files to Drive: STOCK COUNT › Doc Center <year> › folder › month (same Apps Script).
export const saveDocFile = (body: { photo: { base64: string; mime: string }; date: string; folder: string; title: string; total: number | null }) =>
  call<{ fileId: string; link: string }>('saveDoc', body)
