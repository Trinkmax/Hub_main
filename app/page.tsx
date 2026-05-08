import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveTenant, getMembershipsForUser } from '@/lib/tenant'
import type { TenantRole } from '@/lib/tenant/types'

const STAFF_ROLES = new Set<TenantRole>(['cashier', 'waiter', 'kitchen'])

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const memberships = await getMembershipsForUser()
  if (memberships.length === 0) redirect('/onboarding')

  const active = await getActiveTenant()
  const targetSlug = active?.tenant.slug ?? memberships[0]?.tenant.slug
  if (!targetSlug) redirect('/onboarding')

  const role: TenantRole | undefined =
    active?.role ?? memberships.find((m) => m.tenant.slug === targetSlug)?.role

  // Mandar staff directo al salón. Owner queda en el manager.
  const dest = role && STAFF_ROLES.has(role) ? `/${targetSlug}/salon` : `/${targetSlug}`
  redirect(dest)
}
