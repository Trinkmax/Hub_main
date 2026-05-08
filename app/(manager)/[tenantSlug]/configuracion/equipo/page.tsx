import { ShieldCheck, UsersRound } from 'lucide-react'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import type { TenantRole } from '@/lib/tenant/types'
import { CreateMemberForm } from './_create-member-form'
import { type Member, MemberRow } from './_member-row'

export const metadata = { title: 'Equipo' }

type RpcMember = {
  id: string
  user_id: string
  email: string
  full_name: string | null
  role: TenantRole
  created_at: string
}

export default async function EquipoPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: rows, error } = await supabase.rpc('get_tenant_members', {
    p_tenant: access.tenant.id,
  })
  if (error) {
    console.error('[equipo] get_tenant_members', error)
  }

  const members: Member[] = (rows ?? []).map((r: RpcMember) => ({
    id: r.id,
    user_id: r.user_id,
    email: r.email,
    full_name: r.full_name,
    role: r.role,
    created_at: r.created_at,
  }))

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Configuración"
        title="Equipo"
        description="Sumá a tu staff con email y contraseña. Cada rol ve solo lo que necesita."
      />

      <div className="card-hairline relative overflow-hidden rounded-xl border bg-card">
        <div className="border-b border-border/60 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <h2 className="font-display text-sm font-semibold tracking-tight">Sumar miembro</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Crear cuenta con email + contraseña. Si el email ya existe en HUB, le damos acceso al
            bar sin tocarle la contraseña actual.
          </p>
        </div>
        <div className="p-5">
          <CreateMemberForm tenantSlug={tenantSlug} />
        </div>
      </div>

      <section className="space-y-3">
        <header className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold tracking-tight">
            <UsersRound className="size-4 text-muted-foreground" />
            Miembros{' '}
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {members.length}
            </span>
          </h2>
        </header>
        <div className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              tenantSlug={tenantSlug}
              isCurrentUser={user?.id === m.user_id}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
