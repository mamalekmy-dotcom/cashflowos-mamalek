import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ReviewFlow from './ReviewFlow'

export const dynamic = 'force-dynamic'

// Guests land here from a table QR, with no login. proxy.ts leaves /r open.
export default async function GuestReview({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { data: link } = await supabase
    .from('review_links')
    .select('platform, review_url, gift')
    .eq('token', token)
    .maybeSingle()
  if (!link) notFound()

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand" style={{ marginBottom: 12 }}>
          <img className="logo" src="/icons/logo.png" alt="" /> Mama Lek
        </div>
        <ReviewFlow token={token} platform={link.platform} reviewUrl={link.review_url} gift={link.gift} />
      </div>
    </div>
  )
}
