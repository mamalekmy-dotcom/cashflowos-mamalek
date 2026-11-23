import 'server-only'
import { supabase } from './supabase'
import { sendMessage } from './telegram'

// Who gets the owner alerts: every active owner with Telegram linked in Staff, plus
// OWNER_CHAT_ID. `withTeam` adds the team groups in TELEGRAM_TEAM_CHAT_IDS.
export async function ownerChats(withTeam = false): Promise<string[]> {
  const { data } = await supabase.from('app_users').select('telegram_id').eq('role', 'owner').eq('active', true).not('telegram_id', 'is', null)
  const ids = (data ?? []).map(u => String(u.telegram_id))
  const owner = process.env.OWNER_CHAT_ID?.trim()
  if (owner) ids.push(owner)
  if (withTeam) {
    for (const s of (process.env.TELEGRAM_TEAM_CHAT_IDS || '').split(',')) {
      const id = s.trim()
      if (/^-\d+$/.test(id)) ids.push(id) // groups only, not single people
    }
  }
  return [...new Set(ids)]
}

export async function tellOwners(text: string, withTeam = false): Promise<void> {
  for (const id of await ownerChats(withTeam)) {
    await sendMessage(Number(id), text).catch(e => console.error('[CFO] owner alert failed:', id, e))
  }
}

// An Anthropic error that stops the bot reading bills: no credit, or a bad key.
// Owners hear about it once every 6 hours, not on every bill.
const AI_ALERT_KEY = 'ai_alert_at'
export async function alertIfAiDown(e: any): Promise<void> {
  const text = `${e?.status ?? ''} ${e?.message ?? e ?? ''} ${JSON.stringify(e?.error ?? '')}`
  const credit = /credit balance|billing|purchase credits|insufficient/i.test(text)
  const badKey = e?.status === 401 || e?.status === 403 || /invalid x-api-key|authentication_error|permission_error/i.test(text)
  if (!credit && !badKey) return
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', AI_ALERT_KEY).maybeSingle()
    const last = Date.parse(String((data?.value as any)?.at ?? ''))
    if (Number.isFinite(last) && Date.now() - last < 6 * 3_600_000) return
    await supabase.from('app_settings').upsert({ key: AI_ALERT_KEY, value: { at: new Date().toISOString(), credit }, updated_at: new Date().toISOString() })
    await tellOwners(credit
      ? '🚨 <b>Anthropic API credit has run out.</b> The bot cannot read bills or answer until it is topped up.\n' +
        'Top up at console.anthropic.com → Billing (turn on auto-reload so it never stops). Then resend any bill sent since this message.'
      : '🚨 <b>The Anthropic API key was refused.</b> The bot cannot read bills or answer.\n' +
        'Check ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables, then redeploy.')
  } catch (err) {
    console.error('[CFO] AI alert failed:', err)
  }
}
