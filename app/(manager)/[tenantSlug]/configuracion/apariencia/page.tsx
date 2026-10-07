import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { settingsHref } from '../_components/settings-nav'
import { BrandAccentPicker } from './_components/brand-accent-picker'
import { LogoUploader } from './_components/logo-uploader'

export const metadata = { title: 'Apariencia' }

export default async function AparienciaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
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

  return (
    <>
      <PageHeader
        back={{ href: settingsHref(tenantSlug), label: 'Configuración' }}
        title="Apariencia"
        description="Cómo se ve tu bar dentro de HUB y en lo que ven tus clientes."
      />

      <div className="flex max-w-3xl flex-col gap-8">
        <Section
          title="Logo del bar"
          description="Aparece arriba del menú del panel, en la portada de la carta y en los emails de difusión. Si no subís un logo, mostramos el wordmark HUB!."
        >
          <LogoUploader
            tenantSlug={tenantSlug}
            tenantName={access.tenant.name}
            initialLogoUrl={access.tenant.logo_url ?? null}
          />
        </Section>

        <Section
          divider
          title="Color del bar"
          description="El color de marca de tu bar. Se aplica en lo que ven tus clientes: la carta, la wallet de puntos y la pantalla de reseñas."
        >
          <BrandAccentPicker tenantSlug={tenantSlug} initial={access.tenant.brand_accent ?? null} />
        </Section>

        <Section
          divider
          title="Idioma y zona horaria"
          description="Por ahora son fijos. Si necesitás otra zona horaria, escribinos."
        >
          <dl className="grid max-w-md grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 type-body">
            <dt className="text-muted-foreground">Idioma</dt>
            <dd className="text-foreground">Español rioplatense (es-AR)</dd>
            <dt className="text-muted-foreground">Zona horaria</dt>
            <dd className="break-words text-foreground">America/Argentina/Cordoba</dd>
          </dl>
        </Section>
      </div>
    </>
  )
}
