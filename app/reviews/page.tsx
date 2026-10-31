import { headers } from 'next/headers'
import QRCode from 'qrcode'
import { requireOwner } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import CreateQR from './CreateQR'

export const dynamic = 'force-dynamic'

export default async function Reviews() {
  await requireOwner()
  const host = (await headers()).get('host')
  const [{ data: links }, { data: events }] = await Promise.all([
    supabase.from('review_links').select('id, token, label, platform, gift').order('created_at', { ascending: false }),
    supabase.from('review_events').select('link_id'),
  ])
  const cards = await Promise.all(
    (links ?? []).map(async link => {
      const url = `https://${host}/r/${link.token}`
      return { ...link, url, svg: await QRCode.toString(url, { type: 'svg', margin: 1 }) }
    }),
  )

  return (
    <>
      <h1 className="ph">Table QR</h1>
      <p className="cap">Guests scan, AI drafts a review in their words, then they post it themselves.</p>
      <CreateQR />
      {cards.map(card => (
        <div className="admin-card" key={card.id}>
          <p className="rowlabel" style={{ marginBottom: 2 }}>{card.label} · {card.platform}</p>
          <p className="cap" style={{ margin: '0 0 10px' }}>
            {(events ?? []).filter(e => e.link_id === card.id).length} scans{card.gift ? ` · Gift: ${card.gift}` : ''}
          </p>
          <div style={{ width: 160 }} dangerouslySetInnerHTML={{ __html: card.svg }} />
          <p className="cap" style={{ margin: '10px 0 0', wordBreak: 'break-all' }}>{card.url}</p>
        </div>
      ))}
    </>
  )
}
