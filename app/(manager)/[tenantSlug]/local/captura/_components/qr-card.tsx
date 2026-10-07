import { Download, Printer } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { renderQrPngDataUrl, renderQrSvg } from '@/lib/qr'

/**
 * Tarjeta de un QR fijo del local (carta o club). Server component: renderiza el
 * QR como SVG inline y ofrece descarga PNG (data URL) e impresión opcional.
 */
export async function QrCard({
  title,
  description,
  url,
  downloadName,
  printHref,
}: {
  title: string
  description: string
  url: string
  downloadName: string
  printHref?: string
}) {
  const [svg, pngDataUrl] = await Promise.all([renderQrSvg(url), renderQrPngDataUrl(url)])

  return (
    <div className="card-hairline flex flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center">
      <div
        className="size-44 rounded-xl border border-border/60 bg-white p-2 shadow-sm [&_svg]:h-full [&_svg]:w-full"
        role="img"
        aria-label={`QR: ${title}`}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generado server-side por la lib qrcode (input controlado)
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="space-y-1">
        <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mx-auto max-w-xs text-pretty text-sm text-muted-foreground">{description}</p>
      </div>
      <code className="block w-full truncate rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
        {url}
      </code>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild className="gap-1.5">
          <a href={pngDataUrl} download={downloadName}>
            <Download className="size-4" />
            Descargar PNG
          </a>
        </Button>
        {printHref ? (
          <Button asChild variant="outline" className="gap-1.5">
            <Link href={printHref}>
              <Printer className="size-4" />
              Imprimir
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
