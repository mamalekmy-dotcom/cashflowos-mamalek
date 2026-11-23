import 'server-only'
import { saveInvoice, stockConfigured, trashInvoice } from './stock-sheet'

// Every bill goes to Google Drive as soon as it's uploaded and read: STOCK COUNT ›
// Suppliers Invoices <year> › <supplier> › <month>, named "2026-11-03 LUCKY FROZEN
// SG26-151219 RM11562.pdf" (the Apps Script decides the folders). A rejected, cancelled
// or duplicate bill is trashed again. Drive trouble never stops a bill: it's logged.

export async function billToDrive(args: {
  base64: string; mime: string; date?: string | null; supplier?: string | null; printed?: string | null
  invoice?: string | null; total?: number | null
}): Promise<{ fileId: string; link: string } | null> {
  if (!stockConfigured() || !args.base64) return null
  try {
    return await saveInvoice({
      photo: { base64: args.base64, mime: args.mime }, date: args.date || '', supplier: args.supplier || '',
      printed: args.printed || '', invoice: args.invoice || '', total: args.total ?? null,
    })
  } catch (e) {
    console.error('[CFO] save bill to Drive failed:', e)
    return null
  }
}

export async function dropFromDrive(fileId?: string | null): Promise<void> {
  if (!fileId || !stockConfigured()) return
  await trashInvoice(fileId).catch(e => console.error('[CFO] trash bill in Drive failed:', fileId, e))
}
