import 'server-only'
import { supabase } from './supabase'

// The exact same file sent twice (same photo from the app, or the same Telegram file)
// is stopped before it's read or saved. Keys: "app:<sha256 of the original files>",
// "tg:<Telegram file_unique_id>".
export type Seen = { key: string; label: string | null; sent_by: string | null; created_at: string }

export async function seenBefore(key: string): Promise<Seen | null> {
  if (!key) return null
  const { data } = await supabase.from('seen_files').select('key, label, sent_by, created_at').eq('key', key).maybeSingle()
  return (data as Seen) ?? null
}

export async function rememberFile(key: string, label: string, sentBy: string): Promise<void> {
  if (!key) return
  const { error } = await supabase.from('seen_files').upsert({ key, label: label.slice(0, 200), sent_by: sentBy.slice(0, 80) }, { onConflict: 'key', ignoreDuplicates: true })
  if (error) console.error('[CFO] remember file failed:', error.message)
}

export function duplicateNote(s: Seen): string {
  const when = new Date(s.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return `📁 Duplicate: this exact file was already sent on ${when}${s.sent_by ? ` by ${s.sent_by}` : ''}${s.label ? ` (${s.label})` : ''}. Nothing was added.`
}
