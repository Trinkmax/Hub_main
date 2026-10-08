'use client'

import { Loader2 } from 'lucide-react'
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
import { formatIsoDay } from '@/lib/dates'
import { formatCents } from '@/lib/money'

export type EmitSummary = {
  /** «Factura B», «Nota de crédito A». */
  readonly voucherLabel: string
  /** «0005-00000104». */
  readonly numberText: string
  readonly customer: string
  readonly totalCents: number
  readonly issueDate: string
}

/**
 * «¿Emitimos la factura?» (diseño §3.2.2, paso 4): el resumen de lo que se le pide
 * a ARCA y el aviso de que una factura emitida no se borra. Mientras corre, queda
 * abierto con «Pidiendo el CAE a ARCA…» (se anuncia a lectores de pantalla) y no
 * se puede cerrar.
 */
export function EmitConfirmDialog({
  open,
  onOpenChange,
  summary,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: EmitSummary | null
  pending: boolean
  onConfirm: () => void
}) {
  const noun = summary?.voucherLabel.toLowerCase().startsWith('factura') ? 'la factura' : 'la nota'
  return (
    <AlertDialog
      open={open && summary !== null}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Emitimos {noun}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              {summary ? (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl border border-border/60 bg-secondary/30 p-4 text-foreground">
                  <dt className="text-muted-foreground">Comprobante</dt>
                  <dd className="tabular-nums">
                    {summary.voucherLabel} {summary.numberText}
                  </dd>
                  <dt className="text-muted-foreground">Cliente</dt>
                  <dd className="break-words">{summary.customer}</dd>
                  <dt className="text-muted-foreground">Fecha</dt>
                  <dd className="tabular-nums">{formatIsoDay(summary.issueDate)}</dd>
                  <dt className="font-medium">Total</dt>
                  <dd className="font-medium tabular-nums">{formatCents(summary.totalCents)}</dd>
                </dl>
              ) : null}
              <p className="text-pretty">
                Le pedimos a ARCA la autorización (el CAE) y la cargamos en los libros. Una vez
                emitida no se borra: si hay un error, se anula con una nota de crédito.
              </p>
              <p aria-live="assertive" className="font-medium text-foreground">
                {pending ? 'Pidiendo el CAE a ARCA… puede tardar unos segundos.' : ''}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 md:h-9" disabled={pending}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-11 min-w-[140px] gap-2 md:h-9"
            disabled={pending}
            onClick={(event) => {
              // Queda abierto mientras se pide el CAE: lo cierra el resultado.
              event.preventDefault()
              onConfirm()
            }}
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Emitiendo…
              </>
            ) : (
              'Emitir'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
