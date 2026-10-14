'use client'

import { Loader2, Unlink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { VoucherText } from '@/components/administracion/voucher-text'
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
import { unallocateItem } from '@/lib/accounting/actions/documents'
import { formatCents, formatCentsShort } from '@/lib/money'
import { ReasonField, reasonError } from '../../../libros/_components/reason-field'

const OFFLINE = 'Sin conexión: no se separó. Probá de nuevo.'
/** Otra persona la separó mientras esta pantalla estaba abierta. */
const ALREADY_GONE = 'Esa unión ya no está: alguien la separó antes.'
const GONE_KEYS: ReadonlySet<string> = new Set(['allocation_not_found', 'allocation_voided'])

/**
 * «Separar» un pago de la factura a la que quedó unido: para cuando se pagó la
 * factura equivocada. La factura vuelve a deber ese importe y el pago queda a
 * cuenta con el proveedor, como saldo a favor; después se une a la correcta
 * desde «Pagar», donde el saldo a favor ya viene tildado. No se pierde nada y
 * no hay que anular ni cargar de nuevo.
 *
 * Usa una acción que ya existía (`unallocateItem`) con el mismo envío de
 * siempre: la unión y el motivo (5 a 300 letras), que queda guardado y lo ve
 * la contadora. Cuándo se ofrece lo decide `canSeparate` (solo compras, solo
 * uniones hechas después). Quien solo mira no lo ve: ni dibujado.
 */
export function SeparateButton({
  tenantSlug,
  allocationId,
  paymentLabel,
  invoiceLabel,
  paymentWords,
  invoiceWords,
  invoiceNoun,
  amountCents,
  partyName,
}: {
  tenantSlug: string
  allocationId: string
  /** «Pago #6». */
  paymentLabel: string
  /** «Factura A 0003-00001100». */
  invoiceLabel: string
  /** Con su artículo, para la pregunta: «el Pago #6», «la Factura A 0003-00001100». */
  paymentWords: string
  invoiceWords: string
  /** Cómo se la nombra la segunda vez: «La factura», «La compra». */
  invoiceNoun: string
  amountCents: number
  partyName: string | null
}) {
  const router = useRouter()
  const { readOnly } = useAccounting()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (readOnly) return null

  const withWhom = partyName ? ` con ${partyName}` : ''
  // En una oración, pesos sin centavos (el exacto está en la fila que se separa). Menos de un
  // peso sí los lleva: nunca «$ 0» por algo que no es cero.
  const amount =
    amountCents !== 0 && Math.abs(amountCents) < 100
      ? formatCents(amountCents)
      : formatCentsShort(amountCents)

  function reset() {
    setReason('')
    setFieldError(null)
    setError(null)
  }

  function run() {
    const problem = reasonError(reason)
    setFieldError(problem)
    if (problem) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await unallocateItem(tenantSlug, { allocationId, reason: reason.trim() })
        if (result.ok) {
          setOpen(false)
          reset()
          toast.success(`Listo: el pago quedó a cuenta${withWhom}.`)
          router.refresh()
          return
        }
        const key = typeof result.detail?.key === 'string' ? result.detail.key : null
        if (key !== null && GONE_KEYS.has(key)) {
          setOpen(false)
          reset()
          toast.info(ALREADY_GONE)
          router.refresh()
          return
        }
        if (result.fieldErrors?.reason) setFieldError(result.fieldErrors.reason)
        setError(result.message)
      } catch {
        setError(OFFLINE)
      }
    })
  }

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
        variant="ghost"
        className="-mx-2 h-11 gap-1.5 px-2 text-sm font-medium text-muted-foreground hover:text-foreground md:h-8"
        aria-label={`Separar ${paymentLabel} de ${invoiceLabel}`}
        onClick={() => setOpen(true)}
      >
        <Unlink className="size-3.5" aria-hidden />
        Separar
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          {/* El número del comprobante no se corta en el guion. */}
          <AlertDialogTitle>
            ¿Separás {paymentWords} de <VoucherText text={invoiceWords} />?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="text-pretty">
                {invoiceNoun} vuelve a deber {amount} y el pago queda a cuenta{withWhom}, como saldo
                a favor. No se pierde nada.
              </p>
              <p className="text-pretty">
                Para unirlo a otra factura, abrila y tocá «Pagar»: el saldo a favor viene tildado y
                no hace falta poner plata de nuevo.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ReasonField
          value={reason}
          onChange={(value) => {
            setReason(value)
            if (fieldError) setFieldError(null)
          }}
          error={fieldError}
          disabled={pending}
          placeholder="Por ejemplo: era de otra factura."
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive text-pretty">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="h-11 md:h-9">
            Cancelar
          </AlertDialogCancel>
          <Button type="button" disabled={pending} onClick={run} className="h-11 gap-2 md:h-9">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Separando…' : 'Separar'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
