'use client'

import { ArrowRight, Pencil, Plus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { type ChoiceChip, ChoiceChips } from '@/components/administracion/cajas-ventas/choice-chips'
import { EmptyTeach } from '@/components/administracion/kit/empty-teach'
import { Panel } from '@/components/administracion/kit/panel'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { AccFailureState } from '@/lib/accounting/action-state'
import { saveSalesPoint } from '@/lib/accounting/actions/master'
import type { SalesPointRow } from '@/lib/accounting/queries/settings'
import type { Channel } from '@/lib/accounting/types'
import { padPv } from '@/lib/fiscal'
import { cn } from '@/lib/utils'
import {
  type SalesPointDraft,
  salesPointDraftOf,
  salesPointSavePayload,
  salesPointTogglePayload,
} from '../_lib/payloads'
import { ARCA_STATE_WORDS, type ArcaTileState } from '../_lib/portada'
import { ArcaCable } from './arca-cable'
import { EditDialog } from './edit-dialog'
import { describedBy, Field } from './form-bits'
import { INPUT_CLASS } from './inputs'
import { InvoiceNumber } from './invoice-number'
import { useMasterAction } from './use-master-action'

/**
 * Ajustes › Puntos de venta: el número con el que salen las facturas del bar.
 * El objeto es una factura con su número señalado: el dueño mira cualquiera de
 * las que entrega hoy y copia los cuatro dígitos de adelante.
 *
 * Mismas acciones y mismos envíos (`salesPointSavePayload`,
 * `salesPointTogglePayload`). Debajo, dos franjas que dicen de qué depende:
 * qué pasa con lo que no se factura (queda registrado igual) y cómo está la
 * conexión con ARCA para facturar desde acá.
 */

const CHANNELS: readonly ChoiceChip<Channel>[] = [
  { value: 'salon', label: 'Salón' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'events', label: 'Eventos' },
]
const CHANNEL_LABEL: Readonly<Record<Channel, string>> = {
  salon: 'Salón',
  delivery: 'Delivery',
  events: 'Eventos',
}

const TEXT_LINK =
  'inline-flex min-h-11 items-center gap-1 rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0'

export function SalesPointsPanel({
  tenantSlug,
  points,
  readOnly,
  arca,
}: {
  tenantSlug: string
  points: readonly SalesPointRow[]
  readOnly: boolean
  /** Cómo está la conexión con ARCA. `null` = no se pudo leer: la franja dice solo «Abrir ARCA». */
  arca: ArcaTileState | null
}) {
  const base = `/${tenantSlug}/administracion`
  const { pending, run } = useMasterAction()
  const [editing, setEditing] = useState<SalesPointDraft | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  const open = (p: SalesPointRow | null) => {
    setEditing(salesPointDraftOf(p))
    setErrors({})
    setMessage(null)
    setDialogOpen(true)
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
    run(() => saveSalesPoint(tenantSlug, salesPointSavePayload(editing)), {
      onSuccess: () => setDialogOpen(false),
      onFailure,
    })
  }

  const toggle = (p: SalesPointRow, active: boolean) =>
    run(() => saveSalesPoint(tenantSlug, salesPointTogglePayload(p, active)))

  const err = (k: string) => errors[k] ?? null
  const first = points.find((p) => p.active)?.number ?? points[0]?.number ?? null
  const preview =
    editing && /^\d{1,5}$/.test(editing.number) ? padPv(Number(editing.number), 4) : null

  return (
    <div className="space-y-6">
      {points.length === 0 ? (
        <EmptyTeach
          title="Todavía no cargaste con qué número facturás"
          illustration={<InvoiceNumber number={3} className="mx-auto" />}
          example
          action={
            readOnly ? undefined : (
              <Button type="button" className="h-11 gap-2" onClick={() => open(null)}>
                <Plus className="size-4" aria-hidden />
                Agregar el primero
              </Button>
            )
          }
          secondary={readOnly ? undefined : 'Si todavía no facturan, dejalo así.'}
        >
          Sin puntos de venta, todo el día queda como venta sin factura: se registra igual, pero no
          se separa lo facturado. Mirá cualquier factura o tique de los que entregan hoy: son los
          cuatro números de adelante.
        </EmptyTeach>
      ) : (
        <Panel>
          <div className="grid gap-5 md:grid-cols-[19rem_minmax(0,1fr)] md:items-start md:gap-6">
            <div className="space-y-3">
              <InvoiceNumber number={first} />
              <p className="max-w-[19rem] text-sm text-muted-foreground text-pretty">
                Mirá cualquier factura o tique de los que entregan hoy: son los cuatro números de
                adelante.
              </p>
            </div>
            <ul className="divide-y divide-border/60">
              {points.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3 first:pt-0 sm:gap-4">
                  <span
                    className={cn(
                      'shrink-0 font-mono text-2xl leading-none font-semibold tabular-nums',
                      !p.active && 'text-muted-foreground',
                    )}
                  >
                    {padPv(p.number, 4)}
                  </span>
                  <div className={cn('min-w-0 flex-1', !p.active && 'opacity-60')}>
                    <p className="truncate text-sm font-medium" title={p.label}>
                      {p.label}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {/* La píldora dice qué es: sola, «Salón» debajo de «Salón» no explicaba nada. */}
                      <StatusPill tone="muted">
                        En el cierre: {CHANNEL_LABEL[p.defaultChannel]}
                      </StatusPill>
                      {p.active ? null : <StatusPill tone="muted">Sin usar</StatusPill>}
                    </p>
                  </div>
                  {readOnly ? null : (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground hover:text-foreground md:size-9"
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
                      />
                    </div>
                  )}
                </li>
              ))}
              {readOnly ? null : (
                <li className="pt-3">
                  <button
                    type="button"
                    onClick={() => open(null)}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm font-medium outline-none transition-colors hover:border-primary/40 hover:bg-cream-tint focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Plus className="size-4" aria-hidden />
                    Agregar un punto de venta
                  </button>
                </li>
              )}
            </ul>
          </div>
        </Panel>
      )}

      {/* Lo que no se factura: una franja, sin tarjeta. */}
      <section
        aria-labelledby="aj-pv-sin-factura"
        className="rounded-2xl bg-secondary/50 p-4 sm:p-5"
      >
        <h2 id="aj-pv-sin-factura" className="text-sm font-semibold">
          Lo que no se factura
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground text-pretty">
          En el cierre del día cargás lo vendido y, aparte, qué números facturaste. La diferencia
          queda como venta sin factura. Con factura o sin factura, todo queda registrado en los
          libros.
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <Link href={`${base}/guias/con-y-sin-factura`} className={TEXT_LINK}>
            Ver con factura y sin factura
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <Link
            href={`${base}/ajustes?tab=ejercicio#reglas`}
            className={cn(TEXT_LINK, 'font-normal text-muted-foreground')}
          >
            Cómo se anota lo define la contadora
          </Link>
        </p>
      </section>

      {/* Facturar desde acá: el estado de ARCA y el link a su habitación. */}
      <section
        aria-labelledby="aj-pv-arca"
        className="flex flex-col gap-4 rounded-2xl bg-secondary/50 p-4 sm:flex-row sm:items-center sm:p-5"
      >
        <div className="min-w-0 flex-1">
          <h2 id="aj-pv-arca" className="text-sm font-semibold">
            Facturar desde acá
          </h2>
          <div className="mt-2 flex items-center gap-3">
            {arca ? <ArcaCable state={arca} size="sm" className="w-[4.5rem] shrink-0" /> : null}
            <p className="text-sm">{arca ? ARCA_STATE_WORDS[arca] : 'La conexión con ARCA'}</p>
          </div>
          <p className="mt-2 max-w-prose text-xs text-muted-foreground text-pretty">
            El punto de venta de la plataforma lo crea solo «Conectar ARCA»: no lo cargues a mano.
          </p>
        </div>
        <Button asChild variant="outline" className="h-11 shrink-0 gap-2 rounded-full px-5">
          <Link href={`${base}/ajustes?tab=arca`}>
            Abrir ARCA
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </section>

      {readOnly ? null : (
        <EditDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={editing?.id ? 'Editar punto de venta' : 'Nuevo punto de venta'}
          description="Son los cuatro números de adelante de tus facturas."
          pending={pending}
          message={message}
          onSubmit={save}
        >
          {editing ? (
            <>
              <div className="grid gap-3 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
                <Field
                  id="pv-number"
                  label="Número"
                  required
                  hint="Por ejemplo, 3."
                  error={err('number')}
                >
                  <Input
                    id="pv-number"
                    value={editing.number}
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="3"
                    aria-invalid={err('number') ? true : undefined}
                    aria-describedby={describedBy('pv-number', true, err('number'))}
                    onChange={(e) =>
                      setEditing({ ...editing, number: e.target.value.replace(/\D/g, '') })
                    }
                    className={cn(INPUT_CLASS, 'font-mono tabular-nums')}
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
              {/* Cómo sale en la factura, mientras se escribe: el mismo número rodeado del dibujo. */}
              <p
                aria-live="polite"
                className="-mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted-foreground"
              >
                En tus facturas sale
                <span className="inline-flex items-baseline font-mono text-lg leading-none font-semibold tabular-nums">
                  <span
                    className={cn(
                      'rounded-md px-1 py-0.5',
                      preview
                        ? 'text-foreground ring-2 ring-destructive'
                        : 'border border-dashed border-muted-foreground/60',
                    )}
                  >
                    {preview ?? '????'}
                  </span>
                  <span>-00001234</span>
                </span>
              </p>
              <div className="grid gap-1.5">
                {/* La misma pregunta que en la puesta en marcha (antes decía «Canal»). */}
                <Label id="pv-channel-label">¿A qué parte del cierre del día va?</Label>
                <ChoiceChips
                  options={CHANNELS}
                  value={editing.channel}
                  labelledBy="pv-channel-label"
                  onChange={(channel) => setEditing({ ...editing, channel })}
                />
                {err('defaultChannel') ? (
                  <p role="alert" className="text-xs text-destructive">
                    {err('defaultChannel')}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </EditDialog>
      )}
    </div>
  )
}
