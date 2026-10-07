'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { IvaPositionExpected } from '@/lib/accounting/actions/payloads'
import { generateIvaSettlement } from '@/lib/accounting/actions/periods'

/**
 * «Registrar la liquidación del IVA» (H.12, C.5.4): para el modo manual. Manda
 * las cifras que la persona está viendo; si cambió algo mientras tanto, la
 * base contesta que cambió y la página se recarga con las nuevas. Si había una
 * que quedó vieja, la base la anula y registra la nueva; si el mes ahora da
 * cero (`zero`), solo la anula.
 */
export function RegisterSettlementButton({
  tenantSlug,
  month,
  monthLabel,
  expected,
  resultText,
  again,
  zero = false,
}: {
  tenantSlug: string
  /** Primer día del mes (`yyyy-MM-01`). */
  month: string
  /** «octubre». */
  monthLabel: string
  expected: IvaPositionExpected
  /** «Queda IVA a pagar: $ 89.140.000,00.» */
  resultText: string
  /** Ya había una liquidación que quedó vieja. */
  again: boolean
  /** El mes ahora da cero: registrar de nuevo es anular la vieja. */
  zero?: boolean
}) {
  const voidsOnly = again && zero
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await generateIvaSettlement(tenantSlug, { month, expected })
        if (result.ok) {
          setOpen(false)
          toast.success(result.message)
          router.refresh()
          return
        }
        if (result.code === 'preview_stale') {
          setOpen(false)
          toast.message('Cambió algo en el mes mientras mirabas.', {
            description: 'Actualizamos la posición: revisala y registrala de nuevo.',
          })
          router.refresh()
          return
        }
        setError(result.message)
      } catch {
        setError('Sin conexión: no se registró. Probá de nuevo.')
      }
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <Button type="button" className="h-11 md:h-9" onClick={() => setOpen(true)}>
        {voidsOnly
          ? 'Anular la liquidación vieja'
          : again
            ? 'Registrar la liquidación de nuevo'
            : 'Registrar la liquidación del IVA'}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {voidsOnly
              ? `¿Anulás la liquidación del IVA de ${monthLabel}?`
              : `¿Registrás la liquidación del IVA de ${monthLabel}?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="text-pretty">{resultText}</p>
              <p className="text-pretty">
                {voidsOnly
                  ? 'Quedó vieja: después se cargó o se anuló algo del mes.'
                  : again
                    ? 'La liquidación anterior quedó vieja (se cargó algo después): se reemplaza por esta.'
                    : `Si después cargás algo más de ${monthLabel}, la podés registrar de nuevo.`}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button type="button" disabled={pending} onClick={run} className="gap-2">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending
              ? voidsOnly
                ? 'Anulando…'
                : 'Registrando…'
              : voidsOnly
                ? 'Anular'
                : 'Registrar'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
