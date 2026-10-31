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
