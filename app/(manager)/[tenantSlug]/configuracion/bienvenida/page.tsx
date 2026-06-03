import { Gift } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { getCapturePromptConfig } from '@/lib/capture-prompt/queries'
import { listActiveRewards } from '@/lib/points/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { getWelcomeRewardConfig } from '@/lib/welcome-reward/queries'
import { CapturePromptForm } from './_components/capture-prompt-form'
import { WelcomeRewardForm } from './_components/welcome-reward-form'

export const metadata = { title: 'Regalo de bienvenida' }

export default async function BienvenidaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  // Owner-only: si no es owner del bar, devolvemos 404 — no exponemos
  // que existe la ruta pero el usuario no tiene permiso.
  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner'])
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    if (error instanceof RoleRequiredError) notFound()
    throw error
  }

  // Traemos config + rewards activos en paralelo para acelerar el TTFB.
  const [config, rewards, capturePrompt] = await Promise.all([
    getWelcomeRewardConfig(access.tenant.id),
    listActiveRewards({ tenantId: access.tenant.id }),
    getCapturePromptConfig(access.tenant.id),
  ])

  return (
    <main className="space-y-8 py-6">
      <PageHeader
        eyebrow="Configuración"
        title="Regalo de bienvenida"
        description="Premiá a quien se registre escaneando el QR. Elegí una recompensa y aparecerá en la pantalla del cliente."
      />

      {rewards.length === 0 ? (
        <EmptyState
          icon={Gift}
          title="Todavía no tenés recompensas"
          description="Creá una recompensa primero para usarla como regalo de bienvenida."
          action={
            <Button asChild>
              <Link href={`/${tenantSlug}/puntos`}>Crear recompensa</Link>
            </Button>
          }
        />
      ) : (
        <WelcomeRewardForm
          tenantSlug={tenantSlug}
          initialConfig={config}
          availableRewards={rewards}
        />
      )}
      <section className="space-y-3">
        <h2 className="font-serif text-xl font-semibold tracking-tight">Captura de datos</h2>
        <CapturePromptForm tenantSlug={tenantSlug} config={capturePrompt} />
      </section>
    </main>
  )
}
