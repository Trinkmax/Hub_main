import { UsersRound } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import {
  DataTableBody,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { createClient } from '@/lib/supabase/server'
import {
  canManageAccountant,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import type { TenantRole } from '@/lib/tenant/types'
import { ReloadErrorState } from '../_components/reload-error-state'
import { settingsHref } from '../_components/settings-nav'
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
  const user = access.user
  // «Contabilidad» solo aparece para quien administra los accesos de
  // Administración con el módulo prendido (las actions y la base lo exigen igual).
  const accountantAllowed = canManageAccountant(access.accounting)

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
    <>
      <PageHeader
        back={{ href: settingsHref(tenantSlug), label: 'Configuración' }}
        title="Equipo"
        description="Sumá a tu staff con email y contraseña. Cada rol ve solo lo que necesita."
      />

      <Section
        title="Sumar miembro"
        description="Creamos la cuenta con email y contraseña. Si ese email ya usa HUB, le damos acceso al bar sin tocarle la contraseña que tiene."
      >
        <Card>
          <CreateMemberForm tenantSlug={tenantSlug} canManageAccountant={accountantAllowed} />
        </Card>
      </Section>

      <Section
        title="Miembros"
        description={
          error
            ? undefined
            : members.length === 1
              ? '1 persona con acceso al bar.'
              : `${members.length} personas con acceso al bar.`
        }
      >
        {error ? (
          <ReloadErrorState
            size="sm"
            title="No pudimos cargar el equipo"
            description="Probá de nuevo en un rato. Mientras tanto podés sumar gente desde arriba."
          />
        ) : (
          <DataTableShell>
            <DataTableScroll>
              <DataTableRoot caption="Miembros del equipo">
                <DataTableHead>
                  <tr>
                    <DataTableHeader>Persona</DataTableHeader>
                    {/* En el celular el rol va debajo del nombre (ver MemberRow). */}
                    <DataTableHeader className="max-sm:hidden">Rol</DataTableHeader>
                    <DataTableHeader className="w-14">
                      <span className="sr-only">Acciones</span>
                    </DataTableHeader>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {members.length === 0 ? (
                    <DataTableEmpty colSpan={3}>
                      <EmptyState
                        size="sm"
                        icon={UsersRound}
                        title="Todavía no hay nadie en el equipo"
                        description="Sumá a la primera persona con el formulario de arriba."
                      />
                    </DataTableEmpty>
                  ) : (
                    members.map((m) => (
                      <MemberRow
                        key={m.id}
                        member={m}
                        tenantSlug={tenantSlug}
                        isCurrentUser={user?.id === m.user_id}
                        canManageAccountant={accountantAllowed}
                      />
                    ))
                  )}
                </DataTableBody>
              </DataTableRoot>
            </DataTableScroll>
          </DataTableShell>
        )}
      </Section>
    </>
  )
}
