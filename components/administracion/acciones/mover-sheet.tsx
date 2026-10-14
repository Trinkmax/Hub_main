'use client'

import { ArrowDown, ArrowDownUp, ArrowRight, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { postTransfer } from '@/lib/accounting/actions/documents'
import { type TreasuryTone, treasuryTones } from '@/lib/accounting/home'
import type { TransferValues } from '@/lib/accounting/server/document-types'
import { cn } from '@/lib/utils'
import {
  ACTION_SHEET_QUESTION_FIELD,
  ActionSheetBody,
  ActionSheetFooter,
  ActionSheetHeader,
} from '../action-sheet'
import { loadCajasVentasCatalog } from '../cajas-ventas/data'
import { FormBanner, WarningsDialog } from '../cajas-ventas/feedback'
import { moneyLabel } from '../cajas-ventas/money'
import {
  firstLoadableDay,
  SheetFailed,
  SheetLoading,
  useDocumentPreview,
} from '../cajas-ventas/sheet-frame'
import type { CajasVentasCatalog, SheetTreasury } from '../cajas-ventas/types'
import { usePosting, useUndoToast } from '../cajas-ventas/use-posting'
import { useSheetLoad } from '../cajas-ventas/use-sheet-load'
import { DateField } from '../date-input'
import { EntryPreview } from '../entry-preview'
import { WalletCard } from '../kit'
import { MoneyField } from '../money-input'
import { TreasuryPicker } from '../treasury-picker'
import { type TreasuryAfterWords, treasuryMoneyText } from './gasto-papel'
import {
  cardDebtOf,
  type MoveShortcut,
  moveAfter,
  moveInitial,
  movePair,
  moveShortcuts,
} from './mover-vista'
import {
  ADD_LINK,
  BIG_MONEY_FIELD,
  SHEET_QUESTION_BLOCK,
  SheetQuestion,
  TEXT_LINK,
} from './sheet-parts'
import { ACTION_TITLES, type ActionSheetProps } from './types'

const TITLE = ACTION_TITLES.mover
const DESCRIPTION = 'De una caja a otra. No es un gasto ni un pago.'

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

const KNOWN_FIELDS = new Set(['fromTreasuryId', 'toTreasuryId', 'amountCents', 'date', 'reference'])

/** Una píldora de atajo: la elegida va rellena, como todas las de las hojas. */
const SHORTCUT =
  'inline-flex min-h-11 max-w-full items-center rounded-full border px-4 py-1.5 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9'

function ShortcutPills({
  labelledBy,
  options,
  fromId,
  toId,
  onPick,
}: {
  labelledBy: string
  options: readonly MoveShortcut[]
  fromId: string | null
  toId: string | null
  onPick: (option: MoveShortcut) => void
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: grupo de botones que se aprietan (atajos), con su pregunta como etiqueta
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = fromId === option.from && toId === option.to
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(option)}
            className={cn(
              SHORTCUT,
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-secondary',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** «hoy $ 394.757 → queda $ 194.757»: cada número con su rótulo. */
function AfterWords({ words, short }: { words: TreasuryAfterWords; short: boolean }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
      <span className="text-muted-foreground">
        {words.before.label} <span className="tabular-nums">{words.before.amount}</span>
      </span>
      <span className="inline-flex items-baseline gap-x-1.5 whitespace-nowrap">
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
        <span className="sr-only">después:</span>
        <span className={cn(short && 'text-warning-text')}>
          {words.after.label}{' '}
          <span className="font-semibold tabular-nums">{words.after.amount}</span>
        </span>
      </span>
    </p>
  )
}

/** Sin importe todavía: lo que tiene hoy esa caja («Tiene $ 394.757», «Deuda $ 80.000»). */
function Holds({ treasury }: { treasury: Pick<SheetTreasury, 'kind' | 'balanceCents'> }) {
  const text = treasuryMoneyText(treasury.kind, treasury.balanceCents)
  const plain = treasury.kind !== 'credit_card' && treasury.balanceCents >= 0
  return (
    <p className="text-sm text-muted-foreground tabular-nums">{plain ? `Tiene ${text}` : text}</p>
  )
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
  const amountRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const { treasuries, today } = catalog
  const byId = useMemo(() => new Map(treasuries.map((t) => [t.id, t])), [treasuries])
  const shortcuts = useMemo(() => moveShortcuts(treasuries), [treasuries])
  const pair = useMemo(() => movePair(treasuries), [treasuries])
  const tones = useMemo(() => treasuryTones(treasuries), [treasuries])

  // La caja de la URL va como origen; una tarjeta de la empresa, como destino.
  const [initial] = useState(() => moveInitial(treasuries, params.caja))
  const [fromId, setFromId] = useState<string | null>(initial.fromId)
  const [toId, setToId] = useState<string | null>(initial.toId)
  const [amount, setAmount] = useState<number | null>(null)
  const [date, setDate] = useState<string | null>(today)
  const [reference, setReference] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [referenceOpen, setReferenceOpen] = useState(false)

  const from = fromId ? byId.get(fromId) : undefined
  const to = toId ? byId.get(toId) : undefined

  const dirty =
    fromId !== initial.fromId || toId !== initial.toId || amount !== null || reference.trim() !== ''
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

  const after = moveAfter(from, to, amount)
  const cardDebt = cardDebtOf(to)

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
  const fromError = errorOf('fromTreasuryId')
  const toError = errorOf('toTreasuryId')
  const onlyTwo = pair.length === 2

  return (
    <>
      <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
      <form ref={formRef} noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <ActionSheetBody>
          {onlyTwo ? (
            // Con dos cajas no hay nada más que elegir: de cuál a cuál.
            <div className={SHEET_QUESTION_BLOCK}>
              <SheetQuestion id={`${id}-pair`} required>
                ¿De dónde a dónde?
              </SheetQuestion>
              <div
                aria-invalid={fromError || toError ? true : undefined}
                tabIndex={-1}
                className="outline-none"
              >
                <ShortcutPills
                  labelledBy={`${id}-pair`}
                  options={pair}
                  fromId={fromId}
                  toId={toId}
                  onPick={(option) => {
                    pick({ from: option.from, to: option.to })
                    amountRef.current?.focus()
                  }}
                />
              </div>
              {fromError || toError ? (
                <p role="alert" className="text-xs text-destructive">
                  Elegí de dónde a dónde va la plata.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              {shortcuts.length > 0 ? (
                <div className={SHEET_QUESTION_BLOCK}>
                  <span id={`${id}-common`} className="text-sm font-medium text-muted-foreground">
                    Lo más común
                  </span>
                  <ShortcutPills
                    labelledBy={`${id}-common`}
                    options={shortcuts}
                    fromId={fromId}
                    toId={toId}
                    onPick={(option) => {
                      pick({ from: option.from, to: option.to })
                      amountRef.current?.focus()
                    }}
                  />
                </div>
              ) : null}

              <div className={SHEET_QUESTION_BLOCK}>
                <SheetQuestion id={`${id}-from-label`} required>
                  ¿De dónde sale?
                </SheetQuestion>
                <TreasuryPicker
                  id={`${id}-from`}
                  aria-labelledby={`${id}-from-label`}
                  value={fromId}
                  onValueChange={(next) => pick({ from: next })}
                  treasuries={treasuries}
                  exclude={toId ? [toId] : []}
                  placeholder="¿De dónde sale la plata?"
                  invalid={Boolean(fromError)}
                  aria-describedby={fromError ? `${id}-from-error` : undefined}
                />
                {fromError ? (
                  <p id={`${id}-from-error`} role="alert" className="text-xs text-destructive">
                    {fromError}
                  </p>
                ) : null}
                <button
                  type="button"
                  className={cn(
                    TEXT_LINK,
                    'gap-1.5 justify-self-start text-sm disabled:pointer-events-none disabled:opacity-50',
                  )}
                  disabled={!fromId && !toId}
                  onClick={() => pick({ from: toId, to: fromId })}
                >
                  <ArrowDownUp className="size-4" aria-hidden />
                  Dar vuelta
                </button>
              </div>

              <div className={SHEET_QUESTION_BLOCK}>
                <SheetQuestion id={`${id}-to-label`} required>
                  ¿A dónde va?
                </SheetQuestion>
                <TreasuryPicker
                  id={`${id}-to`}
                  aria-labelledby={`${id}-to-label`}
                  value={toId}
                  onValueChange={(next) => pick({ to: next })}
                  treasuries={treasuries}
                  exclude={fromId ? [fromId] : []}
                  placeholder="¿A dónde va?"
                  invalid={Boolean(toError)}
                  aria-describedby={toError ? `${id}-to-error` : undefined}
                />
                {toError ? (
                  <p id={`${id}-to-error`} role="alert" className="text-xs text-destructive">
                    {toError}
                  </p>
                ) : null}
              </div>
            </>
          )}

          <MoneyField
            inputRef={amountRef}
            label="¿Cuánto?"
            fieldClassName={ACTION_SHEET_QUESTION_FIELD}
            className={BIG_MONEY_FIELD}
            required
            value={amount}
            onValueChange={(cents) => {
              setAmount(cents)
              posting.clearFieldError('amountCents')
            }}
            error={errorOf('amountCents')}
          >
            {cardDebt !== null && amount !== cardDebt ? (
              <button
                type="button"
                className={cn(SHORTCUT, 'justify-self-start border-border hover:bg-secondary')}
                onClick={() => {
                  setAmount(cardDebt)
                  posting.clearFieldError('amountCents')
                }}
              >
                Usar lo que debés: {moneyLabel(cardDebt)}
              </button>
            ) : null}
          </MoneyField>

          {/* El pase, dibujado: las dos cajas con una flecha y cómo queda cada una. */}
          {from && to ? (
            <div className="grid gap-2">
              <div className="grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <PassSide label="Sale de" treasury={from} tone={tones[from.id] ?? null}>
                  {after.from?.words ? (
                    <AfterWords words={after.from.words} short={after.short} />
                  ) : (
                    <Holds treasury={from} />
                  )}
                </PassSide>
                <span
                  aria-hidden
                  className="flex items-center justify-center text-muted-foreground"
                >
                  <ArrowDown className="size-5 sm:hidden" />
                  <ArrowRight className="size-5 max-sm:hidden" />
                </span>
                <PassSide label="Entra a" treasury={to} tone={tones[to.id] ?? null}>
                  {after.to?.words ? (
                    <AfterWords words={after.to.words} short={false} />
                  ) : (
                    <Holds treasury={to} />
                  )}
                </PassSide>
              </div>
              {after.short ? (
                <p className="text-xs text-warning-text text-pretty">
                  Con lo cargado hasta hoy no alcanza. ¿Falta cargar lo que había, algún ingreso o
                  el cierre del día? Lo podés guardar igual.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Lo demás: la fecha y el n.º de operación. Una raya lo separa de las preguntas. */}
          <div className="space-y-5 border-t border-border/60 pt-6">
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
            {referenceOpen || reference !== '' || errorOf('reference') ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-ref`}>
                  N.º de operación{' '}
                  <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Input
                  id={`${id}-ref`}
                  value={reference}
                  maxLength={60}
                  autoComplete="off"
                  className="h-11 text-base md:h-10 md:text-sm"
                  aria-invalid={errorOf('reference') ? true : undefined}
                  aria-describedby={errorOf('reference') ? `${id}-ref-error` : undefined}
                  onChange={(e) => setReference(e.target.value)}
                />
                {errorOf('reference') ? (
                  <p id={`${id}-ref-error`} role="alert" className="text-xs text-destructive">
                    {errorOf('reference')}
                  </p>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className={ADD_LINK}
                onClick={() => {
                  setReferenceOpen(true)
                  // El botón desaparece: el foco sigue en el campo que lo reemplaza.
                  requestAnimationFrame(() => document.getElementById(`${id}-ref`)?.focus())
                }}
              >
                <Plus className="size-3.5" aria-hidden />
                Agregar el n.º de operación
              </button>
            )}
          </div>

          <EntryPreview entries={shown} label="Ver cómo queda en los libros" />

          <p className="text-xs text-muted-foreground text-pretty">
            Si un socio se llevó plata, le pagaste a un proveedor o el banco te cobró algo, no es
            mover: cerrá esto y cargalo desde «＋ Cargar».
          </p>
          <FormBanner banner={posting.banner} />
        </ActionSheetBody>
        <ActionSheetFooter>
          <Button type="submit" disabled={posting.pending}>
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

/** Un lado del pase: de dónde sale o a dónde entra, con la tarjeta de esa caja. */
function PassSide({
  label,
  treasury,
  tone,
  children,
}: {
  label: string
  treasury: SheetTreasury
  tone: TreasuryTone | null
  children: ReactNode
}) {
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <WalletCard
        size="sm"
        name={treasury.name}
        kind={treasury.kind}
        tone={tone}
        className="h-full"
      >
        {children}
      </WalletCard>
    </div>
  )
}
