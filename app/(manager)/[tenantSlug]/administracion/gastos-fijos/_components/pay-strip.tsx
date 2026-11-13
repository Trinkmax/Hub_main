'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  partyLabel,
  payableParties,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/expense-target-picker'
import {
  FormBanner,
  WarningsDialog,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/form-feedback'
import {
  type SavedState,
  useDocumentPosting,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/use-document-posting'
import {
  padNumber,
  padPos,
  VoucherNumberInput,
  type VoucherNumberValue,
  voucherPart,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/voucher-number-input'
import { isPurchaseImputation } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/accounts'
import { documentHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import {
  buildQuickExpenseValues,
  isInvoiceVoucher,
  QUICK_VOUCHER_LABELS,
  type QuickExpenseFormValues,
  type QuickVoucher,
  quickVoucherFromType,
  recurringPrefill,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import type { SheetData } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { attachPendingFiles } from '@/components/administracion/adjuntos/upload'
import { type ComboOption, EntityCombobox } from '@/components/administracion/entity-combobox'
import { FotoQrButton } from '@/components/administracion/foto-qr/foto-panel'
import { rankAndFilter, rankParty } from '@/components/administracion/search'
import { TreasurySelect } from '@/components/administracion/treasury-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { postQuickExpense } from '@/lib/accounting/actions/documents'
import { rememberRecurringSupplier } from '@/lib/accounting/actions/master'
import { pickTreasury } from '@/lib/accounting/defaults'
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import { bankTaxOf, bpLabel } from '@/lib/accounting/taxes'
import { formatCuit } from '@/lib/fiscal'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  autoTaxPlan,
  morePayOptionsHref,
  payStripBlock,
  type StripSupplier,
  stripAsksSupplier,
  stripFromQr,
  stripTarget,
  supplierAfterQr,
} from '../_lib/planilla-words'
import { PayStripSkeleton } from './pay-strip-skeleton'

/** La misma de «Nuevo gasto»: la caja de la última vez se propone en las dos. */
const LAST_TREASURY_KEY = 'hub_acc_gasto_caja:'

/** En el orden del prototipo: lo de todos los días primero. */
const PAPERS: readonly QuickVoucher[] = ['none', 'a', 'bc', 'ticket']

/** 44 px con el dedo, 36 con mouse. El desplegable trae su propia altura por `data-size`. */
const FIELD = 'w-full data-[size=default]:h-11 md:pointer-fine:data-[size=default]:h-9'
const ACTION = 'h-11 md:pointer-fine:h-9'
/** Los campos de texto y el combo, a la misma altura que el resto de la tira. */
const BOX = 'md:pointer-fine:h-9 md:pointer-fine:text-sm'

/** «Crear proveedor «nombre del gasto fijo»» sin tener que escribirlo. */
const NEW_FROM_ROW = '__nuevo__'
/** El valor del combo con un proveedor nuevo ya elegido (ninguna fila lleva el tilde). */
const NEW_CHOSEN = '__nuevo_elegido__'

/** «Factura B o C» con un proveedor nuevo: la letra dice su condición (la B la hace un inscripto). */
const LETTERS = [
  { value: 'c', label: 'C', condition: 'monotributo' },
  { value: 'b', label: 'B', condition: 'responsable_inscripto' },
] as const
const LINK =
  'inline-flex min-h-9 items-center rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11'

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

type PayStripProps = {
  row: RecurringExpenseRow
  month: string
  /** El monto de la celda: lo que se está por pagar, aunque se esté escribiendo. */
  amountCents: number | null
  /** El QR de la factura trae el total: es lo que vale la celda. `null`: el monto no se escribe. */
  onAmountRead: ((cents: number) => void) | null
  data: SheetData | null
  /** No se pudieron traer los datos. */
  message: string | null
  onRetry: () => void
  onCancel: () => void
  onPaid: () => void
}

/**
 * La tira que se abre al tildar un gasto fijo: Salió de · Papel · Foto · Cargar pago · Cancelar, y el
 * impuesto al cheque si corresponde. Manda lo mismo que «Nuevo gasto» con ese gasto fijo elegido:
 * `postQuickExpense` con su `recurringExpenseId`, armado con el mismo `recurringPrefill` y con la
 * vista previa del mismo motor.
 *
 * Con factura aparece lo que pide (12/11/2026): el número y, si el gasto fijo no tiene proveedor, de
 * quién es (uno de la lista o uno nuevo con su CUIT). La foto del QR completa los dos. Ese proveedor
 * queda guardado en el gasto fijo después de pagar. Lo demás (otra fecha, el detalle) va por «Más
 * opciones».
 */
export function PayStrip({ data, message, onRetry, ...form }: PayStripProps) {
  if (!data) {
    if (!message) return <PayStripSkeleton />
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="min-w-0 flex-1 basis-56 text-sm text-pretty">
          {message}
        </p>
        <Button type="button" variant="outline" className={ACTION} onClick={onRetry}>
          Reintentar
        </Button>
        <Button type="button" variant="ghost" className={ACTION} onClick={form.onCancel}>
          Cancelar
        </Button>
      </div>
    )
  }
  return <PayForm {...form} data={data} />
}

function PayForm({
  row,
  month,
  amountCents,
  onAmountRead,
  data,
  onCancel,
  onPaid,
}: Omit<PayStripProps, 'data' | 'message' | 'onRetry'> & { data: SheetData }) {
  const { tenantSlug } = useAccounting()
  const router = useRouter()
  const uid = useId()
  const submitRef = useRef<HTMLButtonElement>(null)

  const recurring = useMemo(
    () => data.recurring.find((r) => r.id === row.id) ?? null,
    [data.recurring, row.id],
  )
  const prefill = useMemo(() => {
    if (!recurring) return null
    return recurringPrefill(recurring, {
      payablePartyIds: new Set(payableParties(data.parties).map((p) => p.id)),
      imputableAccountIds: new Set(data.accounts.filter(isPurchaseImputation).map((a) => a.id)),
      activeTreasuryIds: new Set(data.treasuries.filter((t) => t.active).map((t) => t.id)),
    })
  }, [data, recurring])

  const [treasuryId, setTreasuryId] = useState<string | null>(
    () =>
      prefill?.treasuryAccountId ??
      pickTreasury({
        treasuries: data.treasuries,
        myLastQuickExpense: rememberedTreasury(tenantSlug),
        order: data.treasuries.map((t) => t.id),
      }),
  )
  // El papel de siempre. Una factura sin proveedor también (`recurringPrefill` la deja afuera): la
  // tira pregunta de quién es.
  const [voucher, setVoucher] = useState<QuickVoucher>(
    () => prefill?.voucher ?? quickVoucherFromType(recurring?.voucherType) ?? 'none',
  )
  const [files, setFiles] = useState<File[]>([])
  // Con factura se escribe; el QR lo completa con cualquier papel (un tique con número va al libro).
  const [numberText, setNumberText] = useState<VoucherNumberValue>({ pos: '', number: '' })
  // Solo cuenta con factura y un gasto fijo sin proveedor (`stripAsksSupplier`).
  const [supplier, setSupplier] = useState<StripSupplier | null>(null)

  const fixedTarget = prefill?.target ?? null
  const asksSupplier = stripAsksSupplier(fixedTarget, voucher)
  const asksNumber = isInvoiceVoucher(voucher)
  const target = useMemo(
    () => stripTarget({ fixed: fixedTarget, voucher, supplier }),
    [fixedTarget, voucher, supplier],
  )
  const pointOfSale = voucherPart(numberText.pos)
  const voucherNo = voucherPart(numberText.number)
  const hasNumber = pointOfSale !== null && voucherNo !== null

  const suppliers = useMemo(() => payableParties(data.parties), [data.parties])
  const partyById = useMemo(() => new Map(data.parties.map((p) => [p.id, p])), [data.parties])

  const built = useMemo(
    () =>
      buildQuickExpenseValues({
        amountCents,
        target,
        treasuryAccountId: treasuryId,
        voucher,
        vatRateBp: prefill?.vatRateBp ?? 2100,
        vatAdjustCents: 0,
        pointOfSale: hasNumber ? pointOfSale : null,
        number: hasNumber ? voucherNo : null,
        date: data.today,
        detail: '',
        recurringExpenseId: row.id,
      }),
    [
      amountCents,
      target,
      treasuryId,
      voucher,
      prefill,
      hasNumber,
      pointOfSale,
      voucherNo,
      data.today,
      row.id,
    ],
  )
  const key = built.values ? JSON.stringify(built.values) : ''
  const preview = useMemo(
    () =>
      built.values
        ? previewDocumentForm('quick_expense', built.values, data.ctx, {
            firstOpenDate: data.firstOpenDate,
          })
        : null,
    [built.values, data.ctx, data.firstOpenDate],
  )

  /** El proveedor que se eligió acá queda en el gasto fijo: el mes que viene ya viene elegido. */
  const rememberSupplier = async (documentId: string) => {
    const missed = 'El pago quedó cargado, pero el proveedor no quedó guardado en el gasto fijo.'
    try {
      const result = await rememberRecurringSupplier(tenantSlug, {
        recurringId: row.id,
        documentId,
      })
      if (!result.ok) {
        toast.error(missed)
        return
      }
      // Lo dijo la tira antes de pagar («… queda como proveedor»): acá solo se refresca la fila.
      if (result.data) router.refresh()
    } catch {
      toast.error(missed)
    }
  }

  const onSaved = (saved: SavedState) => {
    if (treasuryId) rememberTreasury(tenantSlug, treasuryId)
    posting.undoToast(saved.message, saved)
    const documentId = saved.result.documents[0]?.id ?? null
    // La foto sube después de guardar: si alguna no sube, avisa y se suma desde el comprobante.
    void attachPendingFiles({
      tenantSlug,
      documentId,
      files,
      openDocument: (id) => router.push(documentHref(tenantSlug, id)),
    })
    if (asksSupplier && supplier !== null && documentId) void rememberSupplier(documentId)
    router.refresh()
    onPaid()
  }
  const posting = useDocumentPosting<QuickExpenseFormValues>({
    tenantSlug,
    action: postQuickExpense,
    onSaved,
  })

  // Con todo puesto, Enter paga: «vas marcando».
  const block = payStripBlock({
    amountCents,
    target,
    voucher,
    hasNumber,
    parties: data.parties,
  })
  const problem = block ?? (preview && !preview.ok ? preview.message : null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrir la tira
  useEffect(() => {
    if (problem === null) submitRef.current?.focus({ preventScroll: true })
  }, [])

  // Un impuesto que se devenga solo no se puede pagar acá (quedaría dos veces): la hoja lo manda a
  // «Pagar», pero si lo que trajo la página quedó viejo, esta es la segunda guarda.
  const autoTax = autoTaxPlan({
    settings: data.ctx.settings.taxSettings,
    accounts: data.accounts,
    parties: data.parties,
  })
  const isAutoTax = autoTax[row.accountId] !== undefined

  const settings = data.ctx.settings.taxSettings
  const treasury = treasuryId ? data.ctx.treasuries.get(treasuryId) : undefined
  const bankTax = amountCents !== null ? bankTaxOf(amountCents, treasury, settings) : 0
  const submitLabel =
    amountCents !== null && amountCents > 0
      ? `Cargar pago · ${formatCentsShort(amountCents)}`
      : 'Cargar pago'

  const submit = () => {
    if (posting.pending || isAutoTax || !built.values || !preview?.ok || block !== null) return
    posting.submit(built.values, preview.hash, key)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Lo que se abre adentro (el desplegable) cierra lo suyo: Esc en la tira es solo de la tira.
    const inside = event.currentTarget.contains(event.target as Node)
    if (event.key === 'Escape' && inside) {
      event.stopPropagation()
      onCancel()
    }
    // Enter en el número o el CUIT, con todo puesto, paga (como el botón).
    if (event.key === 'Enter' && inside && event.target instanceof HTMLInputElement) {
      event.preventDefault()
      submit()
    }
  }

  // ── De quién es la factura (un gasto fijo sin proveedor) ──
  /**
   * Sin buscar: primero los que se parecen al nombre del gasto fijo, después otros de la lista (que se
   * vea que se puede elegir uno que ya está) y crear uno con ese nombre.
   */
  const filterSuppliers = (query: string): ComboOption[] => {
    let found: typeof suppliers
    if (query) found = rankAndFilter(suppliers, query, rankParty, 8)
    else {
      const similar = rankAndFilter(suppliers, row.name, rankParty, 6)
      const others = suppliers.filter((p) => !similar.includes(p))
      found = [...similar, ...others.slice(0, Math.max(0, 6 - similar.length))]
    }
    const options: ComboOption[] = found.map((p) => ({
      value: p.id,
      label: partyLabel(p),
      description: p.taxId ? `CUIT ${formatCuit(p.taxId)}` : 'Sin CUIT',
      group: 'Proveedores',
    }))
    if (!query) {
      options.push({
        value: NEW_FROM_ROW,
        label: `Crear proveedor «${row.name}»`,
        description: 'Después escribís el CUIT.',
        group: 'Nuevo',
      })
    }
    return options
  }
  const createSupplier = (name: string) => {
    setSupplier({
      kind: 'new',
      name,
      taxId: '',
      ivaCondition: voucher === 'bc' ? 'monotributo' : 'responsable_inscripto',
    })
    posting.clearFieldErrors()
    // Lo que sigue es el CUIT (el combo devuelve el foco a su botón al cerrarse: esto va después).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.getElementById(`${uid}-cuit`)?.focus()),
    )
  }
  const pickSupplier = (value: string) => {
    if (value === NEW_FROM_ROW) {
      createSupplier(row.name)
      return
    }
    setSupplier({ kind: 'party', partyId: value })
    posting.clearFieldErrors()
  }
  const chosenParty = supplier?.kind === 'party' ? partyById.get(supplier.partyId) : undefined
  const supplierLabel =
    supplier === null
      ? undefined
      : supplier.kind === 'party'
        ? chosenParty
          ? partyLabel(chosenParty)
          : 'Proveedor'
        : `${supplier.name} · nuevo`
  const newSupplier = asksSupplier && supplier?.kind === 'new' ? supplier : null
  /** El que va a quedar en el gasto fijo (solo si la tira lo preguntó). */
  const supplierName =
    !asksSupplier || supplier === null
      ? null
      : supplier.kind === 'new'
        ? supplier.name
        : (chosenParty?.tradeName ?? chosenParty?.name ?? null)
  // La foto del QR completa lo que falta de una factura (número, proveedor y monto).
  const qrHint =
    problem !== null && asksNumber && (!hasNumber || (asksSupplier && supplier === null))

  if (isAutoTax) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="min-w-0 flex-1 basis-56 text-sm text-pretty">
          Este impuesto ya se devenga en cada cierre del día: se paga desde «Pagar», no acá.
        </p>
        <Button type="button" variant="ghost" className={ACTION} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    )
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: no es un control: solo escucha Esc para cerrar la tira
    <div onKeyDown={onKeyDown} className="grid gap-2.5">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2.5">
        <div className="grid w-full gap-1.5 sm:w-56">
          <Label htmlFor={`${uid}-caja`} className="text-xs">
            Salió de
          </Label>
          <TreasurySelect
            id={`${uid}-caja`}
            value={treasuryId}
            onValueChange={(next) => {
              setTreasuryId(next)
              posting.clearFieldErrors()
            }}
            treasuries={data.treasuries}
            disabled={posting.pending}
            className={FIELD}
          />
        </div>
        <div className="grid w-full gap-1.5 sm:w-40">
          <Label htmlFor={`${uid}-papel`} className="text-xs">
            Papel
          </Label>
          <Select
            value={voucher}
            disabled={posting.pending}
            onValueChange={(next) => {
              setVoucher(next as QuickVoucher)
              posting.clearFieldErrors()
            }}
          >
            <SelectTrigger id={`${uid}-papel`} className={FIELD}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAPERS.map((paper) => (
                <SelectItem key={paper} value={paper}>
                  {QUICK_VOUCHER_LABELS[paper]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {asksSupplier ? (
          <div className="grid w-full gap-1.5 sm:w-60">
            <Label htmlFor={`${uid}-proveedor`} className="text-xs">
              Proveedor
            </Label>
            <EntityCombobox
              id={`${uid}-proveedor`}
              value={
                supplier === null ? null : supplier.kind === 'party' ? supplier.partyId : NEW_CHOSEN
              }
              selectedLabel={supplierLabel}
              filter={filterSuppliers}
              onSelect={pickSupplier}
              onCreate={createSupplier}
              createLabel={(q) => `Crear proveedor «${q}»`}
              placeholder="Elegí o creá el proveedor"
              searchPlaceholder="Nombre o CUIT…"
              emptyText={(q) =>
                q ? `No hay ninguno con «${q}». Podés crearlo.` : 'Escribí para buscar.'
              }
              disabled={posting.pending}
              className={BOX}
            />
          </div>
        ) : null}
        {newSupplier ? (
          <div className="grid w-full gap-1.5 sm:w-44">
            <Label htmlFor={`${uid}-cuit`} className="text-xs">
              CUIT del proveedor
            </Label>
            <Input
              id={`${uid}-cuit`}
              value={newSupplier.taxId}
              inputMode="numeric"
              autoComplete="off"
              placeholder="30-71876543-5"
              disabled={posting.pending}
              onChange={(e) => {
                setSupplier({ ...newSupplier, taxId: e.target.value })
                posting.clearFieldErrors()
              }}
              onBlur={(e) => {
                const digits = e.target.value.replace(/\D/g, '')
                if (digits.length === 11) setSupplier({ ...newSupplier, taxId: formatCuit(digits) })
              }}
              className={cn('h-11 tabular-nums', BOX)}
            />
          </div>
        ) : null}
        {newSupplier && voucher === 'bc' ? (
          <div className="grid w-full gap-1.5 sm:w-24">
            <Label htmlFor={`${uid}-letra`} className="text-xs">
              Letra
            </Label>
            <Select
              value={newSupplier.ivaCondition === 'responsable_inscripto' ? 'b' : 'c'}
              disabled={posting.pending}
              onValueChange={(next) => {
                const letter = LETTERS.find((l) => l.value === next)
                if (letter) setSupplier({ ...newSupplier, ivaCondition: letter.condition })
              }}
            >
              <SelectTrigger id={`${uid}-letra`} className={FIELD}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LETTERS.map((letter) => (
                  <SelectItem key={letter.value} value={letter.value}>
                    {letter.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {asksNumber ? (
          <div className="grid w-full gap-1.5 sm:w-60">
            <Label htmlFor={`${uid}-numero`} className="text-xs">
              N.º de la factura
            </Label>
            <VoucherNumberInput
              id={`${uid}-numero`}
              value={numberText}
              onChange={(next) => {
                setNumberText(next)
                posting.clearFieldErrors()
              }}
              disabled={posting.pending}
              inputClassName={BOX}
            />
          </div>
        ) : null}
        <FotoQrButton
          tenantSlug={tenantSlug}
          files={files}
          onFiles={setFiles}
          onRead={(qr) => {
            const read = stripFromQr(qr)
            const nextVoucher = read.voucher ?? voucher
            if (read.voucher !== null) setVoucher(read.voucher)
            setNumberText({
              pos: padPos(String(read.pointOfSale)),
              number: padNumber(String(read.number)),
            })
            if (read.amountCents !== null) onAmountRead?.(read.amountCents)
            // Sin proveedor en el gasto fijo, el CUIT del QR dice de quién es la factura.
            if (stripAsksSupplier(fixedTarget, nextVoucher)) {
              setSupplier((current) => supplierAfterQr(current, qr, data.parties, row.name))
            }
            posting.clearFieldErrors()
          }}
          label="Foto por QR"
          disabled={posting.pending}
          className={ACTION}
        />
        <Button
          ref={submitRef}
          type="button"
          disabled={posting.pending || problem !== null}
          onClick={submit}
          className={cn(ACTION, 'w-full sm:w-auto')}
        >
          {posting.pending ? 'Guardando…' : submitLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={posting.pending}
          onClick={onCancel}
          className={ACTION}
        >
          Cancelar
        </Button>
        <Link href={morePayOptionsHref(tenantSlug, row.id, month)} className={LINK}>
          Más opciones
        </Link>
      </div>

      {problem ? (
        <p role="status" className="text-xs text-warning-text text-pretty">
          {problem}
          {qrHint ? ' O sacale una foto al QR de la factura: se completa sola.' : null}
        </p>
      ) : null}
      {supplierName !== null && problem === null ? (
        <p className="text-xs text-muted-foreground text-pretty">
          {supplierName} queda como proveedor de «{row.name}»: el mes que viene ya viene elegido.
        </p>
      ) : null}
      {settings && bankTax > 0 ? (
        <p className="text-xs text-muted-foreground">
          Impuesto al cheque {bpLabel(settings.bankTaxBp)}:{' '}
          <span className="font-medium text-foreground tabular-nums">{formatCents(bankTax)}</span>,
          se anota solo.
        </p>
      ) : null}
      <FormBanner banner={posting.banner} />
      <WarningsDialog
        warnings={posting.warnings}
        pending={posting.pending}
        onConfirm={posting.confirmWarnings}
        onCancel={posting.dismissWarnings}
      />
    </div>
  )
}
