'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'
import { accessLevel } from '@/lib/access'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

async function canEdit(): Promise<boolean> {
  const user = await getCurrentUser()
  return !!user && accessLevel(user, '/suppliers') === 'edit'
}

export async function addSupplier(name: string, phone: string): Promise<Result> {
  if (!(await canEdit())) return { ok: false, message: 'Only your team lead can do this.' }
  if (!name.trim()) return { ok: false, message: 'Add the supplier name.' }
  const { error } = await supabase.from('suppliers').insert({ name: name.trim(), phone: phone.trim() || null })
  if (error) return { ok: false, message: /duplicate/i.test(error.message) ? 'That supplier already exists.' : error.message }
  revalidatePath('/suppliers')
  return { ok: true, message: 'Supplier added.' }
}

export async function addProduct(supplierId: number, name: string, unit: string, price: string): Promise<Result> {
  if (!(await canEdit())) return { ok: false, message: 'Only your team lead can do this.' }
  if (!name.trim()) return { ok: false, message: 'Add the product name.' }
  const { error } = await supabase.from('supplier_products').insert({
    supplier_id: supplierId,
    name: name.trim(),
    unit: unit.trim() || null,
    price: price.trim() ? Number(price) : null,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/suppliers')
  return { ok: true, message: 'Product added.' }
}

// Phone for a supplier card (owners or ticked staff key it in). Adds the supplier when new.
export async function saveContact(name: string, phone: string): Promise<Result> {
  if (!(await canEdit())) return { ok: false, message: 'Ask an owner to tick Suppliers for you.' }
  const clean = name.trim()
  if (!clean) return { ok: false, message: 'No supplier name.' }
  const digits = phone.replace(/[^\d+ -]/g, '').trim()
  if (digits.replace(/\D/g, '').length < 8) return { ok: false, message: 'Enter a phone number.' }
  const { data: found } = await supabase.from('suppliers').select('id').ilike('name', clean).limit(1)
  const { error } = found?.[0]
    ? await supabase.from('suppliers').update({ phone: digits }).eq('id', found[0].id)
    : await supabase.from('suppliers').insert({ name: clean, phone: digits })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/suppliers')
  return { ok: true, message: 'Saved.' }
}
