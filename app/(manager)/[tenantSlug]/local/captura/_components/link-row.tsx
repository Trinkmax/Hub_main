import { Badge } from '@/components/ui/badge'
import { renderQrPngDataUrl, renderQrSvg } from '@/lib/qr'
import { LinkActions } from './link-actions'

type Link = {
  id: string
  slug: string
  label: string
  active: boolean
  created_at: string
}

export async function LinkRow({
  link,
  tenantSlug,
  appUrl,
}: {
  link: Link
  tenantSlug: string
  appUrl: string
}) {
  const captureUrl = `${appUrl}/capture/${link.slug}`
  const [svg, pngDataUrl] = await Promise.all([
    renderQrSvg(captureUrl),
    renderQrPngDataUrl(captureUrl),
  ])

  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <div className="flex-shrink-0">
        <div
          className="size-24 rounded-lg border border-border/60 bg-white p-1.5 shadow-sm [&_svg]:h-full [&_svg]:w-full"
          role="img"
          aria-label={`QR para ${link.label}`}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generado server-side por la lib qrcode (input controlado)
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-base font-semibold tracking-tight">{link.label}</h3>
          {link.active ? (
            <Badge className="gap-1 bg-success text-success-foreground hover:bg-success/90">
              <span className="size-1.5 rounded-full bg-current" />
              Activo
            </Badge>
          ) : (
            <Badge variant="outline">Pausado</Badge>
          )}
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {captureUrl}
        </div>
      </div>
      <LinkActions tenantSlug={tenantSlug} link={link} pngDataUrl={pngDataUrl} />
    </div>
  )
}
