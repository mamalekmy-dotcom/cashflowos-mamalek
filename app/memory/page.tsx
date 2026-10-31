import { getPersona } from '@/lib/ai'
import { requireOwner } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { MemoryForm, PersonaForm } from './MemoryForms'

export const dynamic = 'force-dynamic'

export default async function OutletMemory() {
  await requireOwner()
  const [persona, { data }] = await Promise.all([
    getPersona(),
    supabase.from('outlet_memory').select('id, kind, title, body').order('created_at', { ascending: false }),
  ])

  return (
    <>
      <h1 className="ph">Outlet Memory</h1>
      <p className="cap">What your AI knows about the shop.</p>
      <PersonaForm {...persona} />
      <MemoryForm />
      {data?.length ? (
        <table className="tbl" style={{ maxWidth: 640 }}>
          <thead><tr><th>Type</th><th>Title</th><th>Details</th></tr></thead>
          <tbody>
            {data.map(m => (
              <tr key={m.id}>
                <td data-label="Type">{m.kind}</td>
                <td data-label="Title">{m.title}</td>
                <td data-label="Details">{m.body ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  )
}
