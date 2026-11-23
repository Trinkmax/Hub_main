'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useMemo, useRef, useState } from 'react'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
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
  employeeParts,
  monthWord,
  owedSentence,
  PAYROLL_KIND_LABELS,
  PAYROLL_KIND_OF_PURPOSE,
  PAYROLL_KIND_TITLES,
  PAYROLL_KINDS,
  type PayrollAccrualInput,
  type PayrollEmployee,
  type PayrollKind,
  type PayrollMovementInput,
  PERIOD_SHORTCUT_LABELS,
  PERIOD_SHORTCUTS,
  type PeriodShortcut,
  payrollAccrualValues,
  payrollBranchId,
  payrollMovementValues,
  pendingCashSums,
  periodOfShortcut,
  periodWords,
  personalPartyId,
  shortcutOfPeriod,
  suggestOffBooks,
} from '@/lib/accounting/payroll'
import {
  isPayrollPurpose,
  type PosCashPending,
  posCashDate,
  posCashTreasuryId,
} from '@/lib/accounting/pos-cash'
import { bankTaxOf, bpLabel } from '@/lib/accounting/taxes'
import { endOfMonth, formatDayMonth, formatIsoDay } from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'

/** La caja de la última vez: se propone en el próximo adelanto o pago. */
const LAST_TREASURY_KEY = 'hub_acc_sueldo_caja:'

/** Los campos que el diálogo dibuja: el resto del error va arriba de los botones. */
const KNOWN_FIELDS = new Set(['treasuryAccountId', 'amountCents', 'date', 'periodFrom', 'periodTo'])

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

/** Lo que dice el aviso después de guardar. */
const SAVED_WORDS: Readonly<Record<PayrollKind, string>> = {
  advance: 'Adelanto cargado',
  payment: 'Pago cargado',
  overtime: 'Horas extra cargadas',
}

/** De dónde viene lo que se está cargando: un retiro de la caja del salón que espera su comprobante. */
export type MovementSource = {
  posCash: PosCashPending
  /** «2 de 3»: cuando se pasan varios seguidos. */
  step?: { index: number; total: number } | null
}

/** Lo que se le debía antes de este retiro: la planilla ya lo descontó cuando salió de la caja. */
function balanceBefore(employee: PayrollEmployee, source: MovementSource | null): number {
  const balance = employeeBalanceCents(employee)
  if (!source) return balance
  const counted = employee.pendingCash?.find((item) => item.id === source.posCash.id)
  return counted && counted.purpose !== 'overtime' ? balance + counted.amountCents : balance
}

/** «Salió de la caja del salón el 22/11 · Cerro · lo anotó Luz.» */
function sourceSentence(posCash: PosCashPending): string {
  const parts = [
    `Salió de la caja del salón el ${formatDayMonth(posCash.date)}`,
    posCash.branchName,
    posCash.byName ? `lo anotó ${posCash.byName}` : null,
  ].filter((part): part is string => Boolean(part))
  return `${parts.join(' · ')}.`
}

/**
 * «Adelanto · Martina Ríos», «Pago de sueldo · …» u «Horas extra · …»: qué es, el importe (un pago
 * viene con el saldo), de dónde salió y la fecha; si fue en blanco o en negro y, si se quiere, qué
 * fechas cubre. La vista previa es la del motor y el envío es el de todos los comprobantes
 * (`usePosting`): avisos que hay que confirmar, una base que cambió mientras tanto y un reintento que
 * no duplica.
 *
 * Con `source` registra un retiro de la caja del salón: llega completo y, al guardar, ese retiro queda
 * atado al comprobante (deja de esperar).
 */
export function MovementDialog({
  kind: initialKind,
  employee,
  month,
  onClose,
  source = null,
  onSaved,
}: {
  kind: PayrollKind
  employee: PayrollEmployee
  month: string
  onClose: () => void
  source?: MovementSource | null
  /** Después de guardar (la bandeja pasa al que sigue). Sin esto, el diálogo se cierra. */
  onSaved?: () => void
}) {
  const { tenantSlug } = useAccounting()
  const load = useSheetLoad(() => loadCajasVentasCatalog(tenantSlug), tenantSlug)
  const [kind, setKind] = useState<PayrollKind>(initialKind)
  const balance = balanceBefore(employee, source)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {PAYROLL_KIND_TITLES[kind]} · {employee.name}
          </DialogTitle>
          <DialogDescription>
            {kind === 'overtime'
              ? `Se paga aparte del sueldo: no cambia lo que le debés de ${monthWord(month)}.`
              : owedSentence(balance, month)}
            {source ? (
              <span className="mt-1 block">
                {source.step && source.step.total > 1 ? (
                  <span className="font-medium text-foreground">
                    {source.step.index} de {source.step.total} ·{' '}
                  </span>
                ) : null}
                {sourceSentence(source.posCash)}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {load.data ? (
          <MovementForm
            kind={kind}
            onKindChange={setKind}
            employee={employee}
            month={month}
            balance={balance}
            source={source}
            catalog={load.data}
            onClose={onClose}
            onSaved={onSaved}
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

/** Una píldora que se prende y se apaga (las fechas que cubre son opcionales: se puede no elegir nada). */
function ToggleChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center rounded-full border px-3.5 text-xs font-medium transition-colors md:h-7 md:px-3',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border hover:bg-secondary',
      )}
    >
      {children}
    </button>
  )
}

function MovementForm({
  kind,
  onKindChange,
  employee,
  month,
  balance,
  source,
  catalog,
  onClose,
  onSaved,
}: {
  kind: PayrollKind
  onKindChange: (kind: PayrollKind) => void
  employee: PayrollEmployee
  month: string
  /** Lo que se le debe antes de este movimiento. */
  balance: number
  source: MovementSource | null
  catalog: CajasVentasCatalog
  onClose: () => void
  onSaved?: () => void
}) {
  const { tenantSlug } = useAccounting()
  const router = useRouter()
  const uid = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const undoToast = useUndoToast(tenantSlug)
  const { ctx, today } = catalog
  const posCash = source?.posCash ?? null
  const firstDay = firstLoadableDay(catalog)
  // Una tarjeta de la empresa no es una caja con plata: un sueldo no sale de ahí.
  const treasuries = useMemo(
    () => catalog.treasuries.filter((t) => t.kind !== 'credit_card'),
    [catalog.treasuries],
  )

  const defaultAmount = (next: PayrollKind) => (next === 'payment' && balance > 0 ? balance : null)
  const [amount, setAmount] = useState<number | null>(
    () => posCash?.amountCents ?? defaultAmount(kind),
  )
  // Lo que la persona escribió o eligió a mano no lo pisa el cambio de «qué es».
  const touched = useRef({ amount: posCash !== null, offBooks: false })
  const [treasuryId, setTreasuryId] = useState<string | null>(
    () =>
      // Un retiro de la caja del salón salió de la caja de efectivo de esa sucursal.
      (posCash ? posCashTreasuryId(treasuries, posCash.branchId) : null) ??
      pickTreasury({
        treasuries,
        myLastQuickExpense: rememberedTreasury(tenantSlug),
        order: treasuries.map((t) => t.id),
      }),
  )
  const [date, setDate] = useState<string | null>(() =>
    posCash ? posCashDate(posCash.date, { min: firstDay, max: today }) : today,
  )
  const [offBooks, setOffBooks] = useState(() => suggestOffBooks(employee, kind))
  const [period, setPeriod] = useState<{ from: string | null; to: string | null }>(() => ({
    from: posCash?.periodFrom ?? null,
    to: posCash?.periodTo ?? null,
  }))
  const shortcut = shortcutOfPeriod(month, period)
  const [customPeriod, setCustomPeriod] = useState(
    () => (period.from !== null || period.to !== null) && shortcut === null,
  )
  const [attempted, setAttempted] = useState(false)

  const treasury = treasuryId ? treasuries.find((t) => t.id === treasuryId) : undefined
  const branchId = payrollBranchId(treasury, employee)
  const parts = employeeParts(employee)
  // Cargando a mano algo que quizás ya salió de la caja del salón: se avisa, para no anotarlo dos veces.
  const alreadyOut = posCash
    ? 0
    : pendingCashSums(
        (employee.pendingCash ?? []).filter(
          (item) => PAYROLL_KIND_OF_PURPOSE[item.purpose] === kind,
        ),
      ).total

  const changeKind = (next: PayrollKind) => {
    onKindChange(next)
    if (!touched.current.amount) setAmount(defaultAmount(next))
    if (!touched.current.offBooks) setOffBooks(suggestOffBooks(employee, next))
    posting.clearFieldError('amountCents')
  }

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
          branchId,
        },
        ctx,
      ),
    [kind, employee.name, month, treasuryId, amount, date, ctx, branchId],
  )
  const preview = useDocumentPreview('cash_movement', values, ctx, catalog.firstOpenDate)

  const posting = usePosting<PayrollMovementInput>({
    tenantSlug,
    action: postPayrollMovement,
    formRef,
    isKnownField: (key) => KNOWN_FIELDS.has(key),
    onSaved: (saved) => {
      // La caja de un retiro del salón no la eligió la persona: no se recuerda como «la de siempre».
      if (treasuryId && !posCash) rememberTreasury(tenantSlug, treasuryId)
      undoToast(
        `${SAVED_WORDS[kind]}${amount !== null ? ` · ${moneyLabel(amount)}` : ''} · ${employee.name}`,
        saved,
      )
      router.refresh()
      if (onSaved) onSaved()
      else onClose()
    },
  })

  const periodError =
    period.from !== null && period.to !== null && period.to < period.from
      ? 'El «hasta» va después del «desde».'
      : null
  const localErrors = attempted && !preview.state.ok ? (preview.state.fieldErrors ?? {}) : {}
  const errorOf = (key: string): string | null =>
    posting.fieldErrors[key] ?? localErrors[key] ?? null
  // Lo que falla y no tiene un campo a la vista (el partícipe del sistema, un mes cerrado).
  const otherError =
    attempted && !preview.state.ok && Object.keys(localErrors).every((k) => !KNOWN_FIELDS.has(k))
      ? preview.state.message
      : null

  const settings = ctx.settings.taxSettings
  const bankTax =
    amount !== null && treasuryId ? bankTaxOf(amount, ctx.treasuries.get(treasuryId), settings) : 0

  const pickShortcut = (next: PeriodShortcut) => {
    setCustomPeriod(false)
    // Tocar el que está elegido lo saca: las fechas son opcionales.
    setPeriod(shortcut === next ? { from: null, to: null } : periodOfShortcut(month, next))
    posting.clearFieldError('periodTo')
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (posting.pending) return
    if (!preview.state.ok || periodError) {
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    posting.submit(
      {
        ...values,
        employeeId: employee.id,
        month,
        kind,
        offBooks,
        periodFrom: period.from,
        periodTo: period.to,
        posCashId: posCash?.id ?? null,
      },
      preview.state,
      preview.key,
    )
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="grid gap-4">
      <ChoiceChips<PayrollKind>
        size="sm"
        label="Qué es"
        value={kind}
        onChange={changeKind}
        options={PAYROLL_KINDS.map((value) => ({ value, label: PAYROLL_KIND_LABELS[value] }))}
      />
      {alreadyOut > 0 ? (
        <p className="rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2 text-xs text-pretty">
          Ya salieron {formatCentsShort(alreadyOut)} de la caja del salón para {employee.name} y la
          planilla los cuenta. Si es eso, pasalo desde «De la caja del salón» (arriba de la
          planilla) para no cargarlo dos veces.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <MoneyField
          label="Importe"
          required
          autoFocus={posCash === null}
          align="end"
          decimals="auto"
          value={amount}
          onValueChange={(cents) => {
            touched.current.amount = true
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
      {/* La fecha y la parte, una al lado de la otra: el diálogo entra en la pantalla de una notebook. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          label="Fecha"
          required
          value={date}
          onValueChange={(next) => {
            setDate(next)
            posting.clearFieldError('date')
          }}
          min={firstDay}
          max={today}
          today={today}
          error={errorOf('date')}
        />

        <div className="grid content-start gap-1.5">
          <span id={`${uid}-parte`} className="text-sm font-medium">
            ¿En blanco o en negro?
          </span>
          <ChoiceChips<'declared' | 'off_books'>
            size="sm"
            labelledBy={`${uid}-parte`}
            value={offBooks ? 'off_books' : 'declared'}
            onChange={(next) => {
              touched.current.offBooks = true
              setOffBooks(next === 'off_books')
            }}
            options={[
              { value: 'declared', label: 'En blanco' },
              { value: 'off_books', label: 'En negro' },
            ]}
          />
          {parts && kind !== 'overtime' ? (
            <p className="text-xs text-muted-foreground text-pretty">
              Le falta {formatCentsShort(parts.declared.owedCents)} en blanco y{' '}
              {formatCentsShort(parts.offBooks.owedCents)} en negro.
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-1.5">
        <span id={`${uid}-fechas`} className="text-sm font-medium">
          ¿Qué fechas cubre?{' '}
          <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
        </span>
        {/* biome-ignore lint/a11y/useSemanticElements: un grupo de píldoras que se prenden y se apagan; un fieldset le suma un borde y un margen que acá no van */}
        <div role="group" aria-labelledby={`${uid}-fechas`} className="flex flex-wrap gap-2">
          {PERIOD_SHORTCUTS.map((value) => (
            <ToggleChip
              key={value}
              pressed={!customPeriod && shortcut === value}
              onClick={() => pickShortcut(value)}
            >
              {PERIOD_SHORTCUT_LABELS[value]}
            </ToggleChip>
          ))}
          <ToggleChip
            pressed={customPeriod}
            onClick={() => {
              if (customPeriod) setPeriod({ from: null, to: null })
              setCustomPeriod((open) => !open)
              posting.clearFieldError('periodTo')
            }}
          >
            Otras fechas
          </ToggleChip>
        </div>
        {customPeriod ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField
              label="Desde"
              value={period.from}
              onValueChange={(next) => {
                setPeriod((prev) => ({ ...prev, from: next }))
                posting.clearFieldError('periodFrom')
              }}
              today={today}
              error={errorOf('periodFrom')}
            />
            <DateField
              label="Hasta"
              value={period.to}
              onValueChange={(next) => {
                setPeriod((prev) => ({ ...prev, to: next }))
                posting.clearFieldError('periodTo')
              }}
              today={today}
              error={errorOf('periodTo') ?? periodError}
            />
          </div>
        ) : periodWords(period.from, period.to) ? (
          <p className="text-xs text-muted-foreground">
            Cubre {periodWords(period.from, period.to)}.
          </p>
        ) : null}
      </div>

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
          {source?.step && source.step.total > 1 ? 'Dejar para después' : 'Cancelar'}
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

/** El movimiento de Sueldos que le toca a un retiro de la caja (un proveedor no es de acá). */
export function kindOfPosCash(posCash: PosCashPending): PayrollKind {
  return isPayrollPurpose(posCash.purpose) ? PAYROLL_KIND_OF_PURPOSE[posCash.purpose] : 'advance'
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
