import Link from 'next/link'

// The row of buttons along the top of every /hr page. Settings only shows for HR;
// the page itself checks again.
export default function HRTabs({ active, hr }: { active: string; hr: boolean }) {
  const tabs = [['/hr', 'Home'], ['/hr/leave', 'Leave'], ['/hr/people', 'People'], ...(hr ? [['/hr/settings', 'Settings']] : []), ['/me', 'My HR']]
  return (
    <div className="btnrow" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
      {tabs.map(([href, label]) => (
        <Link key={href} href={href} className={`btn${active === href ? '' : ' ghost'}`}>{label}</Link>
      ))}
    </div>
  )
}
