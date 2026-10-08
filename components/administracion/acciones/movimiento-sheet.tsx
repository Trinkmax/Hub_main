'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { postCashMovement } from '@/lib/accounting/actions/documents'
import type { CASH_MOVEMENT_SHORTCUTS } from '@/lib/accounting/schemas'
import type { CashMovementValues } from '@/lib/accounting/server/document-types'
import { VAT_ACCOUNT_KEYS } from '@/lib/accounting/system-keys'
import { AccountCombobox } from '../account-combobox'
import { ActionSheetBody, ActionSheetFooter, ActionSheetHeader } from '../action-sheet'
import { type ChoiceChip, ChoiceChips } from '../cajas-ventas/choice-chips'
import { loadCajasVentasCatalog } from '../cajas-ventas/data'
import { FormBanner, WarningsDialog } from '../cajas-ventas/feedback'
import { describedBy, Field, GroupLabel } from '../cajas-ventas/field'
import { moneyLabel } from '../cajas-ventas/money'
import { QuickPartyDialog } from '../cajas-ventas/quick-party-dialog'
import {
  firstLoadableDay,
  SheetCancel,
  SheetFailed,
  SheetLoading,
  useDocumentPreview,
} from '../cajas-ventas/sheet-frame'
import type { CajasVentasCatalog, SheetAccount } from '../cajas-ventas/types'
import { usePosting, useUndoToast } from '../cajas-ventas/use-posting'
import { useSheetLoad } from '../cajas-ventas/use-sheet-load'
import { DateField } from '../date-input'
import { EntryPreview } from '../entry-preview'
import { balanceText } from '../format'
import { MoneyField } from '../money-input'
import { PartyCombobox, type PartyOption } from '../party-combobox'
import { TreasurySelect } from '../treasury-select'
import { ACTION_TITLES, type ActionSheetProps } from './types'

const TITLE = ACTION_TITLES.movimiento
const DESCRIPTION = 'Plata que entra o sale de una caja y no es una venta ni un gasto.'

/** Hoja «Otro ingreso o egreso» (H.11, E.5.12): la caja contra una contrapartida. */
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

type Direction = 'in' | 'out'
type Motive = (typeof CASH_MOVEMENT_SHORTCUTS)[number]

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

/** La cuenta que sugiere cada motivo (E.5.12); «Otro» la elige la persona. */
const MOTIVE_ACCOUNT: Readonly<Partial<Record<Motive, string>>> = {
  partner_withdrawal: 'partners_current',
  partner_contribution: 'partners_current',
  mp_yield: 'interest_income',
  loan_received: 'bank_loans',
  deposit_received: 'customer_deposits',
}

/** Cuentas de socios: el partícipe es un socio (se puede crear acá). */
const PARTNER_ACCOUNT_KEYS = new Set(['partners_current', 'partner_loans'])

const VAT_KEYS: ReadonlySet<string> = new Set(VAT_ACCOUNT_KEYS)

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

  const dirty =
    treasuryId !== initialTreasury ||
    direction !== null ||
    amount !== null ||
    detail.trim() !== '' ||
    accountId !== null
  useEffect(() => setDirty(dirty), [dirty, setDirty])

  const motives = useMemo((): ChoiceChip<Motive>[] => {
    if (direction === 'out') {
      return [
        { value: 'partner_withdrawal', label: 'Retiro de un socio' },
        { value: 'other', label: 'Otro egreso' },
      ]
    }
    if (direction === 'in') {
      return [
        { value: 'partner_contribution', label: 'Aporte de un socio' },
        ...(treasury?.kind === 'wallet'
          ? [{ value: 'mp_yield' as const, label: `Rendimiento de ${treasury.name}` }]
          : []),
        { value: 'loan_received', label: 'Préstamo' },
        ...(senas ? [{ value: 'deposit_received' as const, label: 'Seña de un cliente' }] : []),
        { value: 'other', label: 'Otro ingreso' },
      ]
    }
    return []
  }, [direction, treasury, senas])

  function chooseMotive(next: Motive) {
    setMotive(next)
    posting.clearFieldError('shortcut')
    const key = MOTIVE_ACCOUNT[next]
    const suggested = key ? (accountsBySystemKey.get(key)?.id ?? null) : null
    if (suggested || next === 'other') {
      setAccountId(suggested)
      posting.clearFieldError('counterpartAccountId')
    }
    if (next === 'deposit_received') setPartyId(senas?.id ?? null)
    else if (next === 'partner_withdrawal' || next === 'partner_contribution') {
      const current = partyId ? catalog.parties.find((p) => p.id === partyId) : undefined
      if (current?.kind !== 'partner') setPartyId(null)
    } else setPartyId(null)
  }

  function chooseDirection(next: Direction) {
    setDirection(next)
    posting.clearFieldError('direction')
    // Un motivo que no existe en el otro sentido se olvida.
    const keeps =
      motive === 'other' ||
      (next === 'in' && motive !== 'partner_withdrawal') ||
      (next === 'out' && motive === 'partner_withdrawal')
    if (!keeps || motive === null) {
      setMotive(null)
      setAccountId(null)
      setPartyId(null)
    }
  }

  // Si el motivo deja de valer (otra caja sin rendimiento), se olvida.
  useEffect(() => {
    if (motive && !motives.some((m) => m.value === motive)) {
      setMotive(null)
      setAccountId(null)
      setPartyId(null)
    }
  }, [motive, motives])

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
  // Sin motivo elegido todavía, el error de la cuenta es «elegí el motivo».
  const motiveError = attempted && direction !== null && motive === null ? 'Elegí el motivo.' : null

  const shown = posting.overrideFor(preview.key) ?? (preview.state.ok ? preview.state.preview : [])
  const leftover =
    treasury && direction === 'out' && amount !== null ? treasury.balanceCents - amount : null

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

  const verb = direction === 'out' ? 'egreso' : 'ingreso'
  const submitLabel =
    direction && amount !== null && amount > 0
      ? `Registrar ${verb} · ${moneyLabel(amount)}`
      : `Registrar ${direction ? verb : 'movimiento'}`

  const partyLabel = isPartnerAccount ? 'Socio' : '¿Con quién?'

  return (
    <>
      <ActionSheetHeader title={TITLE} description={DESCRIPTION} />
      <form ref={formRef} noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <ActionSheetBody>
          <Field
            id={`${id}-caja`}
            label="Caja o cuenta"
            required
            error={errorOf('treasuryAccountId')}
          >
            <TreasurySelect
              id={`${id}-caja`}
              value={treasuryId}
              onValueChange={(next) => {
                setTreasuryId(next)
                posting.clearFieldError('treasuryAccountId')
              }}
              treasuries={treasuries}
              invalid={Boolean(errorOf('treasuryAccountId'))}
              aria-describedby={describedBy(`${id}-caja`, { error: errorOf('treasuryAccountId') })}
            />
          </Field>

          <div className="grid gap-2">
            <GroupLabel id={`${id}-dir`}>
              ¿Entró o salió plata?
              {/* El mismo espacio que el asterisco de un <Label> (gap-2 + ml-0.5). */}
              <span aria-hidden="true" className="ml-2.5 text-destructive">
                *
              </span>
            </GroupLabel>
            <ChoiceChips<Direction>
              labelledBy={`${id}-dir`}
              value={direction}
              onChange={chooseDirection}
              options={[
                { value: 'in', label: 'Entró plata' },
                { value: 'out', label: 'Salió plata' },
              ]}
            />
            {errorOf('direction') ? (
              <p role="alert" className="text-xs text-destructive">
                {errorOf('direction')}
              </p>
            ) : null}
          </div>

          {direction ? (
            <div className="grid gap-2">
              <GroupLabel id={`${id}-motivo`}>¿Por qué?</GroupLabel>
              <ChoiceChips<Motive>
                labelledBy={`${id}-motivo`}
                value={motive}
                onChange={chooseMotive}
                options={motives}
              />
              {motiveError ? (
                <p role="alert" className="text-xs text-destructive">
                  {motiveError}
                </p>
              ) : null}
            </div>
          ) : null}

          {needsParty ? (
            <Field
              id={`${id}-party`}
              label={partyLabel}
              required
              hint={
                isPartnerAccount && partyOptions.length === 0
                  ? 'Todavía no hay socios cargados: escribí el nombre para crearlo.'
                  : undefined
              }
              error={errorOf('partyId')}
            >
              <PartyCombobox
                id={`${id}-party`}
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
                aria-describedby={describedBy(`${id}-party`, {
                  hint: isPartnerAccount && partyOptions.length === 0,
                  error: errorOf('partyId'),
                })}
              />
            </Field>
          ) : null}

          <MoneyField
            label="Importe"
            required
            value={amount}
            onValueChange={(cents) => {
              setAmount(cents)
              posting.clearFieldError('amountCents')
            }}
            error={errorOf('amountCents')}
            hint={
              leftover !== null && leftover < 0 && treasury
                ? `${treasury.name} quedaría en descubierto: ${balanceText(leftover, 'treasury')}.`
                : undefined
            }
          />

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

          {motive ? (
            <Field
              id={`${id}-cuenta`}
              label="Cuenta"
              required
              hint={
                motive === 'other'
                  ? 'Dónde se registra en los libros.'
                  : 'La sugerimos por el motivo. Cambiala si hace falta.'
              }
              error={errorOf('counterpartAccountId')}
            >
              <AccountCombobox
                id={`${id}-cuenta`}
                value={accountId}
                onValueChange={(next) => {
                  setAccountId(next)
                  posting.clearFieldError('counterpartAccountId')
                  const picked = next ? accountsById.get(next) : undefined
                  if (!picked?.requiresParty) setPartyId(null)
                }}
                accounts={catalog.accounts}
                filter={(a) => counterpartIds.has(a.id)}
                invalid={Boolean(errorOf('counterpartAccountId'))}
                aria-describedby={describedBy(`${id}-cuenta`, {
                  hint: true,
                  error: errorOf('counterpartAccountId'),
                })}
              />
            </Field>
          ) : null}

          <Field id={`${id}-nota`} label="Nota" optional error={errorOf('detail')}>
            <Textarea
              id={`${id}-nota`}
              value={detail}
              rows={2}
              maxLength={280}
              placeholder="Por ejemplo: retiro para el sueldo de Máximo."
              className="text-base md:text-sm"
              aria-invalid={errorOf('detail') ? true : undefined}
              aria-describedby={describedBy(`${id}-nota`, { error: errorOf('detail') })}
              onChange={(e) => setDetail(e.target.value)}
            />
          </Field>

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
      <QuickPartyDialog
        tenantSlug={tenantSlug}
        open={creating !== null}
        onOpenChange={(open) => {
          if (!open) setCreating(null)
        }}
        kind="partner"
        initialName={creating ?? ''}
        onCreated={(party) => {
          setPartyId(party.id)
          posting.clearFieldError('partyId')
          // El contexto de la vista previa tiene que conocer al socio nuevo.
          reloadCatalog()
        }}
      />
    </>
  )
}
