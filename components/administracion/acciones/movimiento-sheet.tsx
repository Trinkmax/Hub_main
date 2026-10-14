'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { postCashMovement } from '@/lib/accounting/actions/documents'
import type { CashMovementValues } from '@/lib/accounting/server/document-types'
import { VAT_ACCOUNT_KEYS } from '@/lib/accounting/system-keys'
import { formatWeekdayDayMonth } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { AccountCombobox } from '../account-combobox'
import {
  ACTION_SHEET_QUESTION_FIELD,
  ActionSheetBody,
  ActionSheetFooter,
  ActionSheetHeader,
} from '../action-sheet'
import { loadCajasVentasCatalog } from '../cajas-ventas/data'
import { FormBanner, WarningsDialog } from '../cajas-ventas/feedback'
import { moneyLabel } from '../cajas-ventas/money'
import { QuickPartyDialog } from '../cajas-ventas/quick-party-dialog'
import {
  firstLoadableDay,
  SheetFailed,
  SheetLoading,
  useDocumentPreview,
} from '../cajas-ventas/sheet-frame'
import type { CajasVentasCatalog, SheetAccount } from '../cajas-ventas/types'
import { usePosting, useUndoToast } from '../cajas-ventas/use-posting'
import { useSheetLoad } from '../cajas-ventas/use-sheet-load'
import { DateField } from '../date-input'
import { EntryPreview } from '../entry-preview'
import { Ticket, TicketHeader, TicketNote, TicketRow, TicketRule, TicketTotal } from '../kit'
import { MoneyField } from '../money-input'
import { PartyCombobox, type PartyOption } from '../party-combobox'
import { TreasuryPicker } from '../treasury-picker'
import { TreasuryAfterLine } from './gasto-piezas'
import {
  accountPlaceholder,
  accountQuestion,
  applySituation,
  booksEmptyText,
  MOTIVE_ACCOUNT,
  type MoveDirection,
  type MoveMotive,
  motiveStillValid,
  movementSubmitLabel,
  otherWarning,
  type Situation,
  situationGroups,
  treasuryForSituation,
  treasuryQuestion,
  voucherNote,
  voucherTotalLabel,
} from './movimiento-vista'
import { ADD_LINK, BIG_MONEY_FIELD, SHEET_QUESTION_BLOCK, SheetQuestion } from './sheet-parts'
import { ACTION_TITLES, type ActionSheetProps } from './types'

const TITLE = ACTION_TITLES.movimiento
const DESCRIPTION = 'Plata que entra o sale de una caja y no es una venta, un gasto ni un pago.'

/**
 * Hoja «Otra entrada o salida» (H.11, E.5.12): el vale de caja. La caja contra
 * una contrapartida, para lo que no es una venta, un gasto ni un pago: un socio
 * que saca o pone plata, una seña, un préstamo.
 */
export function MovimientoSheet(props: ActionSheetProps) {
  const { tenantSlug } = props
  const load = useSheetLoad(() => loadCajasVentasCatalog(tenantSlug), tenantSlug)
  if (!load.data) {
    if (load.status === 'error') {
      return <SheetFailed title={TITLE} message={load.message} onRetry={() => load.reload()} />
    }
    return <SheetLoading title={TITLE} description={DESCRIPTION} />
  }
  return (
    <MovimientoForm
      {...props}
      catalog={load.data}
      reloadCatalog={() => load.reload({ silent: true })}
    />
  )
}

type Direction = MoveDirection
type Motive = MoveMotive

const KNOWN_FIELDS = new Set([
  'treasuryAccountId',
  'direction',
  'counterpartAccountId',
  'partyId',
  'amountCents',
  'date',
  'shortcut',
  'detail',
])

/** Cuentas de socios: el partícipe es un socio (se puede crear acá). */
const PARTNER_ACCOUNT_KEYS = new Set(['partners_current', 'partner_loans'])

const VAT_KEYS: ReadonlySet<string> = new Set(VAT_ACCOUNT_KEYS)

const EMPTY = '—'

/**
 * Un link adentro de una oración. Es un `<button>` (un bloque en línea): con
 * alto mínimo o relleno vertical estira el renglón en el que está, así que no
 * lleva ninguno de los dos.
 */
const INLINE_LINK =
  'cursor-pointer rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring'

/** Una píldora de situación: la elegida va rellena, como todas las de las hojas. */
const SITUATION =
  'inline-flex min-h-11 max-w-full items-center rounded-full border px-4 py-1.5 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9'

function MovimientoForm({
  tenantSlug,
  params,
  close,
  setDirty,
  catalog,
  reloadCatalog,
}: ActionSheetProps & { catalog: CajasVentasCatalog; reloadCatalog: () => void }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const id = useId()
  const { today } = catalog
  // Una tarjeta de la empresa no es una caja con plata: no entra acá.
  const treasuries = useMemo(
    () => catalog.treasuries.filter((t) => t.kind !== 'credit_card'),
    [catalog.treasuries],
  )
  const accountsBySystemKey = useMemo(() => {
    const map = new Map<string, SheetAccount>()
    for (const a of catalog.accounts) if (a.systemKey) map.set(a.systemKey, a)
    return map
  }, [catalog.accounts])
  const accountsById = useMemo(
    () => new Map(catalog.accounts.map((a) => [a.id, a])),
    [catalog.accounts],
  )
  // Contrapartida (C.3.4): imputable y activa, que no sea de caja ni de IVA.
  const counterpartIds = useMemo(
    () =>
      new Set(
        catalog.accounts
          .filter(
            (a) =>
              a.postable &&
              a.active &&
              !a.isTreasury &&
              !(a.systemKey !== null && VAT_KEYS.has(a.systemKey)),
          )
          .map((a) => a.id),
      ),
    [catalog.accounts],
  )
  const senas = catalog.parties.find((p) => p.systemKey === 'senas' && p.active) ?? null
  const groups = useMemo(
    () => situationGroups({ treasuries, hasDeposits: senas !== null }),
    [treasuries, senas],
  )
  const available = useMemo(() => groups.flatMap((g) => g.items), [groups])

  const initialTreasury =
    params.caja && treasuries.some((t) => t.id === params.caja) ? params.caja : null
  const [treasuryId, setTreasuryId] = useState<string | null>(initialTreasury)
  const [direction, setDirection] = useState<Direction | null>(null)
  const [motive, setMotive] = useState<Motive | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [partyId, setPartyId] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [date, setDate] = useState<string | null>(today)
  const [detail, setDetail] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  // Solo de la vista: lo que está plegado.
  const [detailOpen, setDetailOpen] = useState(false)
  const [accountChanging, setAccountChanging] = useState(false)

  const undoToast = useUndoToast(tenantSlug)
  const posting = usePosting<CashMovementValues>({
    tenantSlug,
    action: postCashMovement,
    formRef,
    isKnownField: (key) => KNOWN_FIELDS.has(key),
    onSaved: (saved) => {
      close()
      undoToast(saved.message, saved)
      router.refresh()
    },
  })

  const treasury = treasuries.find((t) => t.id === treasuryId)
  const account = accountId ? accountsById.get(accountId) : undefined
  const isPartnerAccount = account?.systemKey ? PARTNER_ACCOUNT_KEYS.has(account.systemKey) : false
  const fixedSenas = motive === 'deposit_received' && senas !== null
  const needsParty = Boolean(account?.requiresParty) && !fixedSenas
  const picked = available.find((s) => s.direction === direction && s.motive === motive) ?? null

  const dirty =
    treasuryId !== initialTreasury ||
    direction !== null ||
    amount !== null ||
    detail.trim() !== '' ||
    accountId !== null
  useEffect(() => setDirty(dirty), [dirty, setDirty])

  /**
   * Una situación escribe el sentido y el motivo de una vez (los dos pasos de
   * antes, con sus mismas reglas: `applySituation`). «Rindió…» además lleva la
   * caja a la billetera.
   */
  function chooseSituation(next: Situation) {
    const key = MOTIVE_ACCOUNT[next.motive]
    const current = partyId ? catalog.parties.find((p) => p.id === partyId) : undefined
    const choice = applySituation({ direction, motive, accountId, partyId }, next, {
      suggestedAccountId: key ? (accountsBySystemKey.get(key)?.id ?? null) : null,
      depositsPartyId: senas?.id ?? null,
      partyIsPartner: current?.kind === 'partner',
    })
    setDirection(choice.direction)
    setMotive(choice.motive)
    setAccountId(choice.accountId)
    setPartyId(choice.partyId)
    setAccountChanging(false)
    setTreasuryId(treasuryForSituation(next, treasury, treasuries))
    posting.clearFieldError('direction')
    posting.clearFieldError('shortcut')
    posting.clearFieldError('counterpartAccountId')
  }

  // Si el motivo deja de valer (otra caja sin rendimiento), se olvida.
  useEffect(() => {
    if (motiveStillValid(direction, motive, treasury?.kind ?? null, available)) return
    setDirection(null)
    setMotive(null)
    setAccountId(null)
    setPartyId(null)
  }, [direction, motive, treasury, available])

  const partyOptions = useMemo((): PartyOption[] => {
    const list = catalog.parties.filter((p) =>
      isPartnerAccount ? p.kind === 'partner' : p.systemKey === null || p.id === partyId,
    )
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      tradeName: p.tradeName,
      taxId: p.taxId,
      active: p.active,
    }))
  }, [catalog.parties, isPartnerAccount, partyId])

  const values = useMemo(
    () => ({
      treasuryAccountId: treasuryId ?? '',
      direction: direction ?? '',
      counterpartAccountId: accountId ?? '',
      partyId: account?.requiresParty ? partyId : null,
      amountCents: amount,
      date: date ?? '',
      shortcut: motive ?? 'other',
      detail: detail.trim() === '' ? null : detail.trim(),
    }),
    [treasuryId, direction, accountId, account, partyId, amount, date, motive, detail],
  )
  const preview = useDocumentPreview('cash_movement', values, catalog.ctx, catalog.firstOpenDate)

  const localErrors = attempted && !preview.state.ok ? (preview.state.fieldErrors ?? {}) : {}
  const errorOf = (key: string): string | null =>
    posting.fieldErrors[key] ?? localErrors[key] ?? null
  // Sin situación elegida, el error del sentido y el del motivo son uno solo.
  const situationError =
    errorOf('shortcut') ??
    (attempted && (direction === null || motive === null) ? 'Elegí qué pasó.' : null)
  const accountError = motive === null ? null : errorOf('counterpartAccountId')

  const shown = posting.overrideFor(preview.key) ?? (preview.state.ok ? preview.state.preview : [])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)
    if (!preview.state.ok || (direction !== null && motive === null)) {
      posting.setBanner({ tone: 'error', message: 'Revisá lo marcado en rojo.' })
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }
    posting.submit(values, preview.state, preview.key)
  }

  const submitLabel = movementSubmitLabel(
    direction,
    amount !== null && amount > 0 ? moneyLabel(amount) : null,
  )
  // «Rindió…» es de una billetera: ahí se elige solo entre billeteras.
  const pickable =
    motive === 'mp_yield' ? treasuries.filter((t) => t.kind === 'wallet') : treasuries
  // La categoría se pregunta solo cuando hace falta: con «otra», o si el motivo no encontró la suya.
  const accountAsked = motive === 'other' || (motive !== null && accountId === null)
  const accountShown = accountAsked || accountChanging || Boolean(accountError)
  const warning = otherWarning(direction, motive)
  const party = partyId ? catalog.parties.find((p) => p.id === partyId) : undefined
  const partyName = party ? (party.tradeName ?? party.name) : null
  const treasuryError = errorOf('treasuryAccountId')
  // Qué falta para poder mostrar los libros, en el orden de la hoja (solo para decirlo).
  const missing = [
    picked === null ? 'qué pasó' : null,
    treasury ? null : 'la caja',
    needsParty && !partyId ? (isPartnerAccount ? 'el socio' : 'con quién') : null,
    amount === null || amount <= 0 ? 'el importe' : null,
    accountAsked && !accountId ? (direction === 'in' ? 'de qué es' : 'en qué se fue') : null,
  ].filter((item): item is string => item !== null)

  return (
    <>
      <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
      <form ref={formRef} noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <ActionSheetBody>
          {/* ¿Qué pasó?: una sola elección, en dos grupos. */}
          <div className={SHEET_QUESTION_BLOCK}>
            <SheetQuestion id={`${id}-que`} required>
              ¿Qué pasó?
            </SheetQuestion>
            <div
              role="radiogroup"
              aria-labelledby={`${id}-que`}
              aria-invalid={situationError ? true : undefined}
              tabIndex={-1}
              className="grid gap-3 outline-none"
            >
              {groups.map((group) => (
                <div key={group.direction} className="grid gap-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {group.label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {group.items.map((item) => {
                      const active = picked?.key === item.key
                      return (
                        // biome-ignore lint/a11y/useSemanticElements: radiogroup de WAI-ARIA con botones (píldoras), como las demás elecciones de las hojas
                        <button
                          key={item.key}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => chooseSituation(item)}
                          className={cn(
                            SITUATION,
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border hover:bg-secondary',
                          )}
                        >
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            {situationError ? (
              <p role="alert" className="text-xs text-destructive">
                {situationError}
              </p>
            ) : null}
            {warning ? (
              <p className="rounded-xl bg-secondary/50 px-3.5 py-2.5 text-sm text-pretty">
                {warning}
              </p>
            ) : null}
          </div>

          <div className={SHEET_QUESTION_BLOCK}>
            <SheetQuestion id={`${id}-caja-label`} required>
              {treasuryQuestion(direction)}
            </SheetQuestion>
            <TreasuryPicker
              id={`${id}-caja`}
              aria-labelledby={`${id}-caja-label`}
              value={treasuryId}
              onValueChange={(next) => {
                setTreasuryId(next)
                posting.clearFieldError('treasuryAccountId')
              }}
              treasuries={pickable}
              invalid={Boolean(treasuryError)}
              aria-describedby={treasuryError ? `${id}-caja-error` : undefined}
            />
            {treasuryError ? (
              <p id={`${id}-caja-error`} role="alert" className="text-xs text-destructive">
                {treasuryError}
              </p>
            ) : null}
          </div>

          {needsParty ? (
            <div className={SHEET_QUESTION_BLOCK}>
              <SheetQuestion id={`${id}-party-label`} required>
                {isPartnerAccount ? '¿Qué socio?' : '¿Con quién?'}
              </SheetQuestion>
              <PartyCombobox
                id={`${id}-party`}
                aria-labelledby={`${id}-party-label`}
                value={partyId}
                onValueChange={(next) => {
                  setPartyId(next)
                  posting.clearFieldError('partyId')
                }}
                parties={partyOptions}
                placeholder={isPartnerAccount ? 'Elegí el socio' : 'Elegí con quién'}
                searchPlaceholder="Nombre o CUIT"
                onCreate={isPartnerAccount ? (name) => setCreating(name) : undefined}
                invalid={Boolean(errorOf('partyId'))}
                aria-describedby={
                  [
                    isPartnerAccount && partyOptions.length === 0 ? `${id}-party-hint` : null,
                    errorOf('partyId') ? `${id}-party-error` : null,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              />
              {isPartnerAccount && partyOptions.length === 0 ? (
                <p id={`${id}-party-hint`} className="text-xs text-muted-foreground">
                  Todavía no hay socios cargados: escribí el nombre para crearlo.
                </p>
              ) : null}
              {errorOf('partyId') ? (
                <p id={`${id}-party-error`} role="alert" className="text-xs text-destructive">
                  {errorOf('partyId')}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-2">
            <MoneyField
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
            />
            {treasury && direction ? (
              <TreasuryAfterLine treasury={treasury} amountCents={amount} direction={direction} />
            ) : null}
          </div>

          {/* La categoría: solo cuando hay que elegirla. */}
          {accountAsked ? (
            <div className={SHEET_QUESTION_BLOCK}>
              <SheetQuestion id={`${id}-cuenta-label`} required>
                {accountQuestion(direction)}
              </SheetQuestion>
              <AccountCombobox
                id={`${id}-cuenta`}
                aria-labelledby={`${id}-cuenta-label`}
                value={accountId}
                onValueChange={(next) => {
                  setAccountId(next)
                  posting.clearFieldError('counterpartAccountId')
                  const chosen = next ? accountsById.get(next) : undefined
                  if (!chosen?.requiresParty) setPartyId(null)
                }}
                accounts={catalog.accounts}
                filter={(a) => counterpartIds.has(a.id)}
                placeholder={accountPlaceholder(direction)}
                invalid={Boolean(accountError)}
                aria-describedby={`${id}-cuenta-hint${accountError ? ` ${id}-cuenta-error` : ''}`}
              />
              <p id={`${id}-cuenta-hint`} className="text-xs text-muted-foreground text-pretty">
                Es el nombre que va a ver la contadora. Si dudás, elegí el que más se parezca:
                después se puede corregir.
              </p>
              {accountError ? (
                <p id={`${id}-cuenta-error`} role="alert" className="text-xs text-destructive">
                  {accountError}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Lo demás: la fecha y una nota. Una raya lo separa de las preguntas. Va ANTES del
              vale, como en «Nuevo gasto»: el papel cierra el recorrido, justo arriba del botón. */}
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
            {detailOpen || detail !== '' || errorOf('detail') ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-nota`}>
                  Nota <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Textarea
                  id={`${id}-nota`}
                  value={detail}
                  rows={2}
                  maxLength={280}
                  placeholder="Por ejemplo: retiro de la semana."
                  className="text-base md:text-sm"
                  aria-invalid={errorOf('detail') ? true : undefined}
                  aria-describedby={errorOf('detail') ? `${id}-nota-error` : undefined}
                  onChange={(e) => setDetail(e.target.value)}
                />
                {errorOf('detail') ? (
                  <p id={`${id}-nota-error`} role="alert" className="text-xs text-destructive">
                    {errorOf('detail')}
                  </p>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className={ADD_LINK}
                onClick={() => {
                  setDetailOpen(true)
                  // El botón desaparece: el foco sigue en el campo que lo reemplaza.
                  requestAnimationFrame(() => document.getElementById(`${id}-nota`)?.focus())
                }}
              >
                <Plus className="size-3.5" aria-hidden />
                Agregar una nota
              </button>
            )}
          </div>

          {/* El vale: lo que queda anotado, en palabras. El «hoy → queda» de la caja ya está
              bajo el importe, con sus rótulos: acá no se repite. */}
          <Ticket aria-label="El vale de caja" className="mx-auto w-full max-w-[22rem]">
            <TicketHeader
              title="Vale de caja"
              subtitle={date ? formatWeekdayDayMonth(date) : undefined}
              className={cn(picked === null && 'opacity-70')}
            />
            <TicketRule />
            <TicketRow label="Qué" value={picked?.what ?? EMPTY} muted={picked === null} />
            {needsParty || fixedSenas ? (
              <TicketRow label="Quién" value={partyName ?? EMPTY} muted={partyName === null} />
            ) : null}
            {motive === 'other' ? (
              <TicketRow
                label={direction === 'in' ? 'De qué' : 'En qué'}
                value={account?.name ?? EMPTY}
                muted={!account}
              />
            ) : null}
            <TicketRule double />
            <TicketTotal
              label={voucherTotalLabel(direction, treasury?.name)}
              value={amount !== null && amount > 0 ? formatCents(amount) : EMPTY}
            />
            <TicketNote>{voucherNote(motive)}</TicketNote>
          </Ticket>

          {/* `group/books`: lo de la cuenta contable se ve recién con «Ver cómo queda en los
              libros» abierto (el botón de `EntryPreview` lo dice con `aria-expanded`). */}
          <div className="group/books grid gap-2">
            <EntryPreview
              entries={shown}
              label="Ver cómo queda en los libros"
              emptyText={booksEmptyText(missing)}
            />
            {/* Con un motivo conocido la cuenta ya viene puesta: queda acá, para quien la quiera cambiar. */}
            {motive !== null && !accountAsked ? (
              accountShown ? (
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-cuenta`}>Cuenta en los libros</Label>
                  <AccountCombobox
                    id={`${id}-cuenta`}
                    value={accountId}
                    onValueChange={(next) => {
                      setAccountId(next)
                      posting.clearFieldError('counterpartAccountId')
                      const chosen = next ? accountsById.get(next) : undefined
                      if (!chosen?.requiresParty) setPartyId(null)
                    }}
                    accounts={catalog.accounts}
                    filter={(a) => counterpartIds.has(a.id)}
                    invalid={Boolean(accountError)}
                    aria-describedby={accountError ? `${id}-cuenta-error` : undefined}
                  />
                  {accountError ? (
                    <p id={`${id}-cuenta-error`} role="alert" className="text-xs text-destructive">
                      {accountError}
                    </p>
                  ) : null}
                </div>
              ) : (
                // Palabra de contadora: va adentro del plegado. El link es de texto corrido
                // (sin alto mínimo: en el celular estiraba el renglón al doble).
                <p className="hidden px-1 text-xs leading-relaxed text-muted-foreground text-pretty group-has-[button[aria-expanded=true]]/books:block">
                  En los libros va a «{account?.name ?? ''}».{' '}
                  <button
                    type="button"
                    className={INLINE_LINK}
                    onClick={() => setAccountChanging(true)}
                  >
                    Cambiar la cuenta
                  </button>
                </p>
              )
            ) : null}
          </div>

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
      <QuickPartyDialog
        tenantSlug={tenantSlug}
        open={creating !== null}
        onOpenChange={(open) => {
          if (!open) setCreating(null)
        }}
        kind="partner"
        initialName={creating ?? ''}
        onCreated={(created) => {
          setPartyId(created.id)
          posting.clearFieldError('partyId')
          // El contexto de la vista previa tiene que conocer al socio nuevo.
          reloadCatalog()
        }}
      />
    </>
  )
}
