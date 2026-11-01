'use server'

import { revalidatePath } from 'next/cache'
import { accessLevel } from '@/lib/access'
import { getCurrentUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

type Result = { ok: boolean; message: string }

const fail = (message: string): Result => ({ ok: false, message })

async function editor() {
  const user = await getCurrentUser()
  return user && accessLevel(user, '/stock') === 'edit' ? user : null
}

export async function addItem(input: { area: string; section: string; name: string; packSize: string; price: number }): Promise<Result> {
  const user = await editor()
  if (!user) return fail('You do not have access to this.')
  const area = input.area.trim().toUpperCase()
  const section = input.section.trim().toUpperCase()
  const name = input.name.trim()
  if (!area || !section) return fail('Pick where this item goes.')
  if (!name) return fail('Enter the item name.')
  if (!Number.isFinite(input.price) || input.price < 0) return fail('Enter the price as a number.')
  const { error } = await supabase.from('stock_items').insert({
    area, section, name, pack_size: input.packSize.trim() || null, unit_price: input.price, added_by: user.id,
  })
  if (error) return fail(error.code === '23505' ? 'That item is already on the list.' : error.message)
  revalidatePath('/stock')
  return { ok: true, message: `${name} added.` }
}

// Only items added here can go. The list itself stays, so a slip can't remove a real item.
export async function removeItem(id: number): Promise<Result> {
  if (!(await editor())) return fail('You do not have access to this.')
  const { error } = await supabase.from('stock_items').delete().eq('id', id).not('added_by', 'is', null)
  if (error) return fail(error.message)
  revalidatePath('/stock')
  return { ok: true, message: 'Removed.' }
}
