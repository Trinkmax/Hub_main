import { ArrowUpRight } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
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
        eyebrow="Marketing"
        title="Link de Instagram"
        description="Un solo link para la bio, con todos tus destinos adentro y la identidad del bar. Editalo acá y se actualiza al instante."
        actions={
          <>
            <CopyButton value={publicUrl} label="Copiar link" copiedLabel="¡Copiado!" />
            <Button asChild variant="outline">
              <a href={`/l/${tenantSlug}`} target="_blank" rel="noopener noreferrer">
                Ver página
                <ArrowUpRight className="size-4" aria-hidden />
              </a>
            </Button>
          </>
        }
      />

      <div className="card-hairline flex flex-wrap items-center gap-2 rounded-xl border bg-cream-tint px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Pegá esto en Instagram
        </span>
        <code className="min-w-0 flex-1 truncate rounded-md bg-card px-2 py-1 font-mono text-[13px]">
          {publicUrl}
        </code>
      </div>

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
