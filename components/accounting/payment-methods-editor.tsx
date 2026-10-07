'use client'

import { X } from 'lucide-react'
import * as React from 'react'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { Combobox, type EntityOption } from '@/components/ui/combobox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MoneyField } from '@/components/ui/money-field'
import { focusIfFirstInvalid } from '@/lib/dom/form-control'
import { formatCents } from '@/lib/money/format'
import { cn } from '@/lib/utils'
import { BalanceSeal } from './balance-seal'
import { hasAmount } from './entry-balance'
import { LineItems, type LineItemsApi, type LineItemsProps } from './line-items'
import { createKeyFactory, defaultLineLabel } from './line-items-model'
import {
  type PaymentMethodLine,
  type PaymentMethodsBalance,
  paymentMethodsBalance,
  paymentMethodsBlockMessage,
  paymentMethodsGapText,
  remainderCents,
  serializePaymentMethods,
} from './payment-methods-model'

export type { PaymentMethodLine } from './payment-methods-model'

/** Una caja, banco o billetera elegible, con su saldo chico al costado. */
export type TreasuryOption = {
  id: string
  name: string
  /** «Alias hub.cafe.mp», «CBU …1234». */
  description?: string
  /** Saldo de libro (se muestra sin centavos, como dato de apoyo). */
  balanceCents?: number | bigint | null
}

export type PaymentMethodsEditorProps = Omit<
  LineItemsProps<PaymentMethodLine>,
  | 'renderLine'
  | 'newLine'
  | 'defaultLines'
  | 'header'
  | 'footer'
  | 'serialize'
  | 'lineClassName'
  | 'ref'
> & {
  treasuries: readonly TreasuryOption[]
  /** Default: una línea vacía (o con la meta, si hay una sola caja). */
  defaultLines?: PaymentMethodLine[]
  /** Lo que hay que cubrir (lo que se paga o lo que entró). Sin esto, los medios solo suman. */
  targetCents?: number | bigint | null
  /** `payment` (default): `paymentSchema.methods` · `collection`: `collectionSchema.received`. */
  shape?: 'payment' | 'collection'
  /** Default `true`: «Ref.» (número de transferencia, de cheque o de liquidación). */
  showReference?: boolean
  /** Default: `true` si hay `targetCents`. Frena el envío hasta que los medios cubran la meta justo. */
  requireExact?: boolean
  /** Default «Con» (pagar); en un cobro, «Entró a». */
  methodLabel?: string
}

const GRID_WITH_REFERENCE =
  'md:grid-cols-[minmax(12rem,2fr)_minmax(9rem,1fr)_minmax(7rem,1fr)_2rem]'
const GRID_WITHOUT_REFERENCE = 'md:grid-cols-[minmax(12rem,2fr)_minmax(9rem,1fr)_2rem]'

const LINE_CLASSES = cn(
  'grid grid-cols-2 gap-2 rounded-lg border border-border p-3',
  'md:col-span-full md:grid-cols-subgrid md:items-start md:rounded-none md:border-0 md:p-0',
)

const STATUS_TO_SEAL = {
  empty: 'empty',
  balanced: 'balanced',
  short: 'unbalanced',
  over: 'unbalanced',
  untargeted: 'empty',
} as const

function MobileCaption({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="type-caption text-muted-foreground md:hidden">
      {children}
    </span>
  )
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}

function sealLabels(balance: PaymentMethodsBalance) {
  return {
    balanced: 'Completo',
    unbalanced: balance.status === 'over' ? 'Sobra' : 'Falta asignar',
    empty: 'Sin importes',
  }
}

/**
 * Los medios de una orden de pago o de un cobro (H.8 «Pagar», H.10 «Cobrar»)
 * sobre `LineItems`: Con (caja, banco o billetera) · Importe · Ref. · Quitar.
 *
 * - «Otro medio» agrega una fila con lo que falta para llegar a la meta.
 * - **Pie en vivo:** «Asignado $ X de $ Y», «Falta asignar $ 240.000,00 a un
 *   medio» y el sello «Completo / Falta asignar / Sobra» en la región
 *   `role="status"` estable (habla solo cuando cambia el estado).
 * - Con meta, el envío se frena hasta que los medios la cubran justo, con el
 *   foco en el pie.
 * - El `hidden` (`name`) lleva lo que leen `paymentSchema.methods` (con
 *   `type: 'treasury'`) o `collectionSchema.received`.
 */
function PaymentMethodsEditor({
  treasuries,
  name,
  maxLines,
  defaultLines,
  lines: linesProp,
  onLinesChange,
  targetCents,
  shape = 'payment',
  showReference = true,
  requireExact,
  methodLabel = 'Con',
  minLines = 1,
  lineLabel = defaultLineLabel,
  readOnly = false,
  addLabel = 'Otro medio',
  className,
  ...props
}: PaymentMethodsEditorProps) {
  const [startLines] = React.useState<PaymentMethodLine[]>(() => {
    if (defaultLines) return defaultLines
    const only = treasuries.length === 1 ? (treasuries[0]?.id ?? null) : null
    const target =
      targetCents === null || targetCents === undefined ? null : Number(targetCents) || null
    return Array.from({ length: Math.max(1, minLines) }, (_, i) => ({
      key: `m${i.toString()}`,
      treasuryAccountId: i === 0 ? only : null,
      amountCents: i === 0 ? target : null,
      reference: '',
    }))
  })
  const controlled = linesProp !== undefined
  const [innerLines, setInnerLines] = React.useState<PaymentMethodLine[]>(startLines)
  const lines = controlled ? linesProp : innerLines
  const [nextKey] = React.useState(() => createKeyFactory('p'))
  const footerRef = React.useRef<HTMLDivElement>(null)
  const validityRef = React.useRef<HTMLInputElement>(null)
  const [showError, setShowError] = React.useState(false)

  const balance = paymentMethodsBalance(lines, targetCents)
  const exact = requireExact ?? (targetCents !== null && targetCents !== undefined)
  const blockMessage = readOnly || !exact ? null : paymentMethodsBlockMessage(balance)
  if (showError && blockMessage === null) setShowError(false)

  React.useEffect(() => {
    validityRef.current?.setCustomValidity(blockMessage ?? '')
  }, [blockMessage])

  const options = React.useMemo<EntityOption<TreasuryOption>[]>(
    () =>
      treasuries.map((treasury) => ({
        value: treasury.id,
        label: treasury.name,
        description: treasury.description,
        meta:
          treasury.balanceCents === null || treasury.balanceCents === undefined ? undefined : (
            <Amount cents={treasury.balanceCents} decimals={0} />
          ),
        data: treasury,
      })),
    [treasuries],
  )
  const nameById = React.useMemo(
    () => new Map(treasuries.map((treasury) => [treasury.id, treasury.name])),
    [treasuries],
  )

  function handleLinesChange(next: PaymentMethodLine[]) {
    if (!controlled) setInnerLines(next)
    onLinesChange?.(next)
  }

  function newLine(): PaymentMethodLine {
    const used = new Set(lines.map((line) => line.key))
    let key = nextKey()
    while (used.has(key)) key = nextKey()
    return {
      key,
      treasuryAccountId: null,
      amountCents: remainderCents(lines, targetCents),
      reference: '',
    }
  }

  function renderLine(
    line: PaymentMethodLine,
    _index: number,
    api: LineItemsApi<PaymentMethodLine>,
  ) {
    if (api.readOnly) {
      return (
        <>
          <span className="col-span-2 type-body text-foreground md:col-span-1">
            {line.treasuryAccountId ? (nameById.get(line.treasuryAccountId) ?? '—') : '—'}
          </span>
          <Amount cents={line.amountCents} className="text-end" />
          {showReference ? (
            <span className="type-small text-muted-foreground">
              {line.reference?.trim() || null}
            </span>
          ) : null}
          <span />
        </>
      )
    }
    return (
      <>
        <div className="col-span-2 grid gap-1 md:col-span-1">
          <MobileCaption>{methodLabel}</MobileCaption>
          <Field label={api.controlLabel(methodLabel)} labelHidden>
            <Combobox<TreasuryOption>
              size="sm"
              options={options}
              value={line.treasuryAccountId}
              required={hasAmount(line.amountCents)}
              placeholder="Elegí la caja o cuenta…"
              onValueChange={(value) =>
                api.update({ treasuryAccountId: typeof value === 'string' ? value : null })
              }
            />
          </Field>
        </div>
        {/* Importe, Ref. y «Quitar»: en el celular, en una fila; desde md, `contents`
            los deja como celdas de la grilla (sin reordenar el DOM). */}
        <div className="col-span-2 flex items-end gap-2 md:contents">
          <div className="grid min-w-0 flex-1 gap-1">
            <MobileCaption>Importe</MobileCaption>
            <Field label={api.controlLabel('Importe')} labelHidden>
              <MoneyField
                size="sm"
                cents={line.amountCents}
                onCentsChange={(cents) => api.update({ amountCents: cents })}
              />
            </Field>
          </div>
          {showReference ? (
            // En el celular, la referencia más angosta: el importe necesita el lugar.
            <div className="grid min-w-0 gap-1 max-md:w-28 max-md:shrink-0">
              <MobileCaption>Ref.</MobileCaption>
              <Field label={api.controlLabel('Referencia')} labelHidden>
                <Input
                  size="sm"
                  value={line.reference ?? ''}
                  maxLength={60}
                  autoComplete="off"
                  onChange={(event) => api.update({ reference: event.target.value })}
                />
              </Field>
            </div>
          ) : null}
          <div className="shrink-0">
            {api.canRemove ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Quitar ${api.label.charAt(0).toLowerCase()}${api.label.slice(1)}`}
                onClick={api.remove}
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
      </>
    )
  }

  const columns = showReference ? 4 : 3
  const header = (
    <div
      aria-hidden="true"
      data-slot="payment-methods-header"
      className="hidden type-label text-muted-foreground md:col-span-full md:grid md:grid-cols-subgrid"
    >
      <span>{methodLabel}</span>
      <span className="text-end">Importe</span>
      {showReference ? <span>Ref.</span> : null}
      <span />
    </div>
  )

  const gapText = paymentMethodsGapText(balance)
  const footer = (
    <>
      <div
        ref={footerRef}
        tabIndex={-1}
        data-slot="payment-methods-footer"
        data-status={balance.status}
        className={cn(
          'col-span-full flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3',
          'outline-offset-2 outline-(--ring) focus-visible:outline-2',
        )}
      >
        <span className="type-small text-muted-foreground">
          {balance.target === null ? (
            <>
              {'Total '}
              <Amount cents={balance.assigned} className="font-semibold text-foreground" />
            </>
          ) : (
            <>
              {'Asignado '}
              <Amount cents={balance.assigned} className="font-semibold text-foreground" />
              {` de ${formatCents(balance.target)}`}
            </>
          )}
          {gapText ? <span className="block">{gapText}</span> : null}
        </span>
        {balance.target !== null ? (
          <BalanceSeal
            status={STATUS_TO_SEAL[balance.status]}
            diffCents={balance.diff}
            labels={sealLabels(balance)}
            diffText={(diff) => formatCents(absolute(diff))}
          />
        ) : null}
      </div>
      {showError && blockMessage ? (
        <p
          role="alert"
          data-slot="payment-methods-error"
          className="col-span-full type-small text-destructive-text"
        >
          {blockMessage}
        </p>
      ) : null}
      {readOnly ? null : (
        <input
          ref={validityRef}
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="off"
          data-slot="payment-methods-validity"
          className="sr-only"
          onInvalid={(event) => {
            event.preventDefault()
            setShowError(true)
            if (footerRef.current) focusIfFirstInvalid(footerRef.current)
          }}
        />
      )}
    </>
  )

  return (
    <LineItems<PaymentMethodLine>
      data-slot="payment-methods-editor"
      data-columns={columns}
      {...props}
      name={readOnly ? undefined : name}
      maxLines={maxLines}
      lines={lines}
      defaultLines={startLines}
      onLinesChange={handleLinesChange}
      minLines={minLines}
      lineLabel={lineLabel}
      readOnly={readOnly}
      newLine={newLine}
      renderLine={renderLine}
      addLabel={addLabel}
      serialize={(current) => serializePaymentMethods(current, shape)}
      header={header}
      footer={footer}
      lineClassName={LINE_CLASSES}
      className={cn(
        'grid gap-2 md:gap-x-2',
        showReference ? GRID_WITH_REFERENCE : GRID_WITHOUT_REFERENCE,
        className,
      )}
    />
  )
}

export { PaymentMethodsEditor }
