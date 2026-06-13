import { Globe2, Palette, Type } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuración · Apariencia"
        title="Apariencia"
        description="Cómo se ve tu bar dentro de HUB."
      />

      <Card className="card-hairline gap-4 border-border/70 bg-card/85 p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-[--cream-tint] text-primary">
            <Type className="size-5" aria-hidden />
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="font-serif text-lg font-semibold tracking-tight">Logo del bar</h2>
            <p className="text-sm text-muted-foreground">
              Aparece arriba del sidebar, en la portada del menú público y en los emails de
              difusión. Si no subís un logo, mostramos el wordmark HUB!.
            </p>
          </div>
        </div>
        <div className="px-1">
          <LogoUploader
            tenantSlug={tenantSlug}
            tenantName={access.tenant.name}
            initialLogoUrl={access.tenant.logo_url ?? null}
          />
        </div>
      </Card>

      <Card className="card-hairline gap-4 border-border/70 bg-card/85 p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-[--cream-tint] text-primary">
            <Palette className="size-5" aria-hidden />
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="font-serif text-lg font-semibold tracking-tight">Acento del bar</h2>
            <p className="text-sm text-muted-foreground">
              Elegí el color de marca de tu bar. Se aplica en las superficies que ven tus clientes:
              la carta, la wallet de puntos y la pantalla de reseñas.
            </p>
          </div>
        </div>
        <div className="px-1">
          <BrandAccentPicker tenantSlug={tenantSlug} initial={access.tenant.brand_accent ?? null} />
        </div>
      </Card>

      <Card className="card-hairline gap-4 border-border/70 bg-card/85 p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-[--cream-tint] text-primary">
            <Globe2 className="size-5" aria-hidden />
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="font-serif text-lg font-semibold tracking-tight">
              Idioma · zona horaria
            </h2>
            <p className="text-sm text-muted-foreground">
              HUB se muestra en español rioplatense (es-AR). La zona horaria está fijada en{' '}
              <span className="font-mono text-foreground">America/Argentina/Cordoba</span>.
            </p>
            <p className="text-xs text-muted-foreground/80">
              Estos valores son fijos por ahora. Si necesitás otra TZ, escribinos.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
