import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPersona } from '@/lib/ai'
import { getCurrentUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import ChatBox from './ChatBox'

export const dynamic = 'force-dynamic'

const SHOWN = 60

export default async function Chat({ searchParams }: { searchParams: Promise<{ room?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const persona = await getPersona()
  const rooms = [
    ['ai', persona.name, 'Only you see this'],
    ['foh', 'FOH', 'Service · covers · floor'],
    ['kitchen', 'Kitchen', 'Prep · suppliers · kitchen'],
    ['private', 'Private', 'Notes to yourself'],
  ]
  const { room: asked } = await searchParams
  const room = rooms.some(([key]) => key === asked) ? (asked as string) : 'ai'
  const shared = room === 'foh' || room === 'kitchen'

  // AI and Private threads are personal, so only that person's rows are read.
  const query = supabase
    .from('chat_messages')
    .select('id, body, is_ai, user_id, created_at, app_users(name)')
    .eq('room', room)
    .order('created_at', { ascending: false })
    .limit(SHOWN)
  const { data } = await (shared ? query : query.eq('user_id', user.id))
  const messages = (data ?? []).reverse()

  return (
    <>
      <h1 className="ph">Chat</h1>
      <p className="cap">{rooms.find(([key]) => key === room)?.[2]}</p>
      <div className="btnrow" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        {rooms.map(([key, label]) => (
          <Link key={key} href={`/chat?room=${key}`} className={`btn${room === key ? '' : ' ghost'}`}>{label}</Link>
        ))}
      </div>
      <div className="admin-card">
        {messages.length === 0 ? <p className="cap" style={{ margin: 0 }}>No messages yet.</p> : null}
        {messages.map(m => {
          const sender = m.is_ai ? persona.name : (m.app_users as unknown as { name: string } | null)?.name ?? 'Someone'
          return (
            <p key={m.id} style={{ margin: '0 0 10px', whiteSpace: 'pre-line', fontSize: 14 }}>
              <strong>{sender}: </strong>{m.body}
            </p>
          )
        })}
      </div>
      <ChatBox room={room} shared={shared} />
    </>
  )
}
