'use client'

import { CircleAlert, CircleCheck, Plus, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useMemo, useRef, useState } from 'react'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { FormBanner, WarningsDialog } from '@/components/administracion/cajas-ventas/feedback'
import { describedBy, Field } from '@/components/administracion/cajas-ventas/field'
import { handleFormKeyDown } from '@/components/administracion/cajas-ventas/form-keys'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import { useDocumentPreview } from '@/components/administracion/cajas-ventas/sheet-frame'
import { usePosting, useUndoToast } from '@/components/administracion/cajas-ventas/use-posting'
import { DateField } from '@/components/administracion/date-input'
import { EntryPreview } from '@/components/administracion/entry-preview'
import { MoneyField, MoneyInput } from '@/components/administracion/money-input'
import { type TreasuryOption, TreasurySelect } from '@/components/administracion/treasury-select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { postBankExpense } from '@/lib/accounting/actions/documents'
import { vatFromNet } from '@/lib/accounting/iva'
import { splitBankTax } from '@/lib/accounting/posting/treasury'
import { vatRateLabel } from '@/lib/accounting/queries/labels'
import type { BankExpenseValues } from '@/lib/accounting/server/document-types'
import type { PostingContext, VatRateBp } from '@/lib/accounting/types'
import { isImputationAccount } from '@/lib/accounting/validate'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'

export type BankTreasury = TreasuryOption & {
  /** El banco tiene su partícipe con CUIT: el IVA puede ir al Libro IVA compras. */
  bankHasCuit: boolean
}

type VoucherType = 'resumen_bancario' | 'factura_a' | 'otro_comprobante'
type OtherRow = { key: number; accountId: string | null; amount: number | null }

const FEE_RATES: readonly VatRateBp[] = [2100, 1050, 2700]

const VOUCHER_TYPES: ReadonlyArray<{ value: VoucherType; label: string }> = [
  { value: 'resumen_bancario', label: 'Resumen bancario' },
  { value: 'factura_a', label: 'Factura A' },
  { value: 'otro_comprobante', label: 'Otro comprobante' },
]

const KNOWN_FIELDS = new Set([
  'treasuryAccountId',
  'date',
  'includeInIvaBook',
  'voucher',
  'voucher.voucherType',
  'voucher.pointOfSale',
  'voucher.number',
  'feesNetCents',
  'vatRateBp',
  'vatPerceptionCents',
  'feesNoVatCents',
  'ley25413CreditCents',
  'ley25413DebitCents',
  'sircrebCents',
  'interestCents',
  'notes',
])

/**
 * Gasto bancario o impuesto debitado (H.11, E.5.11): lo que el banco, la
 * billetera o la tarjeta debitaron solos, por concepto, con la parte de la
 * Ley 25.413 que se computa en Ganancias calculada a la vista. Todo sale de
 * la cuenta elegida.
 */
export function BankExpenseForm({
  tenantSlug,
  ctx,
  firstOpenDate,
  minDate,
  today,
  treasuries,
  accounts,
  prefill,
}: {
  tenantSlug: string
  ctx: PostingContext
  firstOpenDate: string | null
  minDate: string
  today: string
  treasuries: BankTreasury[]
  accounts: AccountOption[]
  prefill: { treasuryId: string | null; date: string | null; totalCents: number | null }
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const id = useId()
  const base = `/${tenantSlug}/administracion`
  const settings = ctx.settings

  const [treasuryId, setTreasuryId] = useState<string | null>(
    prefill.treasuryId ?? (treasuries.length === 1 ? (treasuries[0]?.id ?? null) : null),
  )
  const [date, setDate] = useState<string | null>(prefill.date ?? today)
  const [feesNet, setFeesNet] = useState<number | null>(null)
  const [vatRate, setVatRate] = useState<VatRateBp>(2100)
  const [vatPerception, setVatPerception] = useState<number | null>(null)
  const [feesNoVat, setFeesNoVat] = useState<number | null>(null)
  const [leyCredit, setLeyCredit] = useState<number | null>(null)
  const [leyDebit, setLeyDebit] = useState<number | null>(null)
  const [sircreb, setSircreb] = useState<number | null>(null)
  const [interest, setInterest] = useState<number | null>(null)
  const [others, setOthers] = useState<OtherRow[]>([])
  const [control, setControl] = useState<number | null>(prefill.totalCents)
  const [inBook, setInBook] = useState(false)
  const [voucherType, setVoucherType] = useState<VoucherType>('resumen_bancario')
  const [voucherPos, setVoucherPos] = useState('')
  const [voucherNumber, setVoucherNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [attempted, setAttempted] = useState(false)
  const nextKey = useRef(1)

  const treasury = treasuries.find((t) => t.id === treasuryId)
  // «Otro» concepto: una cuenta de imputación (C.3.4), como en las compras.
  const imputable = useMemo(() => {
    const ids = new Set<string>()
    for (const a of ctx.accounts.values()) if (isImputationAccount(a)) ids.add(a.id)
    return ids
  }, [ctx.accounts])

  // Con el IVA al libro, el resumen bancario va al 21 % (lo que concilia la base).
  const rate: VatRateBp = inBook ? 2100 : vatRate
  const vat = feesNet !== null && feesNet > 0 && rate !== 0 ? vatFromNet(feesNet, rate) : 0
  const leyCreditSplit = splitBankTax(leyCredit ?? 0, settings.bankTaxCreditComputableBp)
  const leyDebitSplit = splitBankTax(leyDebit ?? 0, settings.bankTaxDebitComputableBp)
  const total =
    (feesNet ?? 0) +
    vat +
    (vatPerception ?? 0) +
    (feesNoVat ?? 0) +
    (leyCredit ?? 0) +
    (leyDebit ?? 0) +
    (sircreb ?? 0) +
    (interest ?? 0) +
    others.reduce((acc, o) => acc + (o.amount ?? 0), 0)
  const controlDiff = control !== null ? control - total : null
  const canBook = Boolean(treasury?.bankHasCuit)

  const values = useMemo(() => {
    const pos = voucherPos.trim() === '' ? null : Number(voucherPos)
    const number = voucherNumber.trim() === '' ? null : Number(voucherNumber)
    return {
      treasuryAccountId: treasuryId ?? '',
      date: date ?? '',
      includeInIvaBook: inBook,
      voucher: inBook ? { voucherType, pointOfSale: pos, number } : null,
      feesNetCents: feesNet ?? 0,
      vatRateBp: rate,
      vatAdjustCents: 0,
      vatPerceptionCents: vatPerception ?? 0,
      feesNoVatCents: feesNoVat ?? 0,
      ley25413CreditCents: leyCredit ?? 0,
      ley25413DebitCents: leyDebit ?? 0,
      sircrebCents: sircreb ?? 0,
      interestCents: interest ?? 0,
      others: others
        .filter((o) => o.accountId !== null || o.amount !== null)
        .map((o) => ({ accountId: o.accountId ?? '', amountCents: o.amount })),
      notes: notes.trim() === '' ? null : notes.trim(),
    }
  }, [
    treasuryId,
    date,
    inBook,
    voucherType,
    voucherPos,
    voucherNumber,
    feesNet,
    rate,
    vatPerception,
    feesNoVat,
    leyCredit,
    leyDebit,
    sircreb,
    interest,
    others,
    notes,
  ])
  const preview = useDocumentPreview('bank_expense', values, ctx, firstOpenDate)

  const undoToast = useUndoToast(tenantSlug)
  const posting = usePosting<BankExpenseValues>({
    tenantSlug,
    action: postBankExpense,
    formRef,
    isKnownField: (key) => KNOWN_FIELDS.has(key) || key.startsWith('others.'),
    onSaved: (saved) => {
      undoToast(saved.message, saved)
      router.push(treasuryId ? `${base}/cajas/${treasuryId}` : `${base}/cajas`)
    },
  })

  const localErrors = attempted && !preview.state.ok ? (preview.state.fieldErrors ?? {}) : {}
  const errorOf = (key: string): string | null =>
    posting.fieldErrors[key] ?? localErrors[key] ?? null
  const controlError =
    attempted && controlDiff !== null && controlDiff !== 0
      ? 'No coincide con el total del resumen: revisá los importes (o borrá el total para guardar igual).'
      : null

  const shown = posting.overrideFor(preview.key) ?? (preview.state.ok ? preview.state.preview : [])

  function money(
    label: string,
    value: number | null,
    set: (cents: number | null) => void,
    field: string,
    hint?: string,
  ) {
    return (
      <MoneyField
        label={label}
        optional
        value={value}
        onValueChange={(cents) => {
          set(cents)
          posting.clearFieldError(field)
        }}
        error={errorOf(field)}
        hint={hint}
      />
    )
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)
    if (!preview.state.ok || controlError) {
      posting.setBanner({ tone: 'error', message: 'Revisá lo marcado en rojo.' })
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    posting.submit(values, preview.state, preview.key)
  }

  return (
    <>
      <form
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        onKeyDown={handleFormKeyDown}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start"
      >
        <div className="space-y-6">
          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id={`${id}-caja`}
                label="Banco o cuenta"
                required
                error={errorOf('treasuryAccountId')}
              >
                <TreasurySelect
                  id={`${id}-caja`}
                  value={treasuryId}
                  onValueChange={(next) => {
                    setTreasuryId(next)
                    posting.clearFieldError('treasuryAccountId')
                    if (!treasuries.find((t) => t.id === next)?.bankHasCuit) setInBook(false)
                  }}
                  treasuries={treasuries}
                  placeholder="Elegí el banco o la cuenta"
                  invalid={Boolean(errorOf('treasuryAccountId'))}
                  aria-describedby={describedBy(`${id}-caja`, {
                    error: errorOf('treasuryAccountId'),
                  })}
                />
              </Field>
              <DateField
                label="Fecha"
                required
                value={date}
                onValueChange={(next) => {
                  setDate(next)
                  posting.clearFieldError('date')
                }}
                min={minDate}
                max={today}
                today={today}
                error={errorOf('date')}
              />
            </div>
          </div>

          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
            <div>
              <h2 className="font-serif text-lg font-semibold tracking-tight">Lo que debitó</h2>
              <p className="text-xs text-muted-foreground">
                Copiá cada concepto del resumen. Lo que no tuvo, dejalo vacío.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid content-start gap-2">
                {money(
                  'Comisiones y mantenimiento (sin IVA)',
                  feesNet,
                  setFeesNet,
                  'feesNetCents',
                  feesNet !== null && feesNet > 0
                    ? `IVA ${vatRateLabel(rate)}: ${formatCents(vat)}`
                    : 'Lo que cobra el banco, antes del IVA.',
                )}
                <div className="grid gap-1.5">
                  <Label
                    htmlFor={`${id}-rate`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Alícuota de IVA de las comisiones
                  </Label>
                  <Select
                    value={String(rate)}
                    onValueChange={(v) => setVatRate(Number(v) as VatRateBp)}
                    disabled={inBook}
                  >
                    <SelectTrigger
                      id={`${id}-rate`}
                      className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FEE_RATES.map((r) => (
                        <SelectItem key={r} value={String(r)} className="min-h-11 md:min-h-8">
                          {vatRateLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {money('Percepción de IVA', vatPerception, setVatPerception, 'vatPerceptionCents')}
              {money('Comisiones sin IVA', feesNoVat, setFeesNoVat, 'feesNoVatCents')}
              {money('SIRCREB (Ingresos Brutos)', sircreb, setSircreb, 'sircrebCents')}
              {money(
                'Impuesto a los créditos (Ley 25.413)',
                leyCredit,
                setLeyCredit,
                'ley25413CreditCents',
                leyCredit !== null && leyCredit > 0
                  ? `${vatRateLabel(settings.bankTaxCreditComputableBp)} computable en Ganancias: ${formatCents(leyCreditSplit.computable)}`
                  : undefined,
              )}
              {money(
                'Impuesto a los débitos (Ley 25.413)',
                leyDebit,
                setLeyDebit,
                'ley25413DebitCents',
                leyDebit !== null && leyDebit > 0
                  ? `${vatRateLabel(settings.bankTaxDebitComputableBp)} computable en Ganancias: ${formatCents(leyDebitSplit.computable)}`
                  : undefined,
              )}
              {money('Intereses', interest, setInterest, 'interestCents')}
            </div>

            {others.length > 0 ? (
              <div className="grid gap-3">
                <p className="text-sm font-medium leading-none">Otros conceptos</p>
                {others.map((row, index) => (
                  <div
                    key={row.key}
                    className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-start"
                  >
                    <AccountCombobox
                      value={row.accountId}
                      onValueChange={(next) => {
                        setOthers((prev) =>
                          prev.map((o) => (o.key === row.key ? { ...o, accountId: next } : o)),
                        )
                        posting.clearFieldError(`others.${index}.accountId`)
                      }}
                      accounts={accounts}
                      filter={(a) => imputable.has(a.id)}
                      placeholder="¿Qué concepto es?"
                      aria-label={`Cuenta del concepto ${index + 1}`}
                      invalid={Boolean(errorOf(`others.${index}.accountId`))}
                    />
                    <MoneyInput
                      value={row.amount}
                      onValueChange={(cents) => {
                        setOthers((prev) =>
                          prev.map((o) => (o.key === row.key ? { ...o, amount: cents } : o)),
                        )
                        posting.clearFieldError(`others.${index}.amountCents`)
                      }}
                      align="end"
                      aria-label={`Importe del concepto ${index + 1}`}
                      invalid={Boolean(errorOf(`others.${index}.amountCents`))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 justify-self-end text-muted-foreground md:size-9"
                      aria-label={`Quitar el concepto ${index + 1}`}
                      onClick={() => setOthers((prev) => prev.filter((o) => o.key !== row.key))}
                    >
                      <X className="size-4" />
                    </Button>
                    {(errorOf(`others.${index}.accountId`) ??
                    errorOf(`others.${index}.amountCents`)) ? (
                      <p role="alert" className="text-xs text-destructive sm:col-span-3">
                        {errorOf(`others.${index}.accountId`) ??
                          errorOf(`others.${index}.amountCents`)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {others.length < 10 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 w-fit gap-1.5 md:h-8"
                onClick={() => {
                  const key = nextKey.current
                  nextKey.current += 1
                  setOthers((prev) => [...prev, { key, accountId: null, amount: null }])
                }}
              >
                <Plus className="size-4" aria-hidden />
                Agregar otro concepto
              </Button>
            ) : null}

            <div className="grid gap-3 border-t border-border/60 pt-5 sm:grid-cols-2 sm:items-start">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Total debitado
                </p>
                <p className="font-serif text-2xl font-semibold tracking-tight tabular-nums">
                  {formatCents(total)}
                </p>
              </div>
              <MoneyField
                label="Total según el resumen"
                optional
                value={control}
                onValueChange={setControl}
                hint="Para controlar que cargaste todo."
                error={controlError}
              >
                {controlDiff !== null ? (
                  controlDiff === 0 ? (
                    <p
                      role="status"
                      className="flex items-center gap-1.5 text-xs font-medium text-success"
                    >
                      <CircleCheck className="size-3.5" aria-hidden />
                      Coincide con lo cargado.
                    </p>
                  ) : (
                    <p
                      role="status"
                      className="flex items-center gap-1.5 text-xs font-medium text-warning-text"
                    >
                      <CircleAlert className="size-3.5" aria-hidden />
                      {controlDiff > 0
                        ? `Faltan ${formatCents(controlDiff)} para llegar al total.`
                        : `Cargaste ${formatCents(-controlDiff)} de más.`}
                    </p>
                  )
                ) : null}
              </MoneyField>
            </div>
          </div>

          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
            <div className="flex items-start gap-3">
              <Checkbox
                id={`${id}-book`}
                checked={inBook}
                disabled={!canBook || (feesNet ?? 0) <= 0}
                onCheckedChange={(value) => {
                  setInBook(value === true)
                  posting.clearFieldError('voucher')
                }}
                className="mt-0.5"
              />
              <div className="grid gap-1">
                <Label htmlFor={`${id}-book`}>Incluir el IVA en el Libro IVA compras</Label>
                <p className="text-xs text-muted-foreground">
                  {!treasury
                    ? 'Elegí el banco primero.'
                    : !canBook
                      ? 'Completá el CUIT del banco en Ajustes › Partícipes para que entre al libro.'
                      : (feesNet ?? 0) <= 0
                        ? 'Solo si hay comisiones con IVA.'
                        : 'Con el comprobante del banco, el IVA de las comisiones es crédito fiscal.'}
                </p>
              </div>
            </div>
            {inBook ? (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem]">
                <Field
                  id={`${id}-vtype`}
                  label="Comprobante"
                  error={errorOf('voucher.voucherType')}
                >
                  <Select
                    value={voucherType}
                    onValueChange={(v) => setVoucherType(v as VoucherType)}
                  >
                    <SelectTrigger
                      id={`${id}-vtype`}
                      className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VOUCHER_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value} className="min-h-11 md:min-h-8">
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  id={`${id}-vpos`}
                  label="Punto de venta"
                  required
                  error={errorOf('voucher.pointOfSale') ?? errorOf('voucher')}
                >
                  <Input
                    id={`${id}-vpos`}
                    value={voucherPos}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={5}
                    className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                    aria-invalid={errorOf('voucher.pointOfSale') ? true : undefined}
                    onChange={(e) => setVoucherPos(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
                <Field id={`${id}-vnum`} label="Número" required error={errorOf('voucher.number')}>
                  <Input
                    id={`${id}-vnum`}
                    value={voucherNumber}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={8}
                    className="h-11 text-base tabular-nums md:h-10 md:text-sm"
                    aria-invalid={errorOf('voucher.number') ? true : undefined}
                    onChange={(e) => setVoucherNumber(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
              </div>
            ) : null}
            <Field id={`${id}-notes`} label="Nota" optional error={errorOf('notes')}>
              <Textarea
                id={`${id}-notes`}
                value={notes}
                rows={2}
                maxLength={1000}
                placeholder="Por ejemplo: resumen de octubre."
                className="text-base md:text-sm"
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>

          <FormBanner banner={posting.banner} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href={`${base}/cajas`}>Cancelar</Link>
            </Button>
            <Button
              type="submit"
              className={cn('h-11 md:h-9', 'min-w-[200px]')}
              disabled={posting.pending}
            >
              {posting.pending
                ? 'Guardando…'
                : total > 0
                  ? `Guardar gasto bancario · ${moneyLabel(total)}`
                  : 'Guardar gasto bancario'}
            </Button>
          </div>
        </div>

        <aside className="lg:sticky lg:top-20">
          <EntryPreview entries={shown} />
        </aside>
      </form>
      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onCancel={posting.dismissWarnings}
        onConfirm={() => posting.confirmWarnings()}
      />
    </>
  )
}
