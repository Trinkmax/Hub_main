'use client'

import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { saveSalesMethod } from '@/lib/accounting/actions/master'
import type { SalesMethodRow } from '@/lib/accounting/queries/settings'
import type { Channel, PartyKind, SalesMethodKind, TreasuryKind } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { SALES_METHOD_KIND_LABELS } from '../_lib/labels'
import { EditDialog } from './edit-dialog'
import { describedBy, Field } from './form-bits'
import { INPUT_CLASS } from './inputs'
import { useMasterAction } from './use-master-action'

export type MethodTreasury = { id: string; name: string; kind: TreasuryKind; active: boolean }
export type MethodParty = {
  id: string
  name: string
  kind: PartyKind
  systemKey: string | null
  active: boolean
}

const CHANNELS: ReadonlyArray<{ value: Channel; label: string }> = [
  { value: 'salon', label: 'Salón' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'events', label: 'Eventos' },
]
const CHANNEL_LABEL: Readonly<Record<Channel, string>> = {
  salon: 'Salón',
  delivery: 'Delivery',
  events: 'Eventos',
}

const KINDS = Object.keys(SALES_METHOD_KIND_LABELS) as SalesMethodKind[]

const needsTreasury = (k: SalesMethodKind) => k === 'treasury' || k === 'settled_now'
const needsParty = (k: SalesMethodKind) =>
  k === 'settled_now' || k === 'receivable' || k === 'advance'

/** Quién puede acreditar cada tipo de medio (la base lo vuelve a validar). */
function partyFits(kind: SalesMethodKind, p: MethodParty): boolean {
  if (kind === 'settled_now') return p.kind === 'payment_wallet'
  if (kind === 'receivable') {
    return (
      p.kind === 'card_processor' || p.kind === 'payment_wallet' || p.kind === 'delivery_platform'
    )
  }
  if (kind === 'advance') return p.systemKey === 'senas'
  return false
}

type Draft = {
  id: string | null
  updatedAt: string | null
  name: string
  kind: SalesMethodKind
  channel: Channel
  treasuryId: string | null
  partyId: string | null
  days: string
  active: boolean
}

function draftOf(m: SalesMethodRow | null): Draft {
  return m
    ? {
        id: m.id,
        updatedAt: m.updatedAt,
        name: m.name,
        kind: m.kind,
        channel: m.channel,
        treasuryId: m.treasuryAccountId,
        partyId: m.partyId,
        days: String(m.settlementDays),
        active: m.active,
      }
    : {
        id: null,
        updatedAt: null,
        name: '',
        kind: 'treasury',
        channel: 'salon',
        treasuryId: null,
        partyId: null,
        days: '0',
        active: true,
      }
}

function rowPayload(m: SalesMethodRow, patch: Record<string, unknown> = {}) {
  return {
    id: m.id,
    expectedUpdatedAt: m.updatedAt,
    name: m.name,
    kind: m.kind,
    channel: m.channel,
    treasuryAccountId: m.treasuryAccountId,
    partyId: m.partyId,
    settlementDays: m.settlementDays,
    active: m.active,
    sort: m.sort,
    ...patch,
  }
}

function destinationText(m: SalesMethodRow): string {
  // La billetera y quien acredita suelen llamarse igual («Mercado Pago · Mercado Pago»): una vez.
  const parts = [m.treasuryName, m.partyName].filter((p): p is string => Boolean(p))
  return parts.filter((p, i) => parts.indexOf(p) === i).join(' · ')
}

/**
 * Ajustes › Medios de cobro (H.17): los del cierre del día, en su orden. Lo
 * que pasa con lo cobrado se dice en palabras; el orden se cambia con las
 * flechas (es el orden de Thinkeon).
 */
export function MethodsPanel({
  tenantSlug,
  methods,
  treasuries,
  parties,
  readOnly,
}: {
  tenantSlug: string
  methods: readonly SalesMethodRow[]
  treasuries: readonly MethodTreasury[]
  parties: readonly MethodParty[]
  readOnly: boolean
}) {
  const { pending, run } = useMasterAction()
  const [editing, setEditing] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  const open = (m: SalesMethodRow | null) => {
    setEditing(draftOf(m))
    setErrors({})
    setMessage(null)
  }

  const onFailure = (state: AccFailureState) => {
    setErrors(state.fieldErrors ?? {})
    setMessage(
      state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? null : state.message,
    )
  }

  const save = () => {
    if (!editing) return
    const d = editing
    const days = d.kind === 'receivable' ? d.days : '0'
    run(
      () =>
        saveSalesMethod(tenantSlug, {
          ...(d.id ? { id: d.id, expectedUpdatedAt: d.updatedAt } : {}),
          name: d.name,
          kind: d.kind,
          channel: d.channel,
          treasuryAccountId: needsTreasury(d.kind) ? d.treasuryId : null,
          partyId: needsParty(d.kind) ? d.partyId : null,
          settlementDays: days,
          active: d.active,
        }),
      { onSuccess: () => setEditing(null), onFailure },
    )
  }

  const move = (index: number, dir: -1 | 1) => {
    const a = methods[index]
    const b = methods[index + dir]
    if (!a || !b) return
    let sortA = b.sort
    const sortB = a.sort
    if (sortA === sortB) sortA = Math.max(0, b.sort + dir)
    run(
      async () => {
        const first = await saveSalesMethod(tenantSlug, rowPayload(a, { sort: sortA }))
        if (!first.ok) return first
        return saveSalesMethod(tenantSlug, rowPayload(b, { sort: sortB }))
      },
      { quiet: true },
    )
  }

  const toggle = (m: SalesMethodRow, active: boolean) =>
    run(() => saveSalesMethod(tenantSlug, rowPayload(m, { active })))

  const err = (k: string) => errors[k] ?? null
  const kindTreasuries = treasuries.filter(
    (t) => (t.active || t.id === editing?.treasuryId) && t.kind !== 'credit_card',
  )
  const kindParties = editing
    ? parties.filter(
        (p) =>
          partyFits(editing.kind, p) &&
          (p.active || p.id === editing.partyId || p.systemKey === 'senas'),
      )
    : []

  return (
    <div className="space-y-4">
      <section className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-serif text-lg font-semibold tracking-tight">Medios de cobro</h3>
            <p className="text-xs text-muted-foreground">
              En el orden en que aparecen en el cierre del día.
            </p>
          </div>
          {readOnly ? null : (
            <Button type="button" className="h-11 gap-2 md:h-9" onClick={() => open(null)}>
              <Plus className="size-4" aria-hidden />
              Agregar medio
            </Button>
          )}
        </header>
        {methods.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Todavía no hay medios de cobro.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {methods.map((m, index) => {
              const destination = destinationText(m)
              const details = [
                SALES_METHOD_KIND_LABELS[m.kind],
                CHANNEL_LABEL[m.channel],
                destination || null,
                m.kind === 'receivable' && m.settlementDays > 0
                  ? `se acredita en ${m.settlementDays} ${m.settlementDays === 1 ? 'día' : 'días'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <li
                  key={m.id}
                  className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className={cn('min-w-0 space-y-0.5', !m.active && 'opacity-60')}>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground text-pretty">{details}</p>
                  </div>
                  {readOnly ? (
                    <Badge
                      variant={m.active ? 'outline' : 'muted'}
                      className={
                        m.active ? 'border-success/30 bg-success/10 text-success' : undefined
                      }
                    >
                      {m.active ? 'Prendido' : 'Apagado'}
                    </Badge>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground"
                        disabled={pending || index === 0}
                        aria-label={`Subir ${m.name}`}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground"
                        disabled={pending || index === methods.length - 1}
                        aria-label={`Bajar ${m.name}`}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground hover:text-foreground"
                        aria-label={`Editar ${m.name}`}
                        onClick={() => open(m)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Switch
                        checked={m.active}
                        disabled={pending}
                        onCheckedChange={(checked) => toggle(m, checked)}
                        aria-label={m.active ? `Apagar ${m.name}` : `Prender ${m.name}`}
                        className="ml-2"
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {readOnly ? null : (
        <EditDialog
          open={editing !== null}
          onOpenChange={(next) => {
            if (!next) setEditing(null)
          }}
          title={editing?.id ? 'Editar medio de cobro' : 'Nuevo medio de cobro'}
          description="Así aparece en el cierre del día y así se registra lo cobrado."
          pending={pending}
          message={message}
          onSubmit={save}
        >
          {editing ? (
            <>
              <Field id="mc-name" label="Nombre" required error={err('name')}>
                <Input
                  id="mc-name"
                  value={editing.name}
                  maxLength={40}
                  aria-invalid={err('name') ? true : undefined}
                  aria-describedby={describedBy('mc-name', null, err('name'))}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field id="mc-kind" label="¿Qué pasa con lo cobrado?" error={err('kind')}>
                <Select
                  value={editing.kind}
                  onValueChange={(v) => {
                    const kind = v as SalesMethodKind
                    const current = parties.find((p) => p.id === editing.partyId)
                    setEditing({
                      ...editing,
                      kind,
                      // El que acredita queda solo si sirve para el tipo nuevo.
                      partyId: current && partyFits(kind, current) ? current.id : null,
                    })
                  }}
                >
                  <SelectTrigger
                    id="mc-kind"
                    className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {SALES_METHOD_KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="mc-channel" label="Canal" error={err('channel')}>
                <Select
                  value={editing.channel}
                  onValueChange={(v) => setEditing({ ...editing, channel: v as Channel })}
                >
                  <SelectTrigger
                    id="mc-channel"
                    className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {needsTreasury(editing.kind) ? (
                <Field id="mc-treasury" label="Entra a" error={err('treasuryAccountId')}>
                  <Select
                    value={editing.treasuryId ?? undefined}
                    onValueChange={(v) => setEditing({ ...editing, treasuryId: v })}
                  >
                    <SelectTrigger
                      id="mc-treasury"
                      className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                      aria-invalid={err('treasuryAccountId') ? true : undefined}
                    >
                      <SelectValue placeholder="Elegí la caja" />
                    </SelectTrigger>
                    <SelectContent>
                      {kindTreasuries.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              {needsParty(editing.kind) ? (
                <Field id="mc-party" label="¿Quién lo acredita?" error={err('partyId')}>
                  <Select
                    value={editing.partyId ?? undefined}
                    onValueChange={(v) => setEditing({ ...editing, partyId: v })}
                  >
                    <SelectTrigger
                      id="mc-party"
                      className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
                      aria-invalid={err('partyId') ? true : undefined}
                    >
                      <SelectValue placeholder="Elegí quién" />
                    </SelectTrigger>
                    <SelectContent>
                      {kindParties.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          No hay a quién elegir.
                        </div>
                      ) : (
                        kindParties.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              {editing.kind === 'receivable' ? (
                <Field
                  id="mc-days"
                  label="Días para acreditarse"
                  hint="De 0 a 120. Sirve para saber cuándo vence lo que te deben."
                  error={err('settlementDays')}
                >
                  <Input
                    id="mc-days"
                    value={editing.days}
                    inputMode="numeric"
                    maxLength={3}
                    aria-invalid={err('settlementDays') ? true : undefined}
                    aria-describedby={describedBy('mc-days', true, err('settlementDays'))}
                    onChange={(e) =>
                      setEditing({ ...editing, days: e.target.value.replace(/\D/g, '') })
                    }
                    className={cn(INPUT_CLASS, 'w-24 tabular-nums')}
                  />
                </Field>
              ) : null}
            </>
          ) : null}
        </EditDialog>
      )}
    </div>
  )
}
