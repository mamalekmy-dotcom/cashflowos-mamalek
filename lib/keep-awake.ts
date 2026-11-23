import 'server-only'

// Jarvis runs on its own free Supabase project, which Supabase pauses after 7 days with
// no requests. The daily cron calls it once a day so it stays awake. Needs the project's
// anon (publishable) key in JARVIS_SUPABASE_KEY; with no key it does nothing.
const URL = process.env.JARVIS_SUPABASE_URL?.trim() || 'https://hqsoeyokrrhbaxbyotky.supabase.co'

export async function keepJarvisAwake(): Promise<string> {
  const key = process.env.JARVIS_SUPABASE_KEY?.trim()
  if (!key) return 'skipped: JARVIS_SUPABASE_KEY not set'
  // New sb_publishable_ keys go in apikey only; old eyJ anon keys also as the Bearer.
  const headers: Record<string, string> = key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` }
  const [auth, rest] = await Promise.all([
    fetch(`${URL}/auth/v1/health`, { headers }).then(r => r.status).catch(() => 0),
    fetch(`${URL}/rest/v1/`, { headers }).then(r => r.status).catch(() => 0),
  ])
  return `auth ${auth}, rest ${rest}`
}
