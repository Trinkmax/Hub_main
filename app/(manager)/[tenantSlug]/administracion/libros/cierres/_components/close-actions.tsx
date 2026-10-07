'use client'

import { Ellipsis, Loader2, Lock, LockOpen } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { IvaPositionExpected } from '@/lib/accounting/actions/payloads'
import {
  closeFiscalYear,
  closePeriod,
  reopenFiscalYear,
  reopenPeriod,
} from '@/lib/accounting/actions/periods'
import type { CloseWarningKey } from '@/lib/accounting/types'
import { formatCents } from '@/lib/money'
import { ReasonField, reasonError } from '../../_components/reason-field'

const OFFLINE = 'Sin conexión: no se guardó. Probá de nuevo.'
const STALE =
  'Cambió algo en el mes mientras mirabas (por ejemplo, se cargó un comprobante). Actualizamos los números: revisalos y cerrá de nuevo.'

const DESTRUCTIVE = 'gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90'

/**
 * «Cerrar octubre» (H.15, C.5.1): confirma lo irreversible, acepta los avisos
 * que la persona está viendo y, si corresponde, registra la liquidación de
 * IVA con las cifras que se ven (si cambiaron mientras tanto, se recarga).
 */
export function CloseMonthButton({
  tenantSlug,
  month,
  monthNoun,
  nextMonthNoun,
  warningKeys,
  iva,
}: {
  tenantSlug: string
  /** Primer día del mes (`yyyy-MM-01`). */
  month: string
  /** «octubre». */
  monthNoun: string
  /** «noviembre»: donde van las correcciones. */
  nextMonthNoun: string
  warningKeys: readonly CloseWarningKey[]
  /**
   * La liquidación de IVA que va a tomar el cierre (`null` si no corresponde):
   * las cifras que se ven (`expected`), la frase del diálogo y si se puede
   * apagar (no, si hay que reemplazar una liquidación que quedó vieja).
   */
  iva: { expected: IvaPositionExpected; summary: string; optional: boolean } | null
}) {
  const router = useRouter()
  const switchId = useId()
  const [open, setOpen] = useState(false)
  const [generate, setGenerate] = useState(true)
  const [extraWarnings, setExtraWarnings] = useState<
    Array<{ key: CloseWarningKey; message: string }>
  >([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const settle = iva !== null && (generate || !iva.optional)

  function run() {
    setError(null)
    const acks = [...new Set([...warningKeys, ...extraWarnings.map((w) => w.key)])]
    startTransition(async () => {
      try {
        const result = await closePeriod(tenantSlug, {
          month,
          warningsAck: acks,
          ivaSettlement:
            iva && settle
              ? { generate: true, expected: iva.expected }
              : { generate: false, expected: null },
        })
        if (result.ok) {
          setOpen(false)
          setExtraWarnings([])
          toast.success(result.message)
          router.refresh()
          return
        }
        if (result.code === 'needs_confirmation' && result.closeWarnings?.length) {
          // Aparecieron avisos nuevos mientras tanto: se muestran y se confirma de nuevo.
          const known = new Set(warningKeys)
          const fresh = result.closeWarnings.filter((w) => !known.has(w.key))
          setExtraWarnings(fresh.length > 0 ? fresh : result.closeWarnings)
          setError('Aparecieron avisos nuevos. Si igual querés cerrar, confirmá de nuevo.')
          return
        }
        if (result.code === 'preview_stale') {
          setOpen(false)
          toast.message(STALE)
          router.refresh()
          return
        }
        setError(result.message)
      } catch {
        setError(OFFLINE)
      }
    })
  }

  const label = `Cerrar ${monthNoun}`
  return (
    <div className="flex flex-col gap-3 sm:items-end">
      {iva?.optional ? (
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id={switchId}
            checked={generate}
            onCheckedChange={setGenerate}
            disabled={pending}
          />
          <Label htmlFor={switchId} className="text-sm font-normal">
            Registrar la liquidación del IVA al cerrar
          </Label>
        </div>
      ) : null}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return
          setOpen(next)
          if (!next) {
            setError(null)
            setExtraWarnings([])
          }
        }}
      >
        <Button type="button" className="h-11 gap-2 md:h-10" onClick={() => setOpen(true)}>
          <Lock className="size-4" aria-hidden />
          {label}
        </Button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrás {monthNoun}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="text-pretty">
                  Después no se puede cargar ni cambiar nada con fecha de {monthNoun}. Las
                  correcciones van con una nota de crédito o un ajuste en {nextMonthNoun}.
                </p>
                {warningKeys.length > 0 ? (
                  <p className="text-pretty">
                    {warningKeys.length === 1
                      ? 'Queda un aviso sin resolver: se cierra igual.'
                      : `Quedan ${warningKeys.length} avisos sin resolver: se cierra igual.`}
                  </p>
                ) : null}
                {iva && settle && iva.summary ? <p className="text-pretty">{iva.summary}</p> : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {extraWarnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {extraWarnings.map((w) => (
                <li key={w.key} className="text-pretty">
                  {w.message}
                </li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive text-pretty">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <Button type="button" disabled={pending} onClick={run} className={DESTRUCTIVE}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? 'Cerrando…' : extraWarnings.length > 0 ? 'Cerrar igual' : label}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** El menú [⋯] de una fila con una sola acción, y su diálogo con motivo. */
function ReopenDialog({
  triggerLabel,
  itemLabel,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  triggerLabel: string
  itemLabel: string
  title: string
  description: string
  confirmLabel: string
  onConfirm: (
    reason: string,
  ) => Promise<{ ok: true; message: string } | { ok: false; message: string; field?: string }>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run() {
    const problem = reasonError(reason)
    setFieldError(problem)
    if (problem) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await onConfirm(reason.trim())
        if (result.ok) {
          setOpen(false)
          setReason('')
          toast.success(result.message)
          router.refresh()
          return
        }
        if (result.field) setFieldError(result.field)
        setError(result.message)
      } catch {
        setError(OFFLINE)
      }
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground md:size-9"
            aria-label={triggerLabel}
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem className="min-h-11 gap-2 md:min-h-9" onSelect={() => setOpen(true)}>
            <LockOpen className="size-4" aria-hidden />
            {itemLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return
          setOpen(next)
          if (!next) {
            setReason('')
            setFieldError(null)
            setError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField
            value={reason}
            onChange={(v) => {
              setReason(v)
              if (fieldError) setFieldError(null)
            }}
            error={fieldError}
            disabled={pending}
            label="¿Por qué? (lo ve la contadora)"
            hint="Al menos 5 letras."
            placeholder="Por ejemplo: faltaba cargar una factura del 28."
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive text-pretty">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <Button type="button" disabled={pending} onClick={run} className={DESTRUCTIVE}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? 'Reabriendo…' : confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** «Reabrir octubre» (solo el último mes cerrado, C.5.2), con motivo. */
export function ReopenMonthMenu({
  tenantSlug,
  month,
  monthNoun,
}: {
  tenantSlug: string
  month: string
  monthNoun: string
}) {
  return (
    <ReopenDialog
      triggerLabel={`Más opciones de ${monthNoun}`}
      itemLabel={`Reabrir ${monthNoun}`}
      title={`¿Reabrir ${monthNoun}?`}
      description={`Se borra la numeración de ${monthNoun} (vuelve a ser provisoria) y se anula su liquidación de IVA. Después lo vas a tener que cerrar de nuevo.`}
      confirmLabel={`Reabrir ${monthNoun}`}
      onConfirm={async (reason) => {
        const result = await reopenPeriod(tenantSlug, { month, reason })
        return result.ok
          ? { ok: true, message: result.message }
          : { ok: false, message: result.message, field: result.fieldErrors?.reason }
      }}
    />
  )
}

/** «Reabrir el ejercicio» (si el siguiente no está cerrado), con motivo. */
export function ReopenFiscalYearMenu({
  tenantSlug,
  fiscalYearId,
  label,
}: {
  tenantSlug: string
  fiscalYearId: string
  /** «2026». */
  label: string
}) {
  return (
    <ReopenDialog
      triggerLabel={`Más opciones del ejercicio ${label}`}
      itemLabel="Reabrir el ejercicio"
      title={`¿Reabrir el ejercicio ${label}?`}
      description="Se anulan la refundición, el cierre y la apertura del ejercicio siguiente. Los ajustes de cierre de la contadora quedan, con número provisorio."
      confirmLabel="Reabrir el ejercicio"
      onConfirm={async (reason) => {
        const result = await reopenFiscalYear(tenantSlug, { fiscalYearId, reason })
        return result.ok
          ? { ok: true, message: result.message }
          : { ok: false, message: result.message, field: result.fieldErrors?.reason }
      }}
    />
  )
}

/**
 * «Cerrar el ejercicio» (H.15, C.5.5): con la casilla de que la contadora ya
 * cargó los ajustes de cierre, y comparando el resultado con el que se ve.
 */
export function CloseFiscalYearButton({
  tenantSlug,
  fiscalYearId,
  label,
  resultCents,
  balanceSheetAccounts,
}: {
  tenantSlug: string
  fiscalYearId: string
  label: string
  resultCents: number
  balanceSheetAccounts: number
}) {
  const router = useRouter()
  const checkId = useId()
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await closeFiscalYear(tenantSlug, {
          fiscalYearId,
          expected: { resultCents, balanceSheetAccounts },
        })
        if (result.ok) {
          setOpen(false)
          toast.success(result.message)
          router.refresh()
          return
        }
        if (result.code === 'preview_stale') {
          setOpen(false)
          toast.message(
            'Cambió algo en el ejercicio mientras mirabas. Revisá el resultado y cerrá de nuevo.',
          )
          router.refresh()
          return
        }
        setError(result.message)
      } catch {
        setError(OFFLINE)
      }
    })
  }

  const resultText =
    resultCents > 0
      ? `ganancia de ${formatCents(resultCents)}`
      : resultCents < 0
        ? `pérdida de ${formatCents(-resultCents)}`
        : 'resultado cero'

  return (
    <div className="space-y-3">
      <div className="flex min-h-11 items-start gap-3">
        <Checkbox
          id={checkId}
          checked={ready}
          onCheckedChange={(v) => setReady(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor={checkId} className="text-sm font-normal leading-snug">
          La contadora ya cargó los ajustes de cierre (amortizaciones, existencias).
        </Label>
      </div>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return
          setOpen(next)
          if (!next) setError(null)
        }}
      >
        <Button
          type="button"
          className="h-11 gap-2 md:h-10"
          disabled={!ready}
          onClick={() => setOpen(true)}
        >
          <Lock className="size-4" aria-hidden />
          Cerrar el ejercicio
        </Button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrás el ejercicio {label}?</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              Se refunden los resultados ({resultText}), se cierra el patrimonio y se abre el
              ejercicio siguiente. Si hiciera falta, se deshace reabriendo el ejercicio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive text-pretty">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <Button type="button" disabled={pending} onClick={run} className={DESTRUCTIVE}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? 'Cerrando…' : 'Cerrar el ejercicio'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
