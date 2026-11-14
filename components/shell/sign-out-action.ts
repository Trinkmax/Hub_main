'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { VIEW_AS_COOKIE } from '@/lib/tenant/view-as'

export async function signOutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // «Ver como» no sobrevive al cierre de sesión: el próximo que entre arranca con su rol.
  ;(await cookies()).delete(VIEW_AS_COOKIE)
  redirect('/login')
}
