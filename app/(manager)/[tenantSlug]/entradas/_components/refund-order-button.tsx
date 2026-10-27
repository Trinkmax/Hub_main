'use client'

import { Loader2, Undo2 } from 'lucide-react'
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
import { refundTicketOrder } from '@/lib/ticketing/actions'

/**
 * «Devolver» de una venta pagada: devuelve la plata por Mercado Pago y cancela
 * la reserva, sin entrar a Mercado Pago. Es plata y no se deshace, así que
 * pide confirmación diciendo cuánto, a quién y qué pasa con la reserva.
 */
export function RefundOrderButton({
  tenantSlug,
  orderId,
  guestName,
  amountLabel,
  functionLabel,
  hasReservation,
}: {
  tenantSlug: string
  orderId: string
  guestName: string
  /** «$ 5.000» */
  amountLabel: string
  /** «Shrek 2 · Jue 30 oct 21:00» */
  functionLabel: string
  hasReservation: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function refund() {
    startTransition(async () => {
      const result = await refundTicketOrder(tenantSlug, orderId)
      if (result.ok) {
        setOpen(false)
        toast.success(result.message ?? 'Compra devuelta.')
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-11 px-2.5 text-muted-foreground hover:text-destructive md:h-8"
        onClick={() => setOpen(true)}
      >
        <Undo2 className="size-3.5" aria-hidden />
        Devolver
        <span className="sr-only">la compra de {guestName}</span>
      </Button>

      <AlertDialog open={open} onOpenChange={(next) => (pending ? null : setOpen(next))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Devolverle {amountLabel} a {guestName}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Mercado Pago le devuelve la plata por el mismo medio con el que pagó
                  {hasReservation ? (
                    <>
                      {' '}
                      y se cancela su reserva para{' '}
                      <span className="text-foreground">{functionLabel}</span>
                    </>
                  ) : null}
                  . No se puede deshacer.
                </p>
                <p className="text-xs">
                  Para devolver, la cuenta de Mercado Pago tiene que tener saldo disponible por ese
                  monto.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                refund()
              }}
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? 'Devolviendo…' : `Sí, devolver ${amountLabel}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
