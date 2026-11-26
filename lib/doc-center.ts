import 'server-only'
import { supabase } from './supabase'

// Doc Center: one cabinet a month, eight folders (copied from Escor's Doc Center).
// Supplier = approved supplier bills (they come in through Scan or Telegram and are
// already in Drive). The rest are filed here by owners and ticked staff, and saved to
// Drive in STOCK COUNT › Doc Center <year> › folder › month.

export const FOLDERS = [
  { key: 'supplier', label: 'Supplier', drive: 'Supplier' },
  { key: 'claim', label: 'Claim', drive: 'Claim' },
  { key: 'utilities', label: 'Utilities and rental', drive: 'Utilities & Rental' },
  { key: 'maintenance', label: 'Maintenance', drive: 'Maintenance' },
  { key: 'sales_report', label: 'Sales report', drive: 'Sales Report' },
  { key: 'menu', label: 'Menu', drive: 'Menu' },
  { key: 'quotation', label: 'Quotation / market research', drive: 'Quotation & Market Research' },
  { key: 'other', label: 'Other', drive: 'Other' },
] as const
export type FolderKey = (typeof FOLDERS)[number]['key']
export const UPLOAD_FOLDERS = FOLDERS.filter(f => f.key !== 'supplier')
export const folderLabel = (k: string) => FOLDERS.find(f => f.key === k)?.label ?? 'Other'

export type CabinetFile = {
  id: string; folder: FolderKey; title: string; date: string; amount: number | null
  by: string; status: string; url: string | null; isImage: boolean; drive: string | null
}

const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7) }
const SIGN_SECONDS = 1800

async function signAll(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!paths.length) return out
  const { data } = await supabase.storage.from('vault').createSignedUrls(paths, SIGN_SECONDS)
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl)
  return out
}

type DocDb = {
  id: number; kind: string; category: string | null; status: string; merchant: string | null; note: string | null; title: string | null
  amount: number | null; doc_date: string | null; storage_path: string | null; mime: string | null; drive_link: string | null; created_at: string
  app_users: { name: string } | null
}
const DOC_COLS = 'id, kind, category, status, merchant, note, title, amount, doc_date, storage_path, mime, drive_link, created_at, app_users!documents_created_by_fkey(name)'

function docFile(d: DocDb, urls: Map<string, string>): CabinetFile {
  return {
    id: `d${d.id}`, folder: (d.category as FolderKey) || 'other', title: d.title || d.merchant || d.note || 'Document',
    date: d.doc_date || d.created_at.slice(0, 10), amount: d.amount != null ? Number(d.amount) : null,
    by: d.app_users?.name ?? '', status: d.status, url: d.storage_path ? urls.get(d.storage_path) ?? null : null,
    isImage: Boolean(d.mime?.startsWith('image/')), drive: d.drive_link,
  }
}

// Everything filed in a month, newest first. Supplier comes from approved bills.
export async function cabinet(month: string): Promise<CabinetFile[]> {
  const from = `${month}-01`, to = `${nextMonth(month)}-01`
  const [docs, bills] = await Promise.all([
    supabase.from('documents').select(DOC_COLS).neq('category', 'supplier').neq('status', 'rejected')
      .or(`and(doc_date.gte.${from},doc_date.lt.${to}),and(doc_date.is.null,created_at.gte.${from},created_at.lt.${to})`)
      .order('created_at', { ascending: false }).limit(500),
    supabase.from('agent_actions').select('id, payload').eq('agent_key', 'stock-receipt').eq('status', 'executed')
      .gte('payload->>date', from).lt('payload->>date', to).limit(1000),
  ])
  const rows = (docs.data ?? []) as unknown as DocDb[]
  const billRows = (bills.data ?? []) as { id: number; payload: any }[]
  const urls = await signAll([
    ...rows.map(r => r.storage_path).filter((p): p is string => Boolean(p)),
    ...billRows.filter(b => !b.payload?.driveLink && b.payload?.storagePath).map(b => String(b.payload.storagePath)),
  ])
  const files: CabinetFile[] = rows.map(r => docFile(r, urls))
  for (const b of billRows) {
    const p = b.payload ?? {}
    files.push({
      id: `b${b.id}`, folder: 'supplier', title: [p.supplier || p.printed || 'Supplier bill', p.invoice].filter(Boolean).join(' '),
      date: String(p.date), amount: typeof p.total === 'number' ? p.total : p.total ? Number(p.total) : null, by: p.sentBy ?? '',
      status: 'approved', url: !p.driveLink && p.storagePath ? urls.get(String(p.storagePath)) ?? null : null,
      isImage: String(p.mime || '').startsWith('image/'), drive: p.driveLink ?? null,
    })
  }
  return files.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

// A staff member's own files (not supplier bills: those live on the Scan page).
export async function myFiles(userId: number): Promise<CabinetFile[]> {
  const { data } = await supabase.from('documents').select(DOC_COLS).eq('created_by', userId).neq('category', 'supplier')
    .order('created_at', { ascending: false }).limit(60)
  const rows = (data ?? []) as unknown as DocDb[]
  const urls = await signAll(rows.map(r => r.storage_path).filter((p): p is string => Boolean(p)))
  return rows.map(r => docFile(r, urls))
}
