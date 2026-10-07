'use client'

import { ArrowDownUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { postTransfer } from '@/lib/accounting/actions/documents'
import type { TransferValues } from '@/lib/accounting/server/document-types'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ActionSheetBody, ActionSheetFooter, ActionSheetHeader } from '../action-sheet'
import { loadCajasVentasCatalog } from '../cajas-ventas/data'
import { FormBanner, WarningsDialog } from '../cajas-ventas/feedback'
import { describedBy, Field } from '../cajas-ventas/field'
import { moneyLabel } from '../cajas-ventas/money'
import {
  firstLoadableDay,
  SheetCancel,
  SheetFailed,
  SheetLoading,
  useDocumentPreview,
} from '../cajas-ventas/sheet-frame'
import type { CajasVentasCatalog, SheetTreasury } from '../cajas-ventas/types'
import { usePosting, useUndoToast } from '../cajas-ventas/use-posting'
import { useSheetLoad } from '../cajas-ventas/use-sheet-load'
import { DateField } from '../date-input'
import { EntryPreview } from '../entry-preview'
import { balanceText } from '../format'
import { MoneyField } from '../money-input'
import { TreasurySelect } from '../treasury-select'
import { ACTION_TITLES, type ActionSheetProps } from './types'

const TITLE = ACTION_TITLES.mover
const DESCRIPTION = 'De una caja o cuenta a otra: depósitos, transferencias o pagar la tarjeta.'

/** Hoja «Mover plata» (H.11): D destino / H origen, mismo importe. */
export function MoverSheet(props: ActionSheetProps) {
  const { tenantSlug } = props
  const load = useSheetLoad(() => loadCajasVentasCatalog(tenantSlug), tenantSlug)
  if (!load.data) {
    if (load.status === 'error') {
      return <SheetFailed title={TITLE} message={load.message} onRetry={() => load.reload()} />
    }
    return <SheetLoading title={TITLE} description={DESCRIPTION} />
  }
  return <MoverForm {...props} catalog={load.data} />
}

type Shortcut = { key: string; label: string; from: string; to: string }

const KNOWN_FIELDS = new Set(['fromTreasuryId', 'toTreasuryId', 'amountCents', 'date', 'reference'])

/** Los atajos de H.11 que tienen sentido con las cajas del bar. */
function shortcutsFor(treasuries: readonly SheetTreasury[]): Shortcut[] {
  const first = (kind: SheetTreasury['kind']) => treasuries.find((t) => t.kind === kind)
  const cash = first('cash')
  const bank = first('bank')
  const wallet = first('wallet')
  const card = first('credit_card')
  const out: Shortcut[] = []
  if (cash && bank) {
    out.push({ key: 'deposit', label: 'Depositar el efectivo', from: cash.id, to: bank.id })
  }
  if (wallet && bank) {
    out.push({
      key: 'wallet',
      label: `Pasar de ${wallet.name} al banco`,
      from: wallet.id,
      to: bank.id,
    })
  }
  if (bank && card) {
    out.push({ key: 'card', label: 'Pagar el resumen de la tarjeta', from: bank.id, to: card.id })
  }
  return out
}

function MoverForm({
  tenantSlug,
  params,
  close,
  setDirty,
  catalog,
}: ActionSheetProps & { catalog: CajasVentasCatalog }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const id = useId()
  const { treasuries, today } = catalog
  const byId = useMemo(() => new Map(treasuries.map((t) => [t.id, t])), [treasuries])
  const shortcuts = useMemo(() => shortcutsFor(treasuries), [treasuries])

  const initialFrom = params.caja && byId.has(params.caja) ? params.caja : null
  const [fromId, setFromId] = useState<string | null>(initialFrom)
  const [toId, setToId] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [date, setDate] = useState<string | null>(today)
  const [reference, setReference] = useState('')
  const [attempted, setAttempted] = useState(false)

  const from = fromId ? byId.get(fromId) : undefined
  const to = toId ? byId.get(toId) : undefined

  const dirty =
    fromId !== initialFrom || toId !== null || amount !== null || reference.trim() !== ''
  useEffect(() => setDirty(dirty), [dirty, setDirty])

  const values = useMemo(
    () => ({
      fromTreasuryId: fromId ?? '',
      toTreasuryId: toId ?? '',
      amountCents: amount,
      date: date ?? '',
      reference: reference.trim() === '' ? null : reference.trim(),
    }),
    [fromId, toId, amount, date, reference],
  )
  const preview = useDocumentPreview('transfer', values, catalog.ctx, catalog.firstOpenDate)

  const undoToast = useUndoToast(tenantSlug)
  const posting = usePosting<TransferValues>({
    tenantSlug,
    action: postTransfer,
    formRef,
    isKnownField: (key) => KNOWN_FIELDS.has(key),
    onSaved: (saved) => {
      close()
      undoToast(saved.message, saved)
      router.refresh()
    },
  })

  const localErrors = attempted && !preview.state.ok ? (preview.state.fieldErrors ?? {}) : {}
  const errorOf = (key: string): string | null =>
    posting.fieldErrors[key] ?? localErrors[key] ?? null

  const shown = posting.overrideFor(preview.key) ?? (preview.state.ok ? preview.state.preview : [])

  // Lo que queda en la caja de origen (una tarjeta no «queda en descubierto»: suma deuda).
  const leftover =
    from && from.kind !== 'credit_card' && amount !== null ? from.balanceCents - amount : null
  const goesNegative = leftover !== null && leftover < 0
  const cardDebt = to?.kind === 'credit_card' && to.balanceCents > 0 ? to.balanceCents : null

  function pick(next: { from?: string | null; to?: string | null }) {
    if (next.from !== undefined) {
      setFromId(next.from)
      posting.clearFieldError('fromTreasuryId')
    }
    if (next.to !== undefined) {
      setToId(next.to)
      posting.clearFieldError('toTreasuryId')
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)
    if (!preview.state.ok) {
      posting.setBanner({ tone: 'error', message: 'Revisá lo marcado en rojo.' })
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    posting.submit(values, preview.state, preview.key)
  }

  const submitLabel = amount !== null && amount > 0 ? `Mover ${moneyLabel(amount)}` : 'Mover plata'

  return (
    <>
      <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
      <form ref={formRef} noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <ActionSheetBody>
          {shortcuts.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {shortcuts.map((s) => {
                const active = fromId === s.from && toId === s.to
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => pick({ from: s.from, to: s.to })}
                    className={cn(
                      'inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors md:h-9',
                      'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:bg-secondary',
                    )}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          ) : null}

          <div className="grid gap-2">
            <Field id={`${id}-from`} label="De" required error={errorOf('fromTreasuryId')}>
              <TreasurySelect
                id={`${id}-from`}
                value={fromId}
                onValueChange={(next) => pick({ from: next })}
                treasuries={treasuries}
                exclude={toId ? [toId] : []}
                placeholder="¿De dónde sale la plata?"
                invalid={Boolean(errorOf('fromTreasuryId'))}
                aria-describedby={describedBy(`${id}-from`, { error: errorOf('fromTreasuryId') })}
              />
            </Field>
            <div className="flex justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 gap-1.5 text-muted-foreground md:h-8"
                disabled={!fromId && !toId}
                onClick={() => pick({ from: toId, to: fromId })}
              >
                <ArrowDownUp className="size-4" aria-hidden />
                Invertir
              </Button>
            </div>
            <Field id={`${id}-to`} label="A" required error={errorOf('toTreasuryId')}>
              <TreasurySelect
                id={`${id}-to`}
                value={toId}
                onValueChange={(next) => pick({ to: next })}
                treasuries={treasuries}
                exclude={fromId ? [fromId] : []}
                placeholder="¿Adónde va?"
                invalid={Boolean(errorOf('toTreasuryId'))}
                aria-describedby={describedBy(`${id}-to`, { error: errorOf('toTreasuryId') })}
              />
            </Field>
          </div>

          <MoneyField
            label="Monto"
            required
            value={amount}
            onValueChange={(cents) => {
              setAmount(cents)
              posting.clearFieldError('amountCents')
            }}
            error={errorOf('amountCents')}
            hint={
              goesNegative && from
                ? `${from.name} quedaría en descubierto: ${balanceText(leftover, 'treasury')}.`
                : undefined
            }
          >
            {cardDebt !== null && amount !== cardDebt ? (
              <Button
                type="button"
                variant="link"
                className="h-auto justify-start px-0 text-xs"
                onClick={() => {
                  setAmount(cardDebt)
                  posting.clearFieldError('amountCents')
                }}
              >
                Usar la deuda de la tarjeta: {formatCents(cardDebt)}
              </Button>
            ) : null}
          </MoneyField>

          <div className="grid gap-5 sm:grid-cols-2">
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
            <Field id={`${id}-ref`} label="Referencia" optional error={errorOf('reference')}>
              <Input
                id={`${id}-ref`}
                value={reference}
                maxLength={60}
                autoComplete="off"
                placeholder="Nº de transferencia o depósito"
                className="h-11 text-base md:h-10 md:text-sm"
                aria-invalid={errorOf('reference') ? true : undefined}
                aria-describedby={describedBy(`${id}-ref`, { error: errorOf('reference') })}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          </div>

          <EntryPreview entries={shown} />
          <FormBanner banner={posting.banner} />
        </ActionSheetBody>
        <ActionSheetFooter>
          <SheetCancel />
          <Button type="submit" className="h-11 sm:h-9" disabled={posting.pending}>
            {posting.pending ? 'Guardando…' : submitLabel}
          </Button>
        </ActionSheetFooter>
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
