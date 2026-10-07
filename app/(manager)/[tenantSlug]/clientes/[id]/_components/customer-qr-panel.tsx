'use client'

import { ExternalLink, Printer, RefreshCw } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CopyButton } from '@/components/ui/copy-button'
import { ReloadLink } from '@/components/ui/reload-link'
import { Spinner } from '@/components/ui/spinner'
import { rotateQrToken } from '@/lib/customers/actions'

export function CustomerQrPanel({
  tenantSlug,
  customerId,
  initialQrToken,
  appUrl,
  isOwner,
}: {
  tenantSlug: string
  customerId: string
  initialQrToken: string
  appUrl: string
  isOwner: boolean
}) {
  const [qrToken, setQrToken] = useState(initialQrToken)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const panelUrl = `${appUrl.replace(/\/$/, '')}/c/${qrToken}`

  // Importamos qrcode dinámicamente para no inflar el bundle del page completo.
  useEffect(() => {
    let cancelled = false
    import('qrcode').then(async (mod) => {
      const dataUrl = await mod.toDataURL(panelUrl, {
        width: 360,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      })
      if (!cancelled) setQrDataUrl(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [panelUrl])

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>QR personal</h2>
        </CardTitle>
        <CardDescription>
          El cajero lo escanea para acreditar puntos sin cargar ítems.
        </CardDescription>
      </CardHeader>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* El QR va sobre blanco siempre (también en oscuro): los lectores lo necesitan así. */}
        <div className="relative size-40 shrink-0 overflow-hidden rounded-lg border border-border bg-white p-2">
          {qrDataUrl ? (
            <Image
              src={qrDataUrl}
              alt="QR personal del cliente"
              width={160}
              height={160}
              className="size-full"
              unoptimized
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Spinner size={20} label="Generando el QR…" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="type-label text-muted-foreground">Link personal</p>
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono type-caption text-muted-foreground">
                {panelUrl}
              </code>
              <CopyButton
                value={panelUrl}
                iconOnly
                size="icon-sm"
                label="Copiar el link personal"
                copiedLabel="Link copiado"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary">
              <ReloadLink href={`/c/${qrToken}`} newTab>
                <ExternalLink aria-hidden="true" />
                Ver como el cliente
              </ReloadLink>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <ReloadLink href={`/print/c-qr/${qrToken}`} newTab>
                <Printer aria-hidden="true" />
                Imprimir
              </ReloadLink>
            </Button>
            {isOwner ? (
              <ConfirmDialog
                tone="danger"
                title="¿Regenerar el QR?"
                description="El link y el QR de ahora dejan de funcionar. Vas a tener que imprimir el nuevo."
                confirmLabel="Regenerar QR"
                pendingLabel="Regenerando…"
                trigger={
                  <Button type="button" size="sm" variant="ghost">
                    <RefreshCw aria-hidden="true" />
                    Regenerar
                  </Button>
                }
                onConfirm={async () => {
                  const r = await rotateQrToken(tenantSlug, customerId)
                  if (!r.ok) return r
                  setQrToken(r.token)
                  toast.success('QR regenerado.')
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  )
}
