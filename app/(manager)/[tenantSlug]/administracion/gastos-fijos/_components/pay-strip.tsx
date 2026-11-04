'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { payableParties } from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/expense-target-picker'
import {
  FormBanner,
  WarningsDialog,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/form-feedback'
import {
  type SavedState,
  useDocumentPosting,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/use-document-posting'
import { isPurchaseImputation } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/accounts'
import { documentHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import {
  buildQuickExpenseValues,
  QUICK_VOUCHER_LABELS,
  type QuickExpenseFormValues,
  type QuickVoucher,
  recurringPrefill,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/quick-expense'
import type { SheetData } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-types'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { attachPendingFiles } from '@/components/administracion/adjuntos/upload'
import { FotoQrButton } from '@/components/administracion/foto-qr/foto-panel'
import { TreasurySelect } from '@/components/administracion/treasury-select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { postQuickExpense } from '@/lib/accounting/actions/documents'
import { pickTreasury } from '@/lib/accounting/defaults'
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import { previewDocumentForm } from '@/lib/accounting/server/document-forms'
import { bankTaxOf, bpLabel } from '@/lib/accounting/taxes'
import { formatCents, formatCentsShort } from '@/lib/money'
import { cn } from '@/lib/utils'
import { autoTaxPlan, morePayOptionsHref, payStripBlock, stripFromQr } from '../_lib/planilla-words'
import { PayStripSkeleton } from './pay-strip-skeleton'

/** La misma de «Nuevo gasto»: la caja de la última vez se propone en las dos. */
const LAST_TREASURY_KEY = 'hub_acc_gasto_caja:'

/** En el orden del prototipo: lo de todos los días primero. */
const PAPERS: readonly QuickVoucher[] = ['none', 'a', 'bc', 'ticket']

/** 44 px con el dedo, 36 con mouse. El desplegable trae su propia altura por `data-size`. */
const FIELD = 'w-full data-[size=default]:h-11 md:pointer-fine:data-[size=default]:h-9'
const ACTION = 'h-11 md:pointer-fine:h-9'
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
 * vista previa del mismo motor. Lo que la tira no resuelve (una factura sin QR pide el número) va por
 * «Más opciones».
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

  const prefill = useMemo(() => {
    const recurring = data.recurring.find((r) => r.id === row.id)
    if (!recurring) return null
    return recurringPrefill(recurring, {
      payablePartyIds: new Set(payableParties(data.parties).map((p) => p.id)),
      imputableAccountIds: new Set(data.accounts.filter(isPurchaseImputation).map((a) => a.id)),
      activeTreasuryIds: new Set(data.treasuries.filter((t) => t.active).map((t) => t.id)),
    })
  }, [data, row.id])

  const [treasuryId, setTreasuryId] = useState<string | null>(
    () =>
      prefill?.treasuryAccountId ??
      pickTreasury({
        treasuries: data.treasuries,
        myLastQuickExpense: rememberedTreasury(tenantSlug),
        order: data.treasuries.map((t) => t.id),
      }),
  )
  const [voucher, setVoucher] = useState<QuickVoucher>(prefill?.voucher ?? 'none')
  const [files, setFiles] = useState<File[]>([])
  // Solo los trae el QR de una factura: en la tira no se tipean.
  const [voucherNumber, setVoucherNumber] = useState<{ pos: number; number: number } | null>(null)

  const built = useMemo(
    () =>
      buildQuickExpenseValues({
        amountCents,
        target: prefill?.target ?? null,
        treasuryAccountId: treasuryId,
        voucher,
        vatRateBp: prefill?.vatRateBp ?? 2100,
        vatAdjustCents: 0,
        pointOfSale: voucherNumber?.pos ?? null,
        number: voucherNumber?.number ?? null,
        date: data.today,
        detail: '',
        recurringExpenseId: row.id,
      }),
    [amountCents, prefill, treasuryId, voucher, voucherNumber, data.today, row.id],
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

  const onSaved = (saved: SavedState) => {
    if (treasuryId) rememberTreasury(tenantSlug, treasuryId)
    posting.undoToast(saved.message, saved)
    // La foto sube después de guardar: si alguna no sube, avisa y se suma desde el comprobante.
    void attachPendingFiles({
      tenantSlug,
      documentId: saved.result.documents[0]?.id ?? null,
      files,
      openDocument: (id) => router.push(documentHref(tenantSlug, id)),
    })
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
    target: prefill?.target ?? null,
    voucher,
    hasNumber: voucherNumber !== null,
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
    if (event.key === 'Escape' && event.currentTarget.contains(event.target as Node)) {
      event.stopPropagation()
      onCancel()
    }
  }

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
        <FotoQrButton
          tenantSlug={tenantSlug}
          files={files}
          onFiles={setFiles}
          onRead={(qr) => {
            const read = stripFromQr(qr)
            if (read.voucher !== null) setVoucher(read.voucher)
            setVoucherNumber({ pos: read.pointOfSale, number: read.number })
            if (read.amountCents !== null) onAmountRead?.(read.amountCents)
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
