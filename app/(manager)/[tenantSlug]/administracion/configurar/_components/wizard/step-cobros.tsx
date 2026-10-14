'use client'

import { Banknote, Bike, CreditCard, type LucideIcon, NotebookPen, QrCode } from 'lucide-react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { CloseColumnTicket } from '../../../ajustes/_components/close-column-ticket'
import { PercentInput } from '../../../ajustes/_components/inputs'
import {
  effectiveMethods,
  effectiveTransferDestination,
  hasWallet,
  PLATFORMS,
  type PlatformKey,
  transferTargets,
  usesWallet,
  type WizardMethod,
  type WizardRates,
  type WizardState,
} from '../../_lib/wizard'

/**
 * Paso 3 de la puesta en marcha · «¿Cómo te pagan?».
 *
 * Los medios van agrupados como en el Cierre del día (efectivo, billeteras y
 * transferencias, tarjetas, apps de delivery, cuenta corriente), cada uno con
 * su interruptor, a dónde va lo cobrado y —lo que antes estaba plegado en
 * «Descuentos habituales»— SU porcentaje al lado, a la vista. Ahí fue donde el
 * 12/10 se guardaron valores propuestos sin mirarlos: por eso un valor
 * propuesto lo dice («propuesto: confirmalo con tu liquidación»).
 *
 * Al lado, «Tu columna del cierre», que se arma en vivo. Mismo estado
 * (`methods`, `platforms`, `rates`, `transferDestination`…): lo que viaja lo
 * arma `wizardPayload`, sin cambios.
 */

const YES_NO: readonly ChoiceChip<'si' | 'no'>[] = [
  { value: 'si', label: 'Sí' },
  { value: 'no', label: 'No' },
]

function GroupIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-primary shadow-2xs"
    >
      <Icon className="size-4" />
    </span>
  )
}

function Group({
  icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl bg-secondary/50 p-3 sm:p-4">
      <div className="flex items-center gap-2.5">
        <GroupIcon icon={icon} />
        <h3 className="text-sm leading-tight font-semibold">{title}</h3>
      </div>
      <div className="mt-1 divide-y divide-border/60 sm:pl-[2.625rem]">{children}</div>
    </section>
  )
}

/**
 * Un grupo de un solo medio (el efectivo, la cuenta corriente): no repite el
 * nombre en un encabezado. El ícono del grupo va en el renglón del medio, igual
 * que en Ajustes › Medios de cobro y en el Cierre del día.
 */
function Single({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="flex items-start gap-2.5 rounded-xl bg-secondary/50 p-3 sm:p-4">
      <GroupIcon icon={icon} />
      <div className="min-w-0 flex-1 [&>div]:py-0">{children}</div>
    </section>
  )
}

/** El porcentaje de un medio, al lado de su interruptor: «Te descuentan [ 1,5 ] %». */
function Rate({
  id,
  label,
  value,
  proposed,
  hint,
  error,
  onChange,
}: {
  id: string
  label: string
  value: string
  /** El valor es el que propuso el asistente (nadie lo confirmó todavía). */
  proposed: boolean
  hint?: string
  error: string | null
  onChange: (text: string) => void
}) {
  // Vacío no es un error: el medio queda sin comisión y se carga después. Se dice, para que
  // un casillero en blanco al lado de otros con un valor propuesto no parezca que falta algo.
  const blank = value.trim() === '' && !error
  const helped = Boolean(hint) || proposed || blank
  return (
    <div className="col-span-2 grid gap-1">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Label htmlFor={id} className="text-sm font-normal">
          {label}
        </Label>
        <PercentInput
          id={id}
          value={value}
          onChange={onChange}
          invalid={Boolean(error)}
          describedBy={
            [helped ? `${id}-hint` : null, error ? `${id}-error` : null]
              .filter(Boolean)
              .join(' ') || undefined
          }
          className="w-28"
        />
      </div>
      {helped ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground text-pretty">
          {proposed ? 'Propuesto: confirmalo con tu liquidación. ' : null}
          {blank
            ? 'Si no la sabés, dejala vacía: la cargás después en Ajustes › Medios de cobro. '
            : null}
          {blank ? null : hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Un medio: su nombre, a dónde va lo cobrado y su interruptor; debajo, lo que haga falta. */
function Method({
  id,
  name,
  flow,
  reason,
  checked,
  onChange,
  children,
}: {
  id: string
  name: string
  /** A dónde va lo cobrado (sin la flecha). */
  flow: string
  /** Por qué no se puede prender (reemplaza a `flow`). */
  reason?: string | null
  checked: boolean
  onChange: (checked: boolean) => void
  children?: ReactNode
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 py-3 last:pb-0">
      <div className={cn('min-w-0', !checked && 'opacity-70')}>
        <Label htmlFor={id} className="text-sm leading-snug font-medium">
          {name}
        </Label>
        <p
          id={`${id}-desc`}
          className="mt-0.5 text-xs leading-snug text-muted-foreground text-pretty"
        >
          {reason ? (
            reason
          ) : (
            <>
              <span aria-hidden>→ </span>
              {flow}
            </>
          )}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={Boolean(reason)}
        aria-describedby={`${id}-desc`}
        onCheckedChange={onChange}
        className="mt-0.5"
      />
      {checked ? children : null}
    </div>
  )
}

export function StepCobros({
  state,
  errors,
  proposed,
  setState,
  update,
  clearError,
}: {
  state: WizardState
  errors: Readonly<Record<string, string>>
  /** Los porcentajes que propone el asistente al empezar: para avisar cuáles nadie tocó. */
  proposed: WizardRates
  setState: Dispatch<SetStateAction<WizardState>>
  update: (patch: Partial<WizardState>) => void
  clearError: (...fields: string[]) => void
}) {
  const err = (field: string) => errors[field] ?? null
  const methods = effectiveMethods(state)
  const targets = transferTargets(state)
  const destination = effectiveTransferDestination(state)
  const destinationTreasury = state.treasuries.find((t) => t.key === destination)
  const walletOn = hasWallet(state)
  const cash = state.treasuries.find((t) => t.kind === 'cash' && t.enabled)
  const wallet = state.treasuries.find((t) => t.kind === 'wallet' && t.enabled)

  const toggle = (key: WizardMethod) => (value: boolean) => {
    setState((s) => ({ ...s, methods: { ...s.methods, [key]: value } }))
    clearError('methods', 'transferDestination')
  }
  const setRate = (key: 'mpQr' | 'mpIibb' | 'debit' | 'credit') => (text: string) => {
    setState((s) => ({ ...s, rates: { ...s.rates, [key]: text } }))
    clearError(`rates.${key}`)
  }
  const isProposed = (current: string, initial: string) => current !== '' && current === initial

  // La columna del cierre, en el orden en que quedan creados los medios.
  const column = [
    methods.cash ? 'Efectivo' : null,
    methods.transfer ? 'Transferencia' : null,
    methods.qr_mp ? 'QR Mercado Pago' : null,
    methods.debit ? 'Débito' : null,
    methods.credit ? 'Crédito' : null,
    ...PLATFORMS.filter((p) => state.platforms[p.key]).map((p) => p.label),
    methods.customer_account ? 'Cuenta corriente' : null,
  ].filter((name): name is string => name !== null)

  // «Mercado Pago» si todo lo del grupo va a su billetera (como titula el Cierre del día).
  const walletTitle =
    wallet && (!methods.transfer || destinationTreasury?.kind === 'wallet')
      ? wallet.name.trim() || 'Mercado Pago'
      : 'Billeteras y transferencias'

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_17.5rem] xl:items-start">
      <div className="grid min-w-0 gap-3">
        <Single icon={Banknote}>
          <Method
            id="wz-m-cash"
            name="Efectivo"
            flow={`Entra a ${cash?.name.trim() || 'la caja de efectivo'}`}
            checked={methods.cash}
            onChange={toggle('cash')}
          />
        </Single>

        <Group icon={QrCode} title={walletTitle}>
          <Method
            id="wz-m-transfer"
            name="Transferencia"
            flow={
              destinationTreasury
                ? `Entra a ${destinationTreasury.name.trim() || 'la cuenta que elijas'}`
                : 'Entra a la cuenta que elijas'
            }
            reason={targets.length === 0 ? 'Sumá Mercado Pago o un banco para recibirlas.' : null}
            checked={methods.transfer}
            onChange={toggle('transfer')}
          >
            {targets.length > 1 ? (
              <div className="col-span-2 grid gap-1.5">
                <Label id="wz-transfer-dest-label" className="text-sm font-normal">
                  ¿Adónde entran las transferencias?
                </Label>
                <ChoiceChips
                  options={targets.map((t) => ({
                    value: t.key,
                    label: t.name.trim() || 'Sin nombre',
                  }))}
                  value={destination}
                  labelledBy="wz-transfer-dest-label"
                  onChange={(value) => {
                    update({ transferDestination: value })
                    clearError('transferDestination')
                  }}
                />
                {err('transferDestination') ? (
                  <p role="alert" className="text-xs text-destructive">
                    {err('transferDestination')}
                  </p>
                ) : null}
              </div>
            ) : null}
            {destinationTreasury?.kind === 'wallet' ? (
              <div className="col-span-2 grid gap-1.5">
                <Label id="wz-mp-iibb-label" className="text-sm font-normal">
                  ¿Mercado Pago te descuenta Ingresos Brutos en las transferencias?
                </Label>
                <ChoiceChips
                  options={YES_NO}
                  value={state.transferDeductsIibb ? 'si' : 'no'}
                  labelledBy="wz-mp-iibb-label"
                  onChange={(value) => update({ transferDeductsIibb: value === 'si' })}
                />
              </div>
            ) : null}
          </Method>
          <Method
            id="wz-m-qr_mp"
            name="QR de Mercado Pago"
            flow={`Queda en camino a ${wallet?.name.trim() || 'Mercado Pago'}`}
            reason={walletOn ? null : 'Sumá la cuenta de Mercado Pago (billetera).'}
            checked={methods.qr_mp}
            onChange={toggle('qr_mp')}
          >
            <Rate
              id="wz-r-mpqr"
              label="Te descuentan de comisión"
              value={state.rates.mpQr}
              proposed={isProposed(state.rates.mpQr, proposed.mpQr)}
              hint="Si cambia según cómo te pagan (dinero en cuenta, débito o crédito), poné la más común."
              error={err('rates.mpQr')}
              onChange={setRate('mpQr')}
            />
          </Method>
          {usesWallet(state) ? (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-2 py-3 last:pb-0">
              <Rate
                id="wz-r-mpiibb"
                label="Ingresos Brutos que retiene Mercado Pago"
                value={state.rates.mpIibb}
                proposed={isProposed(state.rates.mpIibb, proposed.mpIibb)}
                hint="Se descuenta de los QR y de las transferencias."
                error={err('rates.mpIibb')}
                onChange={setRate('mpIibb')}
              />
            </div>
          ) : null}
        </Group>

        <Group icon={CreditCard} title="Tarjetas">
          <Method
            id="wz-m-debit"
            name="Débito"
            flow="Posnet · llega al día siguiente"
            checked={methods.debit}
            onChange={toggle('debit')}
          >
            <Rate
              id="wz-r-debit"
              label="Te descuentan de comisión"
              value={state.rates.debit}
              proposed={isProposed(state.rates.debit, proposed.debit)}
              error={err('rates.debit')}
              onChange={setRate('debit')}
            />
          </Method>
          <Method
            id="wz-m-credit"
            name="Crédito"
            flow="Posnet · llega a los 10 días"
            checked={methods.credit}
            onChange={toggle('credit')}
          >
            <Rate
              id="wz-r-credit"
              label="Te descuentan de comisión"
              value={state.rates.credit}
              proposed={isProposed(state.rates.credit, proposed.credit)}
              hint="Más el IVA de la comisión, que lo calcula el sistema."
              error={err('rates.credit')}
              onChange={setRate('credit')}
            />
          </Method>
        </Group>

        <Group icon={Bike} title="Apps de delivery">
          {PLATFORMS.map((p) => (
            <Method
              key={p.key}
              id={`wz-p-${p.key}`}
              name={p.label}
              flow="Te paga después · llega a los 14 días"
              checked={state.platforms[p.key]}
              onChange={(value) =>
                setState((s) => ({ ...s, platforms: { ...s.platforms, [p.key]: value } }))
              }
            >
              <Rate
                id={`wz-r-${p.key}`}
                label="Te descuentan de comisión"
                value={state.rates.platforms[p.key]}
                proposed={isProposed(state.rates.platforms[p.key], proposed.platforms[p.key])}
                error={err(`rates.${p.key}`)}
                onChange={(text) => {
                  setState((s) => ({
                    ...s,
                    rates: {
                      ...s.rates,
                      platforms: { ...s.rates.platforms, [p.key as PlatformKey]: text },
                    },
                  }))
                  clearError(`rates.${p.key}`)
                }}
              />
            </Method>
          ))}
        </Group>

        <Single icon={NotebookPen}>
          <Method
            id="wz-m-customer_account"
            name="Cuenta corriente"
            flow="Queda en la cuenta de cada cliente (por ejemplo, eventos)"
            checked={methods.customer_account}
            onChange={toggle('customer_account')}
          />
        </Single>

        {err('methods') ? (
          <p role="alert" className="text-sm text-destructive">
            {err('methods')}
          </p>
        ) : null}
        {err('rates') ? (
          <p role="alert" className="text-sm text-destructive">
            {err('rates')}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground text-pretty">
          Los porcentajes sirven para precargar los cobros: nunca se registran solos. El orden y los
          días los cambiás después en Ajustes › Medios de cobro.
        </p>
      </div>

      <div className="mx-auto w-full max-w-sm xl:sticky xl:top-20">
        <CloseColumnTicket names={column} note="Así va a quedar tu columna en el cierre del día." />
      </div>
    </div>
  )
}
