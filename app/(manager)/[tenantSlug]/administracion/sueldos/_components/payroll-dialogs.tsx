'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useMemo, useRef, useState } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { loadCajasVentasCatalog } from '@/components/administracion/cajas-ventas/data'
import {
  FormBanner,
  SheetBodySkeleton,
  SheetLoadError,
  WarningsDialog,
} from '@/components/administracion/cajas-ventas/feedback'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import {
  firstLoadableDay,
  useDocumentPreview,
} from '@/components/administracion/cajas-ventas/sheet-frame'
import type { CajasVentasCatalog } from '@/components/administracion/cajas-ventas/types'
import { usePosting, useUndoToast } from '@/components/administracion/cajas-ventas/use-posting'
import { useSheetLoad } from '@/components/administracion/cajas-ventas/use-sheet-load'
import { DateField } from '@/components/administracion/date-input'
import { MoneyField } from '@/components/administracion/money-input'
import { TreasurySelect } from '@/components/administracion/treasury-select'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { postPayrollAccrual, postPayrollMovement } from '@/lib/accounting/actions/payroll'
import { pickTreasury } from '@/lib/accounting/defaults'
import {
  employeeBalanceCents,
  monthWord,
  owedSentence,
  type PayrollAccrualInput,
  type PayrollEmployee,
  type PayrollKind,
  type PayrollMovementInput,
  payrollAccrualValues,
  payrollMovementValues,
  personalPartyId,
} from '@/lib/accounting/payroll'
import { bankTaxOf, bpLabel } from '@/lib/accounting/taxes'
import { endOfMonth, formatIsoDay } from '@/lib/dates'
import { formatCents } from '@/lib/money'

/** La caja de la última vez: se propone en el próximo adelanto o pago. */
const LAST_TREASURY_KEY = 'hub_acc_sueldo_caja:'

/** Los campos que el diálogo dibuja: el resto del error va arriba de los botones. */
const KNOWN_FIELDS = new Set(['treasuryAccountId', 'amountCents', 'date'])

function rememberedTreasury(slug: string): string | null {
  try {
    return window.localStorage.getItem(`${LAST_TREASURY_KEY}${slug}`)
  } catch {
    return null
  }
}

function rememberTreasury(slug: string, id: string): void {
  try {
    window.localStorage.setItem(`${LAST_TREASURY_KEY}${slug}`, id)
  } catch {
    // Sin almacenamiento (modo privado): la próxima vez se propone la caja.
  }
}

/**
 * «Adelanto · Martina Ríos» o «Pagar sueldo · Martina Ríos»: Importe (Pagar viene con el saldo),
 * Salió de y la fecha, con el impuesto al cheque si corresponde. La vista previa es la del motor y el
 * envío es el de todos los comprobantes (`usePosting`): avisos que hay que confirmar, una base que
 * cambió mientras tanto y un reintento que no duplica.
 */
export function MovementDialog({
  kind,
  employee,
  month,
  onClose,
}: {
  kind: PayrollKind
  employee: PayrollEmployee
  month: string
  onClose: () => void
}) {
  const { tenantSlug } = useAccounting()
  const load = useSheetLoad(() => loadCajasVentasCatalog(tenantSlug), tenantSlug)
  const balance = employeeBalanceCents(employee)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {kind === 'advance' ? 'Adelanto' : 'Pagar sueldo'} · {employee.name}
          </DialogTitle>
          <DialogDescription>{owedSentence(balance, month)}</DialogDescription>
        </DialogHeader>
        {load.data ? (
          <MovementForm
            kind={kind}
            employee={employee}
            month={month}
            catalog={load.data}
            onClose={onClose}
          />
        ) : load.status === 'error' ? (
          <SheetLoadError message={load.message} onRetry={() => load.reload()} />
        ) : (
          <SheetBodySkeleton />
        )}
      </DialogContent>
    </Dialog>
  )
}

function MovementForm({
  kind,
  employee,
  month,
  catalog,
  onClose,
}: {
  kind: PayrollKind
  employee: PayrollEmployee
  month: string
  catalog: CajasVentasCatalog
  onClose: () => void
}) {
  const { tenantSlug } = useAccounting()
  const router = useRouter()
  const uid = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const undoToast = useUndoToast(tenantSlug)
  const { ctx, today } = catalog
  const balance = employeeBalanceCents(employee)
  // Una tarjeta de la empresa no es una caja con plata: un sueldo no sale de ahí.
  const treasuries = useMemo(
    () => catalog.treasuries.filter((t) => t.kind !== 'credit_card'),
    [catalog.treasuries],
  )

  const [amount, setAmount] = useState<number | null>(
    kind === 'payment' && balance > 0 ? balance : null,
  )
  const [treasuryId, setTreasuryId] = useState<string | null>(() =>
    pickTreasury({
      treasuries,
      myLastQuickExpense: rememberedTreasury(tenantSlug),
      order: treasuries.map((t) => t.id),
    }),
  )
  const [date, setDate] = useState<string | null>(today)
  const [attempted, setAttempted] = useState(false)

  const values = useMemo(
    () =>
      payrollMovementValues(
        {
          kind,
          employeeName: employee.name,
          month,
          treasuryAccountId: treasuryId,
          amountCents: amount,
          date,
          personalPartyId: personalPartyId(ctx),
        },
        ctx,
      ),
    [kind, employee.name, month, treasuryId, amount, date, ctx],
  )
  const preview = useDocumentPreview('cash_movement', values, ctx, catalog.firstOpenDate)

  const label = kind === 'advance' ? 'Adelanto' : 'Pago'
  const posting = usePosting<PayrollMovementInput>({
    tenantSlug,
    action: postPayrollMovement,
    formRef,
    isKnownField: (key) => KNOWN_FIELDS.has(key),
    onSaved: (saved) => {
      if (treasuryId) rememberTreasury(tenantSlug, treasuryId)
      onClose()
      undoToast(
        `${label} cargado${amount !== null ? ` · ${moneyLabel(amount)}` : ''} · ${employee.name}`,
        saved,
      )
      router.refresh()
    },
  })

  const localErrors = attempted && !preview.state.ok ? (preview.state.fieldErrors ?? {}) : {}
  const errorOf = (key: string): string | null =>
    posting.fieldErrors[key] ?? localErrors[key] ?? null
  // Lo que falla y no tiene un campo a la vista (el partícipe del sistema, un mes cerrado).
  const otherError =
    attempted && !preview.state.ok && Object.keys(localErrors).every((k) => !KNOWN_FIELDS.has(k))
      ? preview.state.message
      : null

  const settings = ctx.settings.taxSettings
  const treasury = treasuryId ? ctx.treasuries.get(treasuryId) : undefined
  const bankTax = amount !== null ? bankTaxOf(amount, treasury, settings) : 0

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (posting.pending) return
    if (!preview.state.ok) {
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    posting.submit({ ...values, employeeId: employee.id, month, kind }, preview.state, preview.key)
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <MoneyField
          label="Importe"
          required
          autoFocus
          align="end"
          decimals="auto"
          value={amount}
          onValueChange={(cents) => {
            setAmount(cents)
            posting.clearFieldError('amountCents')
          }}
          error={errorOf('amountCents')}
        />
        <div className="grid min-w-0 content-start gap-1.5">
          <Label htmlFor={`${uid}-caja`}>
            Salió de
            <span aria-hidden="true" className="ml-0.5 text-destructive">
              *
            </span>
          </Label>
          <TreasurySelect
            id={`${uid}-caja`}
            value={treasuryId}
            onValueChange={(next) => {
              setTreasuryId(next)
              posting.clearFieldError('treasuryAccountId')
            }}
            treasuries={treasuries}
            invalid={Boolean(errorOf('treasuryAccountId'))}
          />
          {errorOf('treasuryAccountId') ? (
            <p role="alert" className="text-xs text-destructive">
              {errorOf('treasuryAccountId')}
            </p>
          ) : null}
        </div>
      </div>
      <DateField
        label="Fecha"
        required
        value={date}
        onValueChange={(next) => {
          setDate(next)
          posting.clearFieldError('date')
        }}
        min={firstLoadableDay(catalog)}
        max={today}
        today={today}
        error={errorOf('date')}
      />
      {settings && bankTax > 0 ? (
        <p className="text-sm text-muted-foreground">
          Impuesto al cheque {bpLabel(settings.bankTaxBp)}:{' '}
          <span className="font-medium text-foreground tabular-nums">{formatCents(bankTax)}</span>,
          se anota solo.
        </p>
      ) : null}
      {otherError ? <FormBanner banner={{ tone: 'error', message: otherError }} /> : null}
      <FormBanner banner={posting.banner} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:h-9"
          disabled={posting.pending}
          onClick={onClose}
        >
          Cancelar
        </Button>
        <Button type="submit" className="h-11 sm:h-9" disabled={posting.pending}>
          {posting.pending
            ? 'Guardando…'
            : amount !== null && amount > 0
              ? `Cargar · ${moneyLabel(amount)}`
              : 'Cargar'}
        </Button>
      </div>
      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onCancel={posting.dismissWarnings}
        onConfirm={() => posting.confirmWarnings()}
      />
    </form>
  )
}

/**
 * «Devengar <mes>»: el asiento del mes, confirmado en un `AlertDialog` porque deja fijos los sueldos.
 * D Sueldos y jornales / H Sueldos a pagar [Personal], con fecha del último día del mes.
 */
export function AccrualDialog({
  month,
  totalCents,
  onClose,
}: {
  month: string
  totalCents: number
  onClose: () => void
}) {
  const { tenantSlug } = useAccounting()
  const load = useSheetLoad(() => loadCajasVentasCatalog(tenantSlug), tenantSlug)
  const mes = monthWord(month)
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Devengás {mes}?</AlertDialogTitle>
          <AlertDialogDescription>
            Queda un asiento con fecha {formatIsoDay(endOfMonth(month))}: Sueldos y jornales contra
            Sueldos a pagar, por {moneyLabel(totalCents)}. Los sueldos de {mes} quedan fijos. Si la
            contadora ya los cargó en Libros, no lo hagas de nuevo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {load.data ? (
          <AccrualConfirm
            month={month}
            totalCents={totalCents}
            catalog={load.data}
            onClose={onClose}
          />
        ) : (
          <>
            {load.status === 'error' ? (
              <SheetLoadError message={load.message} onRetry={() => load.reload()} />
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction disabled>Devengar · {moneyLabel(totalCents)}</AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function AccrualConfirm({
  month,
  totalCents,
  catalog,
  onClose,
}: {
  month: string
  totalCents: number
  catalog: CajasVentasCatalog
  onClose: () => void
}) {
  const { tenantSlug } = useAccounting()
  const router = useRouter()
  const undoToast = useUndoToast(tenantSlug)
  const { ctx } = catalog
  const mes = monthWord(month)
  const partyId = personalPartyId(ctx)

  const values = useMemo(
    () => payrollAccrualValues({ month, totalCents, personalPartyId: partyId ?? '' }, ctx),
    [month, totalCents, partyId, ctx],
  )
  const preview = useDocumentPreview('manual_entry', values, ctx, catalog.firstOpenDate)
  const posting = usePosting<PayrollAccrualInput>({
    tenantSlug,
    action: postPayrollAccrual,
    onSaved: (saved) => {
      onClose()
      undoToast(`Sueldos de ${mes} devengados · ${moneyLabel(totalCents)}`, saved)
      router.refresh()
    },
  })

  const problem = preview.state.ok ? null : preview.state.message

  return (
    <>
      {problem ? <FormBanner banner={{ tone: 'error', message: problem }} /> : null}
      <FormBanner banner={posting.banner} />
      <AlertDialogFooter>
        <AlertDialogCancel disabled={posting.pending}>Cancelar</AlertDialogCancel>
        <AlertDialogAction
          disabled={posting.pending || problem !== null}
          onClick={(event) => {
            // El diálogo se cierra cuando el asiento quedó guardado, no antes.
            event.preventDefault()
            if (!preview.state.ok) return
            posting.submit({ ...values, month }, preview.state, preview.key)
          }}
        >
          {posting.pending ? 'Guardando…' : `Devengar · ${moneyLabel(totalCents)}`}
        </AlertDialogAction>
      </AlertDialogFooter>
      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onCancel={posting.dismissWarnings}
        onConfirm={() => posting.confirmWarnings()}
      />
    </>
  )
}
