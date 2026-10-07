'use client'

import { Ban, Loader2, Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { newClientRef } from '@/components/administracion/cajas-ventas/client-ref'
import { DateField } from '@/components/administracion/date-input'
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
import { reverseDocument, voidDocument } from '@/lib/accounting/actions/documents'
import { formatIsoDay, formatMonthLabel, monthName } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { ReasonField, reasonError } from '../../../libros/_components/reason-field'

const OFFLINE = 'Sin conexión: no se anuló. Probá de nuevo.'

function bundleText(siblings: readonly string[]): string | null {
  if (siblings.length === 0) return null
  if (siblings.length === 1) return `Se guardó junto con ${siblings[0]}: se anulan los dos.`
  return `Se guardó junto con ${siblings.join(', ')}: se anula todo junto.`
}

function appliedText(appliedCents: number | null): string | null {
  return appliedCents && appliedCents > 0
    ? `Tiene ${formatCents(appliedCents)} en pagos o cobros aplicados. Si lo anulás, esos pagos quedan a cuenta.`
    : null
}

/**
 * «Anular» un comprobante de un mes abierto (H.14, C.4.1): con motivo, todo lo
 * que se guardó junto, y avisando antes si tiene pagos aplicados. No se borra
 * nada: queda anulado con nombre, fecha y motivo.
 */
export function VoidDocumentButton({
  tenantSlug,
  documentId,
  title,
  siblings,
  appliedCents,
}: {
  tenantSlug: string
  documentId: string
  title: string
  /** Lo que se guardó junto y sigue vigente («Pago #126»). */
  siblings: readonly string[]
  /** Pagos o cobros de otros aplicados sobre sus partidas (factura pagada). */
  appliedCents: number | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unallocate, setUnallocate] = useState(Boolean(appliedCents && appliedCents > 0))
  const [confirmAgain, setConfirmAgain] = useState(false)
  const [pending, startTransition] = useTransition()

  function reset() {
    setConfirmAgain(false)
    setReason('')
    setFieldError(null)
    setError(null)
    setUnallocate(Boolean(appliedCents && appliedCents > 0))
  }

  function run() {
    const problem = reasonError(reason)
    setFieldError(problem)
    if (problem) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await voidDocument(tenantSlug, {
          documentId,
          reason: reason.trim(),
          withBundle: siblings.length > 0,
          unallocate,
        })
        if (result.ok) {
          setOpen(false)
          reset()
          toast.success(result.message)
          router.refresh()
          return
        }
        if (result.detail?.key === 'document_has_allocations') {
          // La base encontró pagos aplicados que no estaban a la vista: se pregunta otra vez.
          setUnallocate(true)
          setConfirmAgain(true)
        }
        if (result.fieldErrors?.reason) setFieldError(result.fieldErrors.reason)
        setError(result.message)
      } catch {
        setError(OFFLINE)
      }
    })
  }

  const extra = [bundleText(siblings), appliedText(appliedCents)].filter(Boolean)

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) reset()
      }}
    >
      <Button
        type="button"
        variant="outline"
        className="h-11 gap-2 text-destructive hover:text-destructive md:h-9"
        onClick={() => setOpen(true)}
      >
        <Ban className="size-4" aria-hidden />
        Anular
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Anulás {title}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="text-pretty">
                Queda anulado con tu nombre y el motivo (no se borra) y deja de contar en los
                libros.
              </p>
              {extra.map((text) => (
                <p key={text} className="text-pretty">
                  {text}
                </p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ReasonField
          value={reason}
          onChange={(v) => {
            setReason(v)
            if (fieldError) setFieldError(null)
          }}
          error={fieldError}
          disabled={pending}
          hint="Queda con el comprobante y lo ve la contadora."
          placeholder="Por ejemplo: lo cargué dos veces."
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive text-pretty">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button
            type="button"
            disabled={pending}
            onClick={run}
            className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Anulando…' : confirmAgain ? 'Anular igual' : 'Anular'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * «Anular con fecha de hoy» (H.14, C.4.3): para un comprobante de un mes
 * cerrado cargado por error. El mes cerrado no cambia: se escribe la anulación
 * (el mismo comprobante al revés) con fecha de un mes abierto.
 */
export function ReverseDocumentButton({
  tenantSlug,
  documentId,
  title,
  documentMonth,
  today,
  minDate,
  ivaMode,
  hasFiscal,
  appliedCents,
}: {
  tenantSlug: string
  documentId: string
  title: string
  /** Mes del comprobante (`yyyy-MM-dd` de su fecha contable). */
  documentMonth: string
  today: string
  /** El primer día que se puede elegir: del primer mes abierto y no antes del comprobante. */
  minDate: string
  /** Cómo entra al Libro IVA una anulación de un mes cerrado (Ajustes › Ejercicio). */
  ivaMode: 'adjustment_only' | 'negative_row' | null
  hasFiscal: boolean
  appliedCents: number | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState<string | null>(today >= minDate ? today : null)
  const [reason, setReason] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unallocate, setUnallocate] = useState(Boolean(appliedCents && appliedCents > 0))
  const [clientRef, setClientRef] = useState(newClientRef)
  const [confirmAgain, setConfirmAgain] = useState(false)
  const [pending, startTransition] = useTransition()
  const canPick = minDate <= today

  function reset() {
    setConfirmAgain(false)
    setDate(today >= minDate ? today : null)
    setReason('')
    setFieldError(null)
    setDateError(null)
    setError(null)
    setUnallocate(Boolean(appliedCents && appliedCents > 0))
    setClientRef(newClientRef())
  }

  function run() {
    const problem = reasonError(reason)
    const badDate =
      date === null
        ? 'Elegí la fecha de la anulación.'
        : date < minDate || date > today
          ? `Elegí una fecha entre el ${formatIsoDay(minDate)} y hoy.`
          : null
    setFieldError(problem)
    setDateError(badDate)
    if (problem || badDate || date === null) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await reverseDocument(tenantSlug, {
          clientRef,
          documentId,
          reason: reason.trim(),
          reversalDate: date,
          unallocate,
        })
        if (result.ok) {
          setOpen(false)
          reset()
          toast.success(result.message)
          router.refresh()
          return
        }
        if (result.detail?.key === 'document_has_allocations') {
          setUnallocate(true)
          setConfirmAgain(true)
        }
        if (result.fieldErrors?.reason) setFieldError(result.fieldErrors.reason)
        if (result.fieldErrors?.reversalDate) setDateError(result.fieldErrors.reversalDate)
        setError(result.message)
      } catch {
        setError(OFFLINE)
      }
    })
  }

  const originalMonth = formatMonthLabel(documentMonth)
  const targetMonth = date ? monthName(Number(date.slice(5, 7))) : null
  const ivaText = !hasFiscal
    ? null
    : ivaMode === 'negative_row'
      ? `En el Libro IVA${targetMonth ? ` de ${targetMonth}` : ''} aparece el mismo comprobante en negativo («Anulación de …»).`
      : `En el Libro IVA no aparece una fila nueva: la contadora lo ve en la posición de IVA${targetMonth ? ` de ${targetMonth}` : ''} como ajuste de un período cerrado y decide si rectifica.`
  const extra = [ivaText, appliedText(appliedCents)].filter(Boolean)

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) reset()
      }}
    >
      <Button
        type="button"
        variant="outline"
        className="h-11 gap-2 md:h-9"
        onClick={() => setOpen(true)}
        disabled={!canPick}
      >
        <Undo2 className="size-4" aria-hidden />
        Anular con fecha de hoy
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Anulás {title} con fecha de hoy?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="text-pretty">
                Es para un error de carga (un duplicado, el proveedor equivocado). {originalMonth}{' '}
                no cambia: se carga la anulación, el mismo comprobante al revés, con la fecha que
                elijas.
              </p>
              {extra.map((text) => (
                <p key={text} className="text-pretty">
                  {text}
                </p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-4">
          <DateField
            label="Fecha de la anulación"
            value={date}
            onValueChange={(v) => {
              setDate(v)
              if (dateError) setDateError(null)
            }}
            min={minDate}
            max={today}
            today={today}
            shortcuts={today >= minDate ? [{ label: 'Hoy', value: today }] : false}
            required
            disabled={pending}
            error={dateError}
          />
          <ReasonField
            value={reason}
            onChange={(v) => {
              setReason(v)
              if (fieldError) setFieldError(null)
            }}
            error={fieldError}
            disabled={pending}
            hint="Queda con el comprobante y lo ve la contadora."
            placeholder="Por ejemplo: era de otro proveedor."
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive text-pretty">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button
            type="button"
            disabled={pending}
            onClick={run}
            className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Anulando…' : confirmAgain ? 'Anular igual' : 'Anular'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
