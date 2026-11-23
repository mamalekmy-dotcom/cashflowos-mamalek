import { POSITIONS } from '@/lib/hr/rules'
import { signupOpen } from '@/lib/signup'
import JoinForm from './JoinForm'

export const dynamic = 'force-dynamic'

// The staff sign-up page. Open without a login (proxy.ts), but only with the current
// link from the owners.
export default async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const open = await signupOpen(token)
  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <div className="brand" style={{ marginBottom: 8 }}>
          <img className="logo" src="/icons/logo.png" alt="" /> Mama Lek
        </div>
        {open ? (
          <JoinForm token={token} positions={POSITIONS.map(p => p.label)} />
        ) : (
          <>
            <h1 className="ph" style={{ fontSize: 18 }}>Sign-up link expired</h1>
            <p className="cap">Ask your manager for the new sign-up link.</p>
          </>
        )}
      </div>
    </div>
  )
}
