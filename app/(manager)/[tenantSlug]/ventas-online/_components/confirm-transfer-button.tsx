'use client'

import { CheckCheck, Loader2 } from 'lucide-react'
import { useState, useTransition } from 'react'
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
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { confirmTicketTransfer } from '@/lib/ticketing/actions'

/**
 * Para una compra que Mercado Pago no cobró y se pagó por transferencia: carga la reserva
 * y le da el QR a la entrada. El sistema no ve la cuenta, así que pregunta si la plata
 * ya llegó, diciendo cuánta y de quién.
 */
export function ConfirmTransferButton({
  tenantSlug,
  orderId,
  guestName,
  amountLabel,
  functionLabel,
  peopleLabel,
  placeReleased,
}: {
  tenantSlug: string
  orderId: string
  guestName: string
  /** «$ 40.000» */
  amountLabel: string
  /** «Shrek 2 · Jue 30 oct 21:00» */
  functionLabel: string
  /** «2 personas» */
  peopleLabel: string
  /** Ya se le venció el lugar: puede no quedar cupo. */
  placeReleased: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function confirm() {
    startTransition(async () => {
      const result = await confirmTicketTransfer(tenantSlug, orderId)
      if (result.ok) {
        setOpen(false)
        toast.success(result.message ?? 'Transferencia confirmada.')
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 px-2.5 md:h-8"
        onClick={() => setOpen(true)}
      >
        <CheckCheck className="size-3.5" aria-hidden />
        Confirmar transferencia
        <span className="sr-only">de {guestName}</span>
      </Button>

      <AlertDialog open={open} onOpenChange={(next) => (pending ? null : setOpen(next))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Te llegó la transferencia de {amountLabel}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Confirmá solo si ya viste la plata en la cuenta. Se carga la reserva de{' '}
                  <span className="text-foreground">{guestName}</span> para{' '}
                  <span className="text-foreground">{functionLabel}</span> ({peopleLabel}) y su
                  entrada pasa a tener el QR.
                </p>
                {placeReleased ? (
                  <p className="text-xs">
                    Su lugar ya se había liberado: si no queda cupo, la reserva se carga igual y
                    queda marcada con sobrecupo.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Todavía no</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                confirm()
              }}
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? 'Confirmando…' : 'Sí, me llegó'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
