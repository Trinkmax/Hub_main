'use client'

import { ArrowRight, ChevronDown, CircleCheck, Plus, ReceiptText, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useId, useMemo, useRef, useState } from 'react'
import {
  ADD_LINK,
  BIG_MONEY_FIELD,
  TEXT_LINK,
} from '@/components/administracion/acciones/sheet-parts'
import { AccountCombobox, type AccountOption } from '@/components/administracion/account-combobox'
import { ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { FormBanner, WarningsDialog } from '@/components/administracion/cajas-ventas/feedback'
import { describedBy, Field } from '@/components/administracion/cajas-ventas/field'
import { handleFormKeyDown } from '@/components/administracion/cajas-ventas/form-keys'
import { moneyLabel } from '@/components/administracion/cajas-ventas/money'
import { useDocumentPreview } from '@/components/administracion/cajas-ventas/sheet-frame'
import { usePosting, useUndoToast } from '@/components/administracion/cajas-ventas/use-posting'
import { Meter } from '@/components/administracion/charts/meter'
import { DateField } from '@/components/administracion/date-input'
import { EntryPreview } from '@/components/administracion/entry-preview'
import {
  ChoiceCard,
  StatusPill,
  StepCard,
  type StepState,
  Term,
} from '@/components/administracion/kit'
import { MoneyField, MoneyInput } from '@/components/administracion/money-input'
import { TreasuryPicker } from '@/components/administracion/treasury-picker'
import type { TreasuryOption } from '@/components/administracion/treasury-select'
import { voucherStamp } from '@/components/administracion/voucher-stamp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { postBankExpense } from '@/lib/accounting/actions/documents'
import { vatFromNet } from '@/lib/accounting/iva'
import { splitBankTax } from '@/lib/accounting/posting/treasury'
import { vatRateLabel } from '@/lib/accounting/queries/labels'
import type { BankExpenseValues } from '@/lib/accounting/server/document-types'
import type { PostingContext, VatRateBp } from '@/lib/accounting/types'
import { isImputationAccount } from '@/lib/accounting/validate'
import { formatDayMonth } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  BANK_KNOWN_FIELDS,
  BANK_OTHERS_MAX,
  BANK_ROWS,
  type BankAmountField,
  type BankRow,
  bankProgress,
  bankStatementNote,
  bookBlock,
} from '../_lib/bank-rows'
import { BankStatement, type BankStatementRow } from './bank-statement'

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

const EMPTY = '—'

/**
 * Gastos del banco (H.11, E.5.11): lo que el banco, la billetera o la tarjeta
 * se cobraron solos, copiado del resumen. Mismo idioma que el cierre del día:
 * cuatro secciones numeradas, todas a la vista, que se van tildando solas, y al
 * costado el resumen que se arma (en el celular, detrás de «Ver resumen»).
 *
 * 1. De qué cuenta y cuándo.
 * 2. Cuánto te debitaron en total (el control contra el resumen: guía la carga
 *    en vez de aparecer al final).
 * 3. Repartirlo por concepto, con el nombre en criollo y, debajo, cómo figura.
 * 4. Si tenés el comprobante del banco (ahí se recupera el IVA de las
 *    comisiones) o no.
 *
 * Lo que se guarda es lo de siempre: los mismos ocho importes, el mismo
 * comprobante y la misma regla (con el comprobante, el IVA va al 21 %).
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
  // Solo la hoja de contar la caja manda el total en la URL: vino de ahí.
  const fromCount = prefill.totalCents !== null

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
  // Solo de la vista: lo que está plegado y la hoja del resumen en el celular.
  const [rateOpen, setRateOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [statementOpen, setStatementOpen] = useState(false)

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
  const block = bookBlock({
    hasTreasury: treasury !== undefined,
    bankHasCuit: Boolean(treasury?.bankHasCuit),
    feesNetCents: feesNet,
  })

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
    isKnownField: (key) => BANK_KNOWN_FIELDS.has(key) || key.startsWith('others.'),
    onSaved: (saved) => {
      undoToast(saved.message, saved)
      if (!treasuryId) {
        router.push(`${base}/cajas`)
        return
      }
      // Viniendo de contar la caja, se vuelve a su ficha con la hoja de contar abierta: ahora
      // sí tiene que coincidir.
      router.push(
        fromCount
          ? `${base}/cajas/${treasuryId}?accion=ajustar&caja=${treasuryId}`
          : `${base}/cajas/${treasuryId}`,
      )
    },
  })

  const localErrors = attempted && !preview.state.ok ? (preview.state.fieldErrors ?? {}) : {}
  const errorOf = (key: string): string | null =>
    posting.fieldErrors[key] ?? localErrors[key] ?? null
  const controlError =
    attempted && controlDiff !== null && controlDiff !== 0
      ? 'No coincide con el total del resumen: revisá los importes, o borrá el total para guardar igual.'
      : null

  const shown = posting.overrideFor(preview.key) ?? (preview.state.ok ? preview.state.preview : [])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)
    if (!preview.state.ok || controlError || (controlDiff !== null && controlDiff !== 0)) {
      posting.setBanner({ tone: 'error', message: 'Revisá lo marcado en rojo.' })
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    posting.submit(values, preview.state, preview.key)
  }

  // ── Los renglones del resumen ──
  const amounts: Record<BankAmountField, [number | null, (cents: number | null) => void]> = {
    feesNetCents: [feesNet, setFeesNet],
    ley25413DebitCents: [leyDebit, setLeyDebit],
    ley25413CreditCents: [leyCredit, setLeyCredit],
    sircrebCents: [sircreb, setSircreb],
    interestCents: [interest, setInterest],
    vatPerceptionCents: [vatPerception, setVatPerception],
    feesNoVatCents: [feesNoVat, setFeesNoVat],
  }
  /**
   * Lo que se dice debajo de un renglón cuando ya tiene importe. Fuera del papel
   * y de los campos, la plata va sin centavos si es redonda (`moneyLabel`):
   * «$ 2.604», «$ 1.888,92». Tres «,00» en un renglón son ruido, y el botón de
   * guardar ya decía el total así.
   */
  const computed = (field: BankAmountField): string | null => {
    if (field === 'feesNetCents' && feesNet !== null && feesNet > 0) {
      return `IVA ${vatRateLabel(rate)}: ${moneyLabel(vat)}`
    }
    if (field === 'ley25413DebitCents' && leyDebit !== null && leyDebit > 0) {
      return leyDebitSplit.computable > 0
        ? `El ${vatRateLabel(settings.bankTaxDebitComputableBp)} lo podés tomar a cuenta del impuesto a las Ganancias: ${moneyLabel(leyDebitSplit.computable)}`
        : null
    }
    if (field === 'ley25413CreditCents' && leyCredit !== null && leyCredit > 0) {
      return leyCreditSplit.computable > 0
        ? `El ${vatRateLabel(settings.bankTaxCreditComputableBp)} lo podés tomar a cuenta del impuesto a las Ganancias: ${moneyLabel(leyCreditSplit.computable)}`
        : null
    }
    return null
  }

  const moreRows = BANK_ROWS.filter((row) => row.more)
  const moreHasContent =
    moreRows.some((row) => (amounts[row.field][0] ?? 0) !== 0 || errorOf(row.field) !== null) ||
    others.length > 0
  const showMore = moreOpen || moreHasContent

  // El avance se lee en la pantalla (sin centavos de más); la nota del papel, al centavo.
  const progress = bankProgress(total, control, moneyLabel)
  const accountName = (accountId: string | null) =>
    accounts.find((a) => a.id === accountId)?.name ?? 'Otro concepto'

  // ── El papel ──
  const statementRows: BankStatementRow[] = [
    ...BANK_ROWS.flatMap((row): BankStatementRow[] => {
      const value = amounts[row.field][0]
      if (value === null || value <= 0) return []
      const line: BankStatementRow = { key: row.field, label: row.label, value: formatCents(value) }
      return row.field === 'feesNetCents' && vat > 0
        ? [line, { key: 'iva', label: `IVA ${vatRateLabel(rate)}`, value: formatCents(vat) }]
        : [line]
    }),
    ...others
      .filter((o) => o.amount !== null && o.amount > 0)
      .map((o) => ({
        key: `otro-${o.key}`,
        label: accountName(o.accountId),
        value: formatCents(o.amount),
      })),
  ]
  const stamp = inBook ? voucherStamp(voucherType) : null
  const statementNote = bankStatementNote(progress, formatCents)
  const paperNotes = [
    statementNote,
    inBook
      ? vat > 0
        ? `Recuperás ${formatCents(vat)} de IVA.`
        : null
      : vat > 0
        ? 'El IVA de las comisiones va al costo. Todo queda registrado igual.'
        : total > 0
          ? 'Todo queda registrado como gasto del banco.'
          : null,
  ].filter((note): note is string => note !== null)
  const statement = (
    <BankStatement
      title={treasury?.name ?? 'Resumen del banco'}
      subtitle={date ? `Débitos · ${formatDayMonth(date)}` : 'Débitos'}
      rows={statementRows}
      total={total > 0 ? formatCents(total) : EMPTY}
      stamp={stamp}
      notes={paperNotes}
      pending={total === 0}
    />
  )
  const books = <EntryPreview entries={shown} label="Ver cómo queda en los libros" />

  // ── El estado de cada sección ──
  const step1Done = treasury !== undefined && date !== null
  const step2Done = control !== null
  const step3Done = total > 0 && (controlDiff === null || controlDiff === 0)
  const state1: StepState = step1Done ? 'done' : 'current'
  const state2: StepState = step2Done ? 'done' : step1Done && total === 0 ? 'current' : 'todo'
  const state3: StepState = step3Done
    ? 'done'
    : step1Done && (step2Done || total > 0)
      ? 'current'
      : 'todo'
  const state4: StepState = step3Done ? 'current' : 'todo'

  function moneyRow(row: BankRow) {
    const [value, set] = amounts[row.field]
    const inputId = `${id}-${row.field}`
    const error = errorOf(row.field)
    const help = computed(row.field) ?? row.hint
    return (
      <li
        key={row.field}
        className="grid gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-start"
      >
        <div className="min-w-0">
          <Label htmlFor={inputId} className="block leading-snug font-medium">
            {row.term ? <Term name={row.term}>{row.label}</Term> : row.label}
            <span className="sr-only">, en pesos</span>
          </Label>
          {row.printed ? (
            <p className="mt-0.5 font-mono text-[11px] leading-snug tracking-[0.04em] text-muted-foreground">
              <span className="sr-only">En el resumen suele figurar como </span>
              {row.printed}
            </p>
          ) : null}
          {help ? (
            <p id={`${inputId}-hint`} className="mt-1 text-xs text-muted-foreground text-pretty">
              {help}
            </p>
          ) : null}
          {row.field === 'feesNetCents' ? (
            <div className="mt-1">
              {inBook ? (
                <p className="text-xs text-muted-foreground">
                  Con el comprobante del banco, el IVA va al 21 %.
                </p>
              ) : rateOpen || vatRate !== 2100 ? (
                <ChoiceChips<string>
                  size="sm"
                  label="IVA de las comisiones"
                  value={String(vatRate)}
                  onChange={(next) => setVatRate(Number(next) as VatRateBp)}
                  options={FEE_RATES.map((r) => ({ value: String(r), label: vatRateLabel(r) }))}
                />
              ) : (
                <button
                  type="button"
                  className={cn(TEXT_LINK, 'text-xs underline')}
                  onClick={() => setRateOpen(true)}
                >
                  El IVA no es 21 %
                </button>
              )}
            </div>
          ) : null}
        </div>
        <div>
          <MoneyInput
            id={inputId}
            value={value}
            onValueChange={(cents) => {
              set(cents)
              posting.clearFieldError(row.field)
            }}
            align="end"
            invalid={Boolean(error)}
            aria-describedby={describedBy(inputId, { hint: help, error })}
          />
          {error ? (
            <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </li>
    )
  }

  const submitLabel = posting.pending
    ? 'Guardando…'
    : total > 0
      ? `Guardar gastos del banco · ${moneyLabel(total)}`
      : 'Guardar gastos del banco'

  return (
    <>
      <form
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        onKeyDown={handleFormKeyDown}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start"
      >
        <div className="min-w-0 space-y-4">
          {fromCount && treasury ? (
            <div className="flex flex-col gap-1.5 rounded-2xl border border-info/25 bg-info/8 p-4">
              <StatusPill tone="info" className="self-start">
                Venís de contar {treasury.name}
              </StatusPill>
              <p className="text-sm text-pretty">
                Había {moneyLabel(prefill.totalCents ?? 0)} menos que en el sistema. Repartí ese
                importe y, al guardar, te llevamos a confirmar que coincide.
              </p>
            </div>
          ) : null}

          <StepCard
            open
            n={1}
            state={state1}
            title="¿De qué cuenta y cuándo?"
            summary={
              step1Done && treasury && date
                ? `${treasury.name} · ${formatDayMonth(date)}`
                : 'La cuenta de la que te debitaron y la fecha del resumen.'
            }
          >
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start">
              <div className="grid content-start gap-1.5">
                <span id={`${id}-caja-label`} className="text-sm leading-none font-medium">
                  Cuenta
                  <span aria-hidden="true" className="ml-0.5 text-destructive">
                    *
                  </span>
                </span>
                <TreasuryPicker
                  id={`${id}-caja`}
                  aria-labelledby={`${id}-caja-label`}
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
                {errorOf('treasuryAccountId') ? (
                  <p id={`${id}-caja-error`} role="alert" className="text-xs text-destructive">
                    {errorOf('treasuryAccountId')}
                  </p>
                ) : null}
                {/* Sin un banco cargado, la pantalla se llama «del banco» y ofrece solo la
                    billetera: se dice por qué y dónde se agrega (como en «Registrar un cobro»). */}
                {treasuries.some((t) => t.kind === 'bank') ? null : (
                  <p className="text-xs text-muted-foreground text-pretty">
                    No tenés un banco cargado.{' '}
                    <Link
                      href={`${base}/ajustes?tab=cajas`}
                      className="inline-flex min-h-11 items-center rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                    >
                      Agregalo en Ajustes
                    </Link>{' '}
                    si te cobra comisiones.
                  </p>
                )}
              </div>
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
                hint="La del resumen o la del último débito."
                error={errorOf('date')}
              />
            </div>
          </StepCard>

          <StepCard
            open
            n={2}
            state={state2}
            title="¿Cuánto te debitaron en total?"
            summary={
              control !== null
                ? `${moneyLabel(control)} según el resumen`
                : 'Para saber cuándo terminaste de cargar. Si no lo tenés, dejalo vacío.'
            }
          >
            <MoneyField
              label="Total según el resumen"
              optional
              value={control}
              onValueChange={setControl}
              error={controlError}
              className={BIG_MONEY_FIELD}
              fieldClassName="max-w-sm"
            />
          </StepCard>

          <StepCard
            open
            n={3}
            state={state3}
            title="Repartilo por concepto"
            summary="Copiá cada renglón del resumen. Lo que no tuvo, dejalo vacío."
          >
            <div className="space-y-4">
              <ul className="divide-y divide-border/60">
                {BANK_ROWS.filter((row) => !row.more).map(moneyRow)}
              </ul>

              {showMore ? (
                <div className="space-y-3 rounded-xl bg-secondary/50 p-3 sm:p-4">
                  <p className="text-sm font-medium">Más conceptos</p>
                  <ul className="divide-y divide-border/60">{moreRows.map(moneyRow)}</ul>
                  {others.length > 0 ? (
                    <div className="grid gap-3 border-t border-border/60 pt-3">
                      {others.map((row, index) => (
                        <div
                          key={row.key}
                          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-start"
                        >
                          <AccountCombobox
                            value={row.accountId}
                            onValueChange={(next) => {
                              setOthers((prev) =>
                                prev.map((o) =>
                                  o.key === row.key ? { ...o, accountId: next } : o,
                                ),
                              )
                              posting.clearFieldError(`others.${index}.accountId`)
                            }}
                            accounts={accounts}
                            filter={(a) => imputable.has(a.id)}
                            placeholder="¿Qué es?"
                            aria-label={`Qué es el concepto ${index + 1}`}
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
                            onClick={() =>
                              setOthers((prev) => prev.filter((o) => o.key !== row.key))
                            }
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
                  {others.length < BANK_OTHERS_MAX ? (
                    <button
                      type="button"
                      className={ADD_LINK}
                      onClick={() => {
                        const key = nextKey.current
                        nextKey.current += 1
                        setOthers((prev) => [...prev, { key, accountId: null, amount: null }])
                      }}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Agregar otro concepto
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  className={ADD_LINK}
                  aria-expanded={false}
                  onClick={() => setMoreOpen(true)}
                >
                  <ChevronDown className="size-3.5" aria-hidden />
                  Más conceptos
                </button>
              )}

              {/* El avance contra el total del resumen: cuánto falta repartir. */}
              <div className="space-y-2 border-t border-border/60 pt-4">
                {control !== null ? (
                  <Meter
                    valueCents={total}
                    totalCents={control}
                    tone={progress.kind === 'over' ? 'out' : 'default'}
                    label="Repartido del total del resumen"
                  />
                ) : null}
                <p
                  role="status"
                  className={cn(
                    'flex items-center gap-1.5 text-sm',
                    progress.kind === 'match' && 'font-medium text-success',
                    progress.kind === 'over' && 'font-medium text-warning-text',
                    (progress.kind === 'no_control' || progress.kind === 'empty') &&
                      'text-muted-foreground',
                  )}
                >
                  {progress.kind === 'match' ? (
                    <CircleCheck className="size-4 shrink-0" aria-hidden />
                  ) : null}
                  {progress.kind === 'no_control' && total === 0
                    ? 'Todavía no cargaste ningún concepto.'
                    : progress.text}
                </p>
              </div>
            </div>
          </StepCard>

          <StepCard
            open
            n={4}
            state={state4}
            title="¿Tenés el comprobante del banco?"
            summary="Con el resumen o la factura del banco recuperás el IVA de las comisiones."
          >
            <div className="space-y-4">
              <div
                role="radiogroup"
                aria-label="¿Tenés el comprobante del banco?"
                className="grid gap-3 sm:grid-cols-2"
              >
                <ChoiceCard
                  name={`${id}-book`}
                  value="si"
                  checked={inBook}
                  disabled={block !== null}
                  onChange={() => {
                    setInBook(true)
                    posting.clearFieldError('voucher')
                  }}
                  title="Sí, tengo el resumen o la factura del banco"
                  consequence={
                    block === 'no_treasury'
                      ? 'Elegí la cuenta primero.'
                      : block === 'no_cuit'
                        ? 'Falta el CUIT del banco para recuperar el IVA.'
                        : block === 'no_fees'
                          ? 'No cargaste comisiones con IVA: no hay IVA para recuperar.'
                          : `Recuperás el IVA de las comisiones: ${moneyLabel(vat)}.`
                  }
                />
                <ChoiceCard
                  name={`${id}-book`}
                  value="no"
                  checked={!inBook}
                  onChange={() => {
                    setInBook(false)
                    posting.clearFieldError('voucher')
                  }}
                  title="No, o no sé"
                  consequence="Queda todo registrado como gasto del banco. El IVA va al costo."
                />
              </div>
              {block === 'no_cuit' ? (
                // El motivo ya lo dice la tarjeta apagada: acá va solo la salida. Queda afuera
                // de la tarjeta para que se lea con todo su contraste y se pueda tocar. En su
                // propio renglón: suelto, quedaba pegado a «Agregar una nota» («→+»).
                <p className="-mt-1">
                  <Link
                    href={`${base}/ajustes?tab=participes`}
                    className={cn(ADD_LINK, 'text-foreground underline underline-offset-4')}
                  >
                    Cargar el CUIT del banco en Ajustes › Medios de cobro
                    <ArrowRight className="size-3.5 shrink-0" aria-hidden />
                  </Link>
                </p>
              ) : null}

              {inBook ? (
                <div className="grid gap-4 rounded-xl bg-secondary/50 p-3 sm:p-4">
                  <div className="grid gap-2">
                    <span id={`${id}-vtype`} className="text-sm leading-none font-medium">
                      ¿Qué comprobante es?
                    </span>
                    <ChoiceChips<VoucherType>
                      labelledBy={`${id}-vtype`}
                      value={voucherType}
                      onChange={setVoucherType}
                      options={VOUCHER_TYPES}
                    />
                    {errorOf('voucher.voucherType') ? (
                      <p role="alert" className="text-xs text-destructive">
                        {errorOf('voucher.voucherType')}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[9rem_11rem]">
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
                    <Field
                      id={`${id}-vnum`}
                      label="Número"
                      required
                      error={errorOf('voucher.number')}
                    >
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
                </div>
              ) : null}

              {notesOpen || notes !== '' || errorOf('notes') ? (
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
              ) : (
                <button
                  type="button"
                  className={ADD_LINK}
                  onClick={() => {
                    setNotesOpen(true)
                    requestAnimationFrame(() => document.getElementById(`${id}-notes`)?.focus())
                  }}
                >
                  <Plus className="size-3.5" aria-hidden />
                  Agregar una nota
                </button>
              )}

              <FormBanner banner={posting.banner} />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Button asChild variant="ghost" className="h-12 sm:h-11">
                  <Link href={`${base}/cajas`}>Cancelar</Link>
                </Button>
                <Button
                  type="submit"
                  className="h-12 px-6 text-base font-semibold"
                  disabled={posting.pending}
                >
                  {submitLabel}
                </Button>
              </div>
            </div>
          </StepCard>

          {/* En el celular el resumen queda detrás de «Ver resumen»: los libros van acá, a lo
              ancho de la página (adentro del paso el rótulo no entra en un celular). */}
          <div className="lg:hidden">{books}</div>
        </div>

        {/* El resumen que se arma, al costado. */}
        <aside className="hidden space-y-4 lg:sticky lg:top-20 lg:block">
          {statement}
          {books}
        </aside>

        {/* Sin lugar para el resumen al costado: el total siempre a la vista y el papel a un toque.
            Va pegada abajo DENTRO de la página, así no pisa el menú del costado. */}
        <div className="sticky bottom-0 z-30 -mx-4 -mb-6 border-t border-border/70 bg-background/90 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] shadow-[0_-10px_24px_-16px_rgb(0_0_0/0.35)] backdrop-blur-md sm:-mx-6 sm:-mb-8 sm:px-6 lg:hidden">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Total debitado
              </p>
              <p
                className={cn(
                  'mt-0.5 font-serif leading-none font-semibold tracking-tight whitespace-nowrap',
                  // Nueve cifras no entran al lado del botón en un celular angosto.
                  total >= 100_000_000_00 ? 'text-xl' : 'text-2xl',
                )}
              >
                {total > 0 ? (
                  moneyLabel(total)
                ) : (
                  <span className="text-muted-foreground">
                    <span aria-hidden>{EMPTY}</span>
                    <span className="sr-only">Todavía sin importes</span>
                  </span>
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 gap-2 rounded-full px-4"
              onClick={() => setStatementOpen(true)}
            >
              <ReceiptText className="size-4" aria-hidden />
              Ver resumen
            </Button>
          </div>
        </div>
      </form>

      <Sheet open={statementOpen} onOpenChange={setStatementOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] gap-0 overflow-y-auto px-4 pt-10 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] outline-none"
          // El foco va a la hoja (no a la X): es para leer.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
          }}
        >
          <SheetGrabber />
          <SheetHeader className="sr-only">
            <SheetTitle>El resumen del banco que vas cargando</SheetTitle>
            <SheetDescription>
              Lo que cargaste hasta ahora. Se guarda con el botón del último paso.
            </SheetDescription>
          </SheetHeader>
          <div className="mx-auto w-full max-w-sm">
            {statement}
            <p className="mt-5 text-center text-xs text-muted-foreground">
              Esto todavía no está guardado: se guarda en el último paso.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onCancel={posting.dismissWarnings}
        onConfirm={() => posting.confirmWarnings()}
      />
    </>
  )
}
