'use client'

import { ExternalLink, Loader2, Printer, RefreshCw } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
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
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [pending, start] = useTransition()

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

  const onRotate = () => {
    start(async () => {
      const r = await rotateQrToken(tenantSlug, customerId)
      if (r.ok) {
        setQrToken(r.token)
        setConfirmRotate(false)
        toast.success('QR regenerado.')
      } else {
        toast.error(r.message)
      }
    })
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(panelUrl)
      toast.success('Link copiado.')
    } catch {
      toast.error('No pudimos copiar.')
    }
  }

  return (
    <div className="card-hairline rounded-xl border bg-card p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold tracking-tight">QR personal</h2>
          <p className="text-xs text-muted-foreground">
            El cajero lo escanea para acreditar puntos sin cargar items.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative size-40 shrink-0 overflow-hidden rounded-xl border bg-white p-2 shadow-sm">
          {qrDataUrl ? (
            <Image
              src={qrDataUrl}
              alt="QR del cliente"
              width={160}
              height={160}
              className="size-full"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Link personal</p>
            <button
              type="button"
              onClick={onCopy}
              aria-label="Copiar link personal del cliente"
              className="mt-0.5 block w-full truncate text-left font-mono text-xs text-foreground transition-colors hover:text-primary"
              title="Click para copiar"
            >
              {panelUrl}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href={`/c/${qrToken}`} target="_blank" rel="noopener">
                <ExternalLink className="size-3.5" />
                Vista cliente
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href={`/print/c-qr/${qrToken}`} target="_blank" rel="noopener">
                <Printer className="size-3.5" />
                Imprimir
              </Link>
            </Button>
            {isOwner ? (
              <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    className="gap-1.5 text-muted-foreground"
                  >
                    {pending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    {pending ? 'Rotando…' : 'Rotar'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Regenerar el QR?</AlertDialogTitle>
                    <AlertDialogDescription>
                      El link anterior dejará de funcionar. Vas a tener que reimprimir el QR.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={onRotate}
                      disabled={pending}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      Regenerar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
