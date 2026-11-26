import { sendMessage } from '@/lib/telegram'
import { DAY_NAMES, pastBills, usualOrders } from '@/lib/habits'
import { todayISO } from '@/lib/records'

// 8pm MYT (12:00 UTC): tomorrow's usual orders, to the team group (TELEGRAM_TEAM_CHAT_IDS,
// the Mama Lek Admin group), or the owner when no group is set. A supplier counts when
// their bills came on that weekday 2+ times in the last 8 weeks (lib/habits.ts).
// Nothing is ordered: the message says what's usual and links to the Order button.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP = 'https://cashflowos-mamalek-blush.vercel.app'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('forbidden', { status: 401 })

  const today = todayISO()
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
  const dow = tomorrow.getUTCDay()
  const due = usualOrders(await pastBills(), today).filter(u => u.days.includes(dow) && u.items.length)
  if (!due.length) return Response.json({ ok: true, sent: 0, due: 0 })

  const blocks = due.map(u => `<b>${esc(u.supplier)}</b>\n${u.items.slice(0, 10).map(i => `• ${esc(i.item)}: ${i.qty}${i.unit ? ` ${esc(i.unit)}` : ''}`).join('\n')}`)
  const text = `🧺 <b>Tomorrow (${DAY_NAMES[dow]}) is usually order day for ${due.length} supplier${due.length > 1 ? 's' : ''}</b>\n\n${blocks.join('\n\n')}\n\n` +
    `Check stock first. Open Suppliers → Order: the usual quantities are filled in, change them and send.\n${APP}/suppliers`

  const groups = (process.env.TELEGRAM_TEAM_CHAT_IDS || '').split(',').map(s => s.trim()).filter(s => /^-\d+$/.test(s))
  const to = groups.length ? groups : [process.env.OWNER_CHAT_ID?.trim()].filter(Boolean) as string[]
  const sends = await Promise.allSettled(to.map(id => sendMessage(id, text)))
  return Response.json({ ok: true, due: due.length, sent: sends.filter(r => r.status === 'fulfilled').length })
}
