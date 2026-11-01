import Link from 'next/link'

// The row of buttons along the top of every /hr page. It only shows what this
// person can open; each page checks again on its own.
//   hr       — HR admin or owner
//   manager  — supervises at least one person
//   trainer  — may record training for at least one person
export default function HRTabs({ active, hr, manager = hr, trainer = hr }: { active: string; hr: boolean; manager?: boolean; trainer?: boolean }) {
  const tabs = [
    ...(manager ? [['/hr', 'Home'], ['/hr/leave', 'Leave'], ['/hr/people', 'People']] : []),
    ...(trainer ? [['/hr/onboarding', 'Onboarding'], ['/hr/learning', 'Training']] : []),
    ['/hr/culture', 'Company'],
    ...(hr ? [['/hr/settings', 'Settings']] : []),
    ['/me', 'My HR'],
  ]
  return (
    <div className="btnrow" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
      {tabs.map(([href, label]) => (
        <Link key={href} href={href} className={`btn${active === href ? '' : ' ghost'}`}>{label}</Link>
      ))}
    </div>
  )
}
