'use client'

import { Pencil, Plus } from 'lucide-react'
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
import { saveSalesPoint } from '@/lib/accounting/actions/master'
import type { SalesPointRow } from '@/lib/accounting/queries/settings'
import type { Channel } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { EditDialog } from './edit-dialog'
import { describedBy, Field } from './form-bits'
import { INPUT_CLASS } from './inputs'
import { useMasterAction } from './use-master-action'

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

type Draft = {
  id: string | null
  updatedAt: string | null
  number: string
  label: string
  channel: Channel
}

/** «0003» como en las facturas. */
function pv(n: number): string {
  return String(n).padStart(4, '0')
}

/**
 * Ajustes › Puntos de venta (H.17): con qué puntos factura la SAS y de qué
 * canal es cada uno (el cierre del día propone los rangos con esto).
 */
export function SalesPointsPanel({
  tenantSlug,
  points,
  readOnly,
}: {
  tenantSlug: string
  points: readonly SalesPointRow[]
  readOnly: boolean
}) {
  const { pending, run } = useMasterAction()
  const [editing, setEditing] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  const open = (p: SalesPointRow | null) => {
    setEditing(
      p
        ? {
            id: p.id,
            updatedAt: p.updatedAt,
            number: String(p.number),
            label: p.label,
            channel: p.defaultChannel,
          }
        : { id: null, updatedAt: null, number: '', label: '', channel: 'salon' },
    )
    setErrors({})
    setMessage(null)
  }

  const onFailure = (state: AccFailureState) => {
    const fields = { ...(state.fieldErrors ?? {}) }
    const key = typeof state.detail?.key === 'string' ? state.detail.key : null
    if (key === 'sales_point_taken' && !fields.number) fields.number = state.message
    setErrors(fields)
    setMessage(Object.keys(fields).length > 0 ? null : state.message)
  }

  const save = () => {
    if (!editing) return
    const d = editing
    const label = d.label.trim() || (d.number ? `Punto de venta ${Number(d.number)}` : '')
    run(
      () =>
        saveSalesPoint(tenantSlug, {
          ...(d.id ? { id: d.id, expectedUpdatedAt: d.updatedAt } : {}),
          number: d.number,
          label,
          defaultChannel: d.channel,
        }),
      { onSuccess: () => setEditing(null), onFailure },
    )
  }

  const toggle = (p: SalesPointRow, active: boolean) =>
    run(() =>
      saveSalesPoint(tenantSlug, {
        id: p.id,
        expectedUpdatedAt: p.updatedAt,
        number: p.number,
        label: p.label,
        defaultChannel: p.defaultChannel,
        active,
      }),
    )

  const err = (k: string) => errors[k] ?? null

  return (
    <div className="space-y-4">
      <section className="card-hairline overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-serif text-lg font-semibold tracking-tight">Puntos de venta</h3>
            <p className="text-xs text-muted-foreground">
              «0003-00001234» es el punto de venta 3. El canal decide en qué parte del cierre del
              día aparece.
            </p>
          </div>
          {readOnly ? null : (
            <Button type="button" className="h-11 gap-2 md:h-9" onClick={() => open(null)}>
              <Plus className="size-4" aria-hidden />
              Agregar punto de venta
            </Button>
          )}
        </header>
        {points.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            Todavía no hay puntos de venta. Si la SAS todavía no factura, no hace falta cargar
            ninguno.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {points.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className={cn('min-w-0 space-y-0.5', !p.active && 'opacity-60')}>
                  <p className="text-sm font-medium">
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {pv(p.number)}
                    </span>{' '}
                    {p.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Canal: {CHANNEL_LABEL[p.defaultChannel]}
                  </p>
                </div>
                {readOnly ? (
                  <Badge variant={p.active ? 'outline' : 'muted'}>
                    {p.active ? 'Activo' : 'Desactivado'}
                  </Badge>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 text-muted-foreground hover:text-foreground"
                      aria-label={`Editar el punto de venta ${p.number}`}
                      onClick={() => open(p)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Switch
                      checked={p.active}
                      disabled={pending}
                      onCheckedChange={(checked) => toggle(p, checked)}
                      aria-label={
                        p.active
                          ? `Desactivar el punto de venta ${p.number}`
                          : `Activar el punto de venta ${p.number}`
                      }
                      className="ml-2"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {readOnly ? null : (
        <EditDialog
          open={editing !== null}
          onOpenChange={(next) => {
            if (!next) setEditing(null)
          }}
          title={editing?.id ? 'Editar punto de venta' : 'Nuevo punto de venta'}
          pending={pending}
          message={message}
          onSubmit={save}
        >
          {editing ? (
            <>
              <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <Field id="pv-number" label="Número" required error={err('number')}>
                  <Input
                    id="pv-number"
                    value={editing.number}
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="3"
                    aria-invalid={err('number') ? true : undefined}
                    aria-describedby={describedBy('pv-number', null, err('number'))}
                    onChange={(e) =>
                      setEditing({ ...editing, number: e.target.value.replace(/\D/g, '') })
                    }
                    className={cn(INPUT_CLASS, 'tabular-nums')}
                  />
                </Field>
                <Field id="pv-label" label="Nombre" optional error={err('label')}>
                  <Input
                    id="pv-label"
                    value={editing.label}
                    maxLength={60}
                    placeholder="Salón"
                    aria-invalid={err('label') ? true : undefined}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </Field>
              </div>
              <Field id="pv-channel" label="Canal" error={err('defaultChannel')}>
                <Select
                  value={editing.channel}
                  onValueChange={(v) => setEditing({ ...editing, channel: v as Channel })}
                >
                  <SelectTrigger
                    id="pv-channel"
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
            </>
          ) : null}
        </EditDialog>
      )}
    </div>
  )
}
