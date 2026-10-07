import { ArrowUpRight } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { ReloadLink } from '@/components/ui/reload-link'
import { getAppUrl } from '@/lib/app-url'
import { getPublicLinkPage, listPublicLinks } from '@/lib/public-links/queries'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'
import { LinksManager } from './_components/links-manager'

export const metadata = { title: 'Link de Instagram' }

// La previa tiene que reflejar lo último guardado apenas se vuelve a la página.
export const dynamic = 'force-dynamic'

export default async function EnlacesPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
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

  const [page, links, appUrl] = await Promise.all([
    getPublicLinkPage(access.tenant.id),
    listPublicLinks(access.tenant.id),
    getAppUrl(),
  ])

  const publicUrl = `${appUrl}/l/${tenantSlug}`

  return (
    <PageShell>
      <PageHeader
        title="Link de Instagram"
        description="Un solo link para la bio, con todos tus destinos adentro y la identidad del bar. Lo que cambies acá se ve al instante."
        meta={
          <>
            Pegá este link en la bio de Instagram:{' '}
            <span className="break-all font-mono text-foreground">{publicUrl}</span>
          </>
        }
        actions={
          <>
            <Button asChild variant="secondary">
              <ReloadLink href={`/l/${tenantSlug}`} newTab>
                Ver página
                <ArrowUpRight aria-hidden />
              </ReloadLink>
            </Button>
            <CopyButton value={publicUrl} size="md" label="Copiar link" copiedLabel="¡Copiado!" />
          </>
        }
      />

      <LinksManager
        tenantSlug={tenantSlug}
        tenantName={access.tenant.name}
        logoUrl={access.tenant.logo_url}
        brandAccent={access.tenant.brand_accent}
        page={page}
        links={links}
      />
    </PageShell>
  )
}
