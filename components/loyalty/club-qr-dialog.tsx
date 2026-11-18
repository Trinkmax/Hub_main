'use client'

import { Download, Loader2, QrCode } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { type ClubQr, getClubQr } from '@/lib/capture/club-qr'

/**
 * «QR del club»: el QR que invita a sumarse, a un toque desde la pantalla del Club.
 *
 * Reemplaza a la pestaña «QR del club» de Clientes, que era una pantalla entera para dos códigos
 * que se imprimen una vez. El de la carta ya tenía su botón en Carta («QR de la carta»); este es
 * el par. El mozo lo sigue mostrando desde el salón (pestaña «QR del club»).
 */
export function ClubQrDialog({
  tenantSlug,
  defaultOpen = false,
}: {
  tenantSlug: string
  /** Llega abierto: el buscador ⌘K y Tex lo abren con `?qr=1`. */
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [qr, setQr] = useState<ClubQr | null>(null)
  const [error, setError] = useState<string | null>(null)
  const asked = useRef(false)

  useEffect(() => {
    if (!open || asked.current) return
    asked.current = true
    getClubQr(tenantSlug)
      .then((result) => {
        if (result.ok) setQr(result.qr)
        else setError(result.message)
      })
      .catch(() => {
        // Que se pueda reintentar cerrando y abriendo.
        asked.current = false
        setError('No se pudo armar el QR. Revisá la conexión y probá de nuevo.')
      })
  }, [open, tenantSlug])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        <QrCode className="size-4" aria-hidden />
        QR del club
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl tracking-tight">QR del club</DialogTitle>
            <DialogDescription className="text-pretty">
              Abre la carta con el formulario del club listo. Imprimilo para la barra o la caja; el
              mozo también lo muestra desde su celular al cerrar la cuenta.
            </DialogDescription>
          </DialogHeader>

          {/* Blanco puro y QR negro, no los colores de la marca: un lector necesita contraste real. */}
          <div className="mx-auto grid size-56 place-items-center rounded-2xl border border-border/60 bg-white p-3 shadow-sm">
            {qr ? (
              <div
                className="size-full [&_svg]:size-full"
                role="img"
                aria-label="QR para sumarse al club"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generado en el servidor por la lib qrcode (input controlado)
                dangerouslySetInnerHTML={{ __html: qr.svg }}
              />
            ) : error ? (
              <p className="px-2 text-center text-sm text-neutral-700">{error}</p>
            ) : (
              <Loader2
                className="size-6 animate-spin text-neutral-400"
                aria-label="Armando el QR"
              />
            )}
          </div>

          {qr ? (
            <>
              <code className="block w-full truncate rounded-md bg-muted/60 px-2.5 py-1.5 text-center font-mono text-[11px] text-muted-foreground">
                {qr.url}
              </code>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button asChild className="gap-1.5">
                  <a href={qr.pngDataUrl} download={`qr-club-${tenantSlug}.png`}>
                    <Download className="size-4" aria-hidden />
                    Descargar
                  </a>
                </Button>
                <CopyButton value={qr.url} label="Copiar link" size="default" />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
