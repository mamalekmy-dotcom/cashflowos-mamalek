// Shown when a tab has no records yet (server component — no secrets here).
// Pass a `label` to make the message specific to the tab.
export default function Empty({ label }: { label?: string }) {
  return <div className="empty">Nothing here yet{label ? ` — no ${label} to show.` : '.'}</div>
}
