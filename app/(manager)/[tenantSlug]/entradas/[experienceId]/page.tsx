import { Clapperboard } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageShell } from '@/components/ui/page-shell'
import { getAppUrl } from '@/lib/app-url'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { getAdminExperience } from '@/lib/ticketing/queries'
import { ExperienceEditor } from './_components/experience-editor'

export const metadata = { title: 'Editar película' }

// El editor arranca con lo último guardado y los lugares de ahora, siempre.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function EditarPeliculaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; experienceId: string }>
}) {
  const { tenantSlug, experienceId } = await params
  // Un id que no es uuid haría fallar la consulta (22P02): es un link roto, no un error.
  if (!UUID_RE.test(experienceId)) notFound()

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  const [experience, appUrl] = await Promise.all([
    getAdminExperience(access.tenant.id, experienceId),
    getAppUrl(),
  ])

  // Borrada (también justo después de «Borrar página», antes de volver a la lista).
  if (!experience) {
    return (
      <PageShell width="compact">
        <EmptyState
          icon={Clapperboard}
          title="Esta película ya no está"
          description="Puede que hayan borrado su página. En Entradas están todas las que quedan."
          action={
            <Button asChild className="h-11 sm:h-9">
              <Link href={`/${tenantSlug}/entradas`}>Volver a Entradas</Link>
            </Button>
          }
        />
      </PageShell>
    )
  }

  return (
    <ExperienceEditor
      // Al pasar a otra película, el formulario arranca de cero.
      key={experience.id}
      tenantSlug={tenantSlug}
      tenantId={access.tenant.id}
      experience={experience}
      publicBase={`${appUrl}/entradas/${tenantSlug}`}
    />
  )
}
