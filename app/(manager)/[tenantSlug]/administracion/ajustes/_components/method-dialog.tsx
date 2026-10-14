'use client'

import { useState } from 'react'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { ChoiceCard } from '@/components/administracion/kit/choice-card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { saveSalesMethod } from '@/lib/accounting/actions/master'
import type { SalesMethodRow } from '@/lib/accounting/queries/settings'
import type { Channel, PartyKind, SalesMethodKind, TreasuryKind } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { SALES_METHOD_KIND_LABELS } from '../_lib/labels'
import {
  type MethodDraft,
  methodDraftOf,
  methodNeedsParty,
  methodNeedsTreasury,
  methodPartyFits,
  methodSavePayload,
} from '../_lib/payloads'
import { EditDialog } from './edit-dialog'
import { describedBy, Field } from './form-bits'
import { INPUT_CLASS } from './inputs'
import { useMasterAction } from './use-master-action'

/**
 * Alta y edición de un medio de cobro. Manda lo mismo de siempre
 * (`methodSavePayload`, fijado por un test); lo que cambió es cómo se
 * pregunta: «¿Qué pasa con lo cobrado?» son cinco tarjetas con su consecuencia
 * (antes, un desplegable), y el canal, la caja y quién paga son chips cuando
 * hay pocas opciones.
 */

export type MethodTreasury = { id: string; name: string; kind: TreasuryKind; active: boolean }
export type MethodParty = {
  id: string
  name: string
  kind: PartyKind
  systemKey: string | null
  active: boolean
}

const KIND_ORDER: readonly SalesMethodKind[] = [
  'treasury',
  'settled_now',
  'receivable',
  'customer_account',
  'advance',
]

const KIND_CONSEQUENCE: Readonly<Record<SalesMethodKind, string>> = {
  treasury: 'Efectivo, o una transferencia directa al banco.',
  settled_now: 'QR y transferencias: llega en el momento, menos la comisión.',
  receivable: 'Tarjetas y apps: te lo depositan unos días más tarde.',
  customer_account: 'Se lo anotás a un cliente y te paga después.',
  advance: 'Se descuenta de una seña que ya entró.',
}

const CHANNELS: readonly ChoiceChip<Channel>[] = [
  { value: 'salon', label: 'Salón' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'events', label: 'Eventos' },
]

/** Con más opciones que estas, los chips no se leen: va el desplegable de siempre. */
const CHIPS_MAX = 6

const SELECT_TRIGGER = 'w-full data-[size=default]:h-11 md:data-[size=default]:h-10'

export function MethodDialog({
  tenantSlug,
  target,
  onClose,
  treasuries,
  parties,
}: {
  tenantSlug: string
  /** El medio a editar, `'new'` para un alta, o `null` = cerrado. */
  target: SalesMethodRow | 'new' | null
  onClose: () => void
  treasuries: readonly MethodTreasury[]
  parties: readonly MethodParty[]
}) {
  const { pending, run } = useMasterAction()
  const [seen, setSeen] = useState<SalesMethodRow | 'new' | null>(null)
  const [draft, setDraft] = useState<MethodDraft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  if (target !== seen) {
    setSeen(target)
    if (target) {
      setDraft(methodDraftOf(target === 'new' ? null : target))
      setErrors({})
      setMessage(null)
    }
  }

  const onFailure = (state: AccFailureState) => {
    setErrors(state.fieldErrors ?? {})
    setMessage(
      state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? null : state.message,
    )
  }

  const save = () => {
    if (!draft) return
    run(() => saveSalesMethod(tenantSlug, methodSavePayload(draft)), {
      onSuccess: onClose,
      onFailure,
    })
  }

  const err = (k: string) => errors[k] ?? null
  const set = (patch: Partial<MethodDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const kindTreasuries = treasuries.filter(
    (t) => (t.active || t.id === draft?.treasuryId) && t.kind !== 'credit_card',
  )
  const kindParties = draft
    ? parties.filter(
        (p) =>
          methodPartyFits(draft.kind, p) &&
          (p.active || p.id === draft.partyId || p.systemKey === 'senas'),
      )
    : []

  return (
    <EditDialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={draft?.id ? 'Editar medio de cobro' : 'Nuevo medio de cobro'}
      description="Así aparece en el cierre del día y así se registra lo cobrado."
      pending={pending}
      message={message}
      onSubmit={save}
    >
      {draft ? (
        <>
          <Field id="mc-name" label="Nombre" required error={err('name')}>
            <Input
              id="mc-name"
              value={draft.name}
              maxLength={40}
              aria-invalid={err('name') ? true : undefined}
              aria-describedby={describedBy('mc-name', null, err('name'))}
              onChange={(e) => set({ name: e.target.value })}
              className={INPUT_CLASS}
            />
          </Field>

          <fieldset className="m-0 grid min-w-0 border-0 p-0">
            <legend className="mb-2.5 p-0 text-sm font-medium">¿Qué pasa con lo cobrado?</legend>
            <div className="grid gap-2">
              {KIND_ORDER.map((kind) => (
                <ChoiceCard
                  key={kind}
                  name="mc-kind"
                  value={kind}
                  title={SALES_METHOD_KIND_LABELS[kind]}
                  consequence={KIND_CONSEQUENCE[kind]}
                  checked={draft.kind === kind}
                  onChange={() => {
                    const current = parties.find((p) => p.id === draft.partyId)
                    set({
                      kind,
                      // Quien paga queda solo si sirve para el tipo nuevo.
                      partyId: current && methodPartyFits(kind, current) ? current.id : null,
                    })
                  }}
                />
              ))}
            </div>
            {err('kind') ? (
              <p role="alert" className="mt-1.5 text-xs text-destructive">
                {err('kind')}
              </p>
            ) : null}
          </fieldset>

          <div className="grid gap-1.5">
            <Label id="mc-channel-label">Canal</Label>
            <ChoiceChips
              options={CHANNELS}
              value={draft.channel}
              labelledBy="mc-channel-label"
              onChange={(channel) => set({ channel })}
            />
            <p className="text-xs text-muted-foreground">
              Decide en qué parte del cierre del día aparece.
            </p>
            {err('channel') ? (
              <p role="alert" className="text-xs text-destructive">
                {err('channel')}
              </p>
            ) : null}
          </div>

          {methodNeedsTreasury(draft.kind) ? (
            <Picker
              id="mc-treasury"
              label="Entra a"
              placeholder="Elegí la caja"
              empty="No hay cajas en uso."
              value={draft.treasuryId}
              options={kindTreasuries}
              error={err('treasuryAccountId')}
              onChange={(treasuryId) => set({ treasuryId })}
            />
          ) : null}

          {methodNeedsParty(draft.kind) ? (
            <Picker
              id="mc-party"
              label="¿Quién te lo paga?"
              placeholder="Elegí quién"
              empty="No hay a quién elegir."
              value={draft.partyId}
              options={kindParties}
              error={err('partyId')}
              onChange={(partyId) => set({ partyId })}
            />
          ) : null}

          {draft.kind === 'receivable' ? (
            <Field
              id="mc-days"
              label="¿A los cuántos días te lo depositan?"
              hint="De 0 a 120. Sirve para saber cuándo llega lo que te deben."
              error={err('settlementDays')}
            >
              <Input
                id="mc-days"
                value={draft.days}
                inputMode="numeric"
                maxLength={3}
                aria-invalid={err('settlementDays') ? true : undefined}
                aria-describedby={describedBy('mc-days', true, err('settlementDays'))}
                onChange={(e) => set({ days: e.target.value.replace(/\D/g, '') })}
                className={cn(INPUT_CLASS, 'w-24 tabular-nums')}
              />
            </Field>
          ) : null}
        </>
      ) : null}
    </EditDialog>
  )
}

/** Una elección por nombre: chips con hasta seis opciones; con más, el desplegable. */
function Picker({
  id,
  label,
  placeholder,
  empty,
  value,
  options,
  error,
  onChange,
}: {
  id: string
  label: string
  placeholder: string
  empty: string
  value: string | null
  options: ReadonlyArray<{ id: string; name: string }>
  error: string | null
  onChange: (id: string) => void
}) {
  const labelId = `${id}-label`
  return (
    <div className="grid gap-1.5">
      <Label id={labelId} htmlFor={options.length > CHIPS_MAX ? id : undefined}>
        {label}
      </Label>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : options.length <= CHIPS_MAX ? (
        <ChoiceChips
          options={options.map((o) => ({ value: o.id, label: o.name }))}
          value={value}
          labelledBy={labelId}
          onChange={onChange}
        />
      ) : (
        <Select value={value ?? undefined} onValueChange={onChange}>
          <SelectTrigger id={id} className={SELECT_TRIGGER} aria-invalid={error ? true : undefined}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
