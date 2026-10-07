import { Download, Printer } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { renderQrPngDataUrl, renderQrSvg } from '@/lib/qr'

/**
 * Tarjeta de un QR fijo del local (carta o club). Server component: renderiza el
 * QR como SVG inline y ofrece descarga PNG (data URL), copiar el link e
 * impresión opcional.
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
    <Card className="items-center text-center">
      {/* El QR va sobre blanco siempre (también en oscuro): los lectores lo necesitan así. */}
      <div
        className="size-44 rounded-lg border border-border bg-white p-2 [&_svg]:h-full [&_svg]:w-full"
        role="img"
        aria-label={`QR de ${title.toLowerCase()}`}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generado server-side por la lib qrcode (input controlado)
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="flex flex-col gap-1">
        <h2 className="type-subtitle">{title}</h2>
        <p className="mx-auto max-w-xs text-pretty type-small text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="flex w-full min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-left font-mono type-caption text-muted-foreground">
          {url}
        </code>
        <CopyButton
          value={url}
          iconOnly
          size="icon-sm"
          label={`Copiar el link de ${title.toLowerCase()}`}
          copiedLabel="Link copiado"
        />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <a href={pngDataUrl} download={downloadName}>
            <Download aria-hidden="true" />
            Descargar PNG
          </a>
        </Button>
        {printHref ? (
          <Button asChild variant="secondary">
            <Link href={printHref}>
              <Printer aria-hidden="true" />
              Imprimir
            </Link>
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
