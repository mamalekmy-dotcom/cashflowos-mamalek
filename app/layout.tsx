import './globals.css'
import type { Metadata, Viewport } from 'next'
import Nav from './_components/Nav'
import BottomNav from './_components/BottomNav'
import ConnStatus from './_components/ConnStatus'
import EyeToggle, { EYE_INIT_SCRIPT } from './_components/EyeToggle'
import { getPendingCount } from '@/lib/records'
import { getCurrentUser } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Mama Lek',
  description: 'Mama Lek — one AI HQ for the whole business.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Mama Lek', statusBarStyle: 'default' },
}

// theme-color drives the phone status-bar tint when installed to the home screen.
export const viewport: Viewport = {
  themeColor: '#FAF7F2',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  // Login and reset pages get no menu, so nothing leaks to someone not logged in.
  if (!user) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    )
  }
  const access = { role: user.role, extra_tabs: user.extra_tabs }
  const pending = user.role === 'owner' ? await getPendingCount() : 0
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: EYE_INIT_SCRIPT }} />
        <EyeToggle />
        <div className="app">
          {/* Desktop sidebar — hidden on phones (BottomNav takes over ≤768px). */}
          <aside className="side">
            <div className="brand"><img className="logo" src="/icons/logo.png" alt="" /> Mama Lek</div>
            <Nav pendingCount={pending} user={access} />
            <p className="hint">One <code>records</code> table behind every tab. Your robots live in <code>agents/</code>.</p>
          </aside>
          <main className="main"><ConnStatus />{children}</main>
        </div>
        {/* Phone bottom bar — hidden on desktop. */}
        <BottomNav user={access} />
      </body>
    </html>
  )
}
