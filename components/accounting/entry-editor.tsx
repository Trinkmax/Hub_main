'use client'

import { X } from 'lucide-react'
import * as React from 'react'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MoneyField } from '@/components/ui/money-field'
import { focusIfFirstInvalid } from '@/lib/dom/form-control'
import { cn } from '@/lib/utils'
import { AccountPicker } from './account-picker'
import type { AccountNode } from './account-tree'
import { BalanceSeal } from './balance-seal'
import { balanceGapText, entryBalance, hasAmount } from './entry-balance'
import {
  accountPatch,
  amountPatch,
  type EntryEditorLine,
  emptyEntryLine,
  entryEditorBlockMessage,
  entryLinesForPreview,
  initialEntryLines,
  serializeEntryLines,
} from './entry-editor-model'
import { EntryPreview } from './entry-preview'
import { LineItems, type LineItemsApi, type LineItemsProps } from './line-items'
import { createKeyFactory, defaultLineLabel } from './line-items-model'

export type { EntryEditorLine } from './entry-editor-model'

/** Lo que recibe `renderParty`: el partícipe de una línea con cuenta de control. */
export type EntryEditorPartyContext = {
  line: EntryEditorLine
  account: AccountNode
  index: number
  /**
   * «Proveedor o cliente, línea 2»: el nombre accesible del control (la
   * etiqueta que se ve arriba es solo para la vista). Pasalo como `aria-label`
   * del picker o como `label` de un `Field labelHidden`.
   */
  label: string
  update: (patch: Partial<EntryEditorLine>) => void
}

export type EntryEditorProps = Omit<
  LineItemsProps<EntryEditorLine>,
  | 'renderLine'
  | 'newLine'
  | 'defaultLines'
  | 'header'
  | 'footer'
  | 'serialize'
  | 'lineClassName'
  | 'ref'
> & {
  accounts: readonly AccountNode[]
  /** Default: `minLines` líneas vacías. */
  defaultLines?: EntryEditorLine[]
  /** Para acotar el selector de cuentas (las de asientos manuales, por ejemplo). */
  accountFilter?: (account: AccountNode) => boolean
  /**
   * El partícipe de las cuentas de control (H.13): aparece debajo de la línea
   * solo si la cuenta lo pide. Un `EntityPicker` de proveedores y clientes.
   */
  renderParty?: (context: EntryEditorPartyContext) => React.ReactNode
  /** «Vence» en las cuentas de control (H.13). */
  showDueDate?: boolean
  /** En solo lectura, el nombre de cada partícipe por id. */
  partyNames?: Readonly<Record<string, string>>
  /** Default «Líneas del asiento»: el título de la vista en solo lectura. */
  readOnlyTitle?: string
}

/** Cuenta · Debe · Haber · Nota · Quitar: las columnas del asiento desde `md`. */
const GRID =
  'md:grid-cols-[minmax(12rem,2fr)_minmax(8.5rem,1fr)_minmax(8.5rem,1fr)_minmax(8rem,1.25fr)_2rem]'

/** Celular: cada línea es una tarjeta apilada (cuenta a ancho completo, Debe y Haber lado a lado). */
const LINE_CLASSES = cn(
  'grid grid-cols-2 gap-2 rounded-lg border border-border p-3',
  'md:col-span-full md:grid-cols-subgrid md:items-start md:gap-y-2 md:rounded-none md:border-0 md:p-0',
)

/** La etiqueta visible de un control en la tarjeta del celular (en escritorio la da el encabezado). */
function MobileCaption({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="type-caption text-muted-foreground md:hidden">
      {children}
    </span>
  )
}

/** Partícipe y vencimiento van en una fila aparte, sin encabezado de columna: su etiqueta se ve siempre. */
function SubRowCaption({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="type-caption text-muted-foreground">
      {children}
    </span>
  )
}

/**
 * El asiento manual (kit §3.8; apertura, ajustes y sueldos del Sprint 1),
 * sobre `LineItems`.
 *
 * - **Columnas:** Cuenta (`AccountPicker`) · Debe · Haber (`MoneyField`) ·
 *   Nota · Quitar. Escribir un importe en el Debe vacía el Haber de esa línea
 *   y al revés: una línea es de un solo lado.
 * - **Nombres accesibles:** cada control lleva el prefijo de su fila («Cuenta,
 *   línea 2», «Debe, línea 2»); los encabezados de columna son para la vista.
 * - **Pie:** totales de Debe y Haber con la regla contable, lo que falta y el
 *   sello «Cuadra / No cuadra» en la misma región `role="status"` estable de
 *   `EntryPreview` (habla solo cuando cambia).
 * - **Envío:** si no cuadra (o hay menos de dos líneas, o una línea con cuenta
 *   y sin importe), un campo con `setCustomValidity` frena el envío, muestra
 *   el mensaje (el mismo del server) y lleva el foco al pie. El server vuelve a
 *   sumar en `BigInt` y la RPC rechaza lo que no cuadre.
 * - **Teclado:** Tab entre celdas; Enter en la nota de la última línea agrega
 *   otra.
 * - **Celular:** cada línea es una tarjeta (sin `mobile="cards"`: duplicaría
 *   los campos en el `FormData`).
 * - **Solo lectura** (rol Contabilidad, período cerrado): se dibuja como
 *   `EntryPreview`, sin controles.
 *
 * El `hidden` (`name`) lleva las líneas como las lee `manualEntrySchema`:
 * `accountId`, `debitCents`, `creditCents`, `partyId`, `dueDate`, `memo`.
 */
function EntryEditor({
  accounts,
  name,
  maxLines,
  defaultLines,
  lines: linesProp,
  onLinesChange,
  minLines = 2,
  lineLabel = defaultLineLabel,
  accountFilter,
  renderParty,
  showDueDate = false,
  partyNames,
  readOnly = false,
  readOnlyTitle = 'Líneas del asiento',
  addLabel = 'Agregar línea',
  className,
  ...props
}: EntryEditorProps) {
  const [startLines] = React.useState(() => defaultLines ?? initialEntryLines(minLines))
  const controlled = linesProp !== undefined
  const [innerLines, setInnerLines] = React.useState<EntryEditorLine[]>(startLines)
  const lines = controlled ? linesProp : innerLines
  const accountsById = React.useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  )
  const [nextKey] = React.useState(() => createKeyFactory('n'))
  const footerRef = React.useRef<HTMLDivElement>(null)
  const validityRef = React.useRef<HTMLInputElement>(null)
  const [showError, setShowError] = React.useState(false)

  const balance = entryBalance(lines)
  const blockMessage = readOnly ? null : entryEditorBlockMessage(lines, lineLabel)
  if (showError && blockMessage === null) setShowError(false)

  // Lo que no se puede mandar frena el envío del formulario.
  React.useEffect(() => {
    validityRef.current?.setCustomValidity(blockMessage ?? '')
  }, [blockMessage])

  if (readOnly) {
    return (
      <EntryPreview
        lines={entryLinesForPreview(lines, accountsById, partyNames)}
        title={readOnlyTitle}
        emptyText="El asiento no tiene líneas."
        className={className}
        {...props}
      />
    )
  }

  function handleLinesChange(next: EntryEditorLine[]) {
    if (!controlled) setInnerLines(next)
    onLinesChange?.(next)
  }

  function newLine(): EntryEditorLine {
    const used = new Set(lines.map((line) => line.key))
    let key = nextKey()
    while (used.has(key)) key = nextKey()
    return emptyEntryLine(key)
  }

  function renderLine(line: EntryEditorLine, index: number, api: LineItemsApi<EntryEditorLine>) {
    const account = line.accountId ? (accountsById.get(line.accountId) ?? null) : null
    const lineHasAmount = hasAmount(line.debitCents) || hasAmount(line.creditCents)
    const isLast = index === lines.length - 1
    const party =
      account?.requiresParty && (renderParty || showDueDate) ? (
        <div
          data-slot="entry-editor-party"
          className="col-span-2 grid gap-2 sm:grid-cols-2 md:col-span-4 md:col-start-1"
        >
          {renderParty ? (
            <div className="grid gap-1">
              <SubRowCaption>Proveedor o cliente</SubRowCaption>
              {renderParty({
                line,
                account,
                index,
                label: api.controlLabel('Proveedor o cliente'),
                update: api.update,
              })}
            </div>
          ) : null}
          {showDueDate ? (
            <div className="grid gap-1">
              <SubRowCaption>Vence</SubRowCaption>
              <Field label={api.controlLabel('Vence')} labelHidden>
                <DatePicker
                  size="sm"
                  value={line.dueDate ?? null}
                  onValueChange={(iso) => api.update({ dueDate: iso })}
                />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null

    return (
      <>
        <div className="col-span-2 grid gap-1 md:col-span-1">
          <MobileCaption>Cuenta</MobileCaption>
          <Field label={api.controlLabel('Cuenta')} labelHidden>
            <AccountPicker
              size="sm"
              accounts={accounts}
              filter={accountFilter}
              value={line.accountId}
              required={lineHasAmount}
              onAccountChange={(chosen) =>
                api.update(accountPatch(chosen?.id ?? null, chosen ?? null))
              }
            />
          </Field>
        </div>
        <div className="grid gap-1">
          <MobileCaption>Debe</MobileCaption>
          <Field label={api.controlLabel('Debe')} labelHidden>
            <MoneyField
              size="sm"
              cents={line.debitCents}
              onCentsChange={(cents) => api.update(amountPatch('debit', cents))}
            />
          </Field>
        </div>
        <div className="grid gap-1">
          <MobileCaption>Haber</MobileCaption>
          <Field label={api.controlLabel('Haber')} labelHidden>
            <MoneyField
              size="sm"
              cents={line.creditCents}
              onCentsChange={(cents) => api.update(amountPatch('credit', cents))}
            />
          </Field>
        </div>
        {/* Nota y «Quitar»: en el celular, en la misma fila de la tarjeta; desde md,
            `contents` los deja como dos celdas de la grilla (sin reordenar el DOM). */}
        <div className="col-span-2 flex items-end gap-2 md:contents">
          <div className="grid min-w-0 flex-1 gap-1">
            <MobileCaption>Nota</MobileCaption>
            <Field label={api.controlLabel('Nota')} labelHidden>
              <Input
                size="sm"
                value={line.note ?? ''}
                maxLength={200}
                autoComplete="off"
                onChange={(event) => api.update({ note: event.target.value })}
                onKeyDown={(event) => {
                  // Enter en la última línea agrega otra (en vez de enviar el formulario).
                  if (
                    event.key === 'Enter' &&
                    isLast &&
                    api.canAdd &&
                    !event.shiftKey &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    api.add()
                  }
                }}
              />
            </Field>
          </div>
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
        {party}
      </>
    )
  }

  const header = (
    <div
      aria-hidden="true"
      data-slot="entry-editor-header"
      className="hidden type-label text-muted-foreground md:col-span-full md:grid md:grid-cols-subgrid"
    >
      <span>Cuenta</span>
      <span className="text-end">Debe</span>
      <span className="text-end">Haber</span>
      <span>Nota</span>
      <span />
    </div>
  )

  const footer = (
    <>
      <div
        ref={footerRef}
        tabIndex={-1}
        data-slot="entry-editor-footer"
        data-status={balance.status}
        className={cn(
          'col-span-full grid grid-cols-2 items-center gap-x-2 gap-y-2 py-3',
          // La regla contable: raya simple arriba y doble abajo.
          'border-t border-rule border-b-[3px] border-b-rule [border-bottom-style:double]',
          'outline-offset-2 outline-(--ring) focus-visible:outline-2',
          'md:grid-cols-subgrid',
        )}
      >
        <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1">
          <span className="type-label text-foreground">Totales</span>
          <BalanceSeal status={balance.status} diffCents={balance.diff} />
        </div>
        <div className="flex items-baseline justify-between gap-2 md:justify-end">
          <span className="type-caption text-muted-foreground md:sr-only">Debe</span>
          <Amount cents={balance.debit} className="font-semibold" />
        </div>
        <div className="flex items-baseline justify-between gap-2 md:justify-end">
          <span className="type-caption text-muted-foreground md:sr-only">Haber</span>
          <Amount cents={balance.credit} className="font-semibold" />
        </div>
        <div className="col-span-2 type-small text-muted-foreground">
          {balance.gap ? balanceGapText(balance.gap) : null}
        </div>
      </div>
      {showError && blockMessage ? (
        <p
          role="alert"
          data-slot="entry-editor-error"
          className="col-span-full flex items-start gap-1 type-small text-destructive-text"
        >
          {blockMessage}
        </p>
      ) : null}
      {/* Frena el envío si el asiento no se puede mandar (el `hidden` no participa de la validación). */}
      <input
        ref={validityRef}
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="off"
        data-slot="entry-editor-validity"
        className="sr-only"
        onInvalid={(event) => {
          event.preventDefault()
          setShowError(true)
          if (footerRef.current) focusIfFirstInvalid(footerRef.current)
        }}
      />
    </>
  )

  return (
    <LineItems<EntryEditorLine>
      data-slot="entry-editor"
      {...props}
      name={name}
      maxLines={maxLines}
      lines={lines}
      defaultLines={startLines}
      onLinesChange={handleLinesChange}
      minLines={minLines}
      lineLabel={lineLabel}
      newLine={newLine}
      renderLine={renderLine}
      addLabel={addLabel}
      serialize={serializeEntryLines}
      header={header}
      footer={footer}
      lineClassName={LINE_CLASSES}
      className={cn('grid gap-2 md:gap-x-2', GRID, className)}
    />
  )
}

export { EntryEditor }
