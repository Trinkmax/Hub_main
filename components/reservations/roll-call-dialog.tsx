'use client'

import { Check, ClipboardCheck } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { NumberField } from '@/components/ui/number-field'
import { Skeleton } from '@/components/ui/skeleton'
import { bulkUpdateActualGuests } from '@/lib/salon/actions'
import { fetchReservationsForDate } from '@/lib/salon/client-actions'
import { hhmm } from '@/lib/salon/format'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * "Pasar lista": el barrido de fin de noche.
 *
 * El problema que resuelve: de 137 reservas del bar, 114 no tenían la
 * asistencia real cargada y 111 seguían en "pendiente". No era desidia — el
 * contador vivía a cuatro toques dentro de un sheet de excepciones, una reserva
 * por vez. Acá el encargado ve la noche entera, toca los que difieren y guarda
 * una sola vez.
 *
 * Las que están en `pending` además pasan a "llegó" al guardarse: si alguien
 * anota que vinieron 18, vinieron.
 */
export function RollCallDialog({
  tenantSlug,
  day,
  dayLabel,
}: {
  tenantSlug: string
  /** yyyy-MM-dd del día que se está pasando. */
  day: string
  dayLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [rows, setRows] = useState<ReservationWithJoins[] | null>(null)
  const [loading, setLoading] = useState(false)

  // El día COMPLETO, pedido al abrir. No se puede usar la lista de la página:
  // está paginada y filtrada por los filtros activos, así que un viernes
  // cargado (o con un filtro de zona puesto) dejaría reservas afuera del cierre
  // sin decirlo. Y pedirlo al abrir en vez de en cada carga de la agenda evita
  // una query que casi nadie usa.
  function load() {
    setLoading(true)
    void fetchReservationsForDate(tenantSlug, day).then((res) => {
      setLoading(false)
      if (res.ok) setRows(res.reservations)
      else toast.error(res.message)
    })
  }

  // Solo lo que puede tener asistencia. Canceladas y no-show quedan afuera: no
  // hay nada que contar y ocuparían la pantalla del cierre.
  const candidates = useMemo(
    () => (rows ?? []).filter((r) => r.status !== 'cancelled' && r.status !== 'no_show'),
    [rows],
  )
  const missing = useMemo(
    () => candidates.filter((r) => r.actual_guests === null).length,
    [candidates],
  )

  // Borrador local. Solo entra acá lo que el encargado CONFIRMÓ, tocando el
  // número o el tilde de la fila. Una fila que no tocó no se manda.
  //
  // La versión anterior mandaba también las que nunca se habían contado, con el
  // estimado como valor: abrir el diálogo y tocar "Guardar todo" daba por
  // asistida la noche entera, marcaba 40 reservas como llegadas y liquidaba las
  // comisiones de golpe. Inventaba justo el dato que el dueño quiere medir.
  const [draft, setDraft] = useState<Record<string, number>>({})
  const countFor = (r: ReservationWithJoins) => draft[r.id] ?? r.actual_guests ?? r.estimated_guests

  const toSave = useMemo(
    () =>
      candidates
        .filter((r) => draft[r.id] !== undefined)
        .map((r) => ({ id: r.id, actual_guests: draft[r.id] as number })),
    [candidates, draft],
  )

  /**
   * Atajo para la noche normal, en la que casi todos vinieron como reservaron.
   * Explícito y con su propio botón a propósito: dar por asistida una noche
   * entera es una afirmación fuerte, no puede pasar por tocar "Guardar".
   */
  function confirmAllPending() {
    setDraft((prev) => {
      const next = { ...prev }
      for (const r of candidates) {
        if (next[r.id] === undefined && r.actual_guests === null) {
          next[r.id] = r.estimated_guests
        }
      }
      return next
    })
  }

  function onOpenChange(next: boolean) {
    if (next) {
      setDraft({})
      load()
    }
    setOpen(next)
  }

  function save() {
    if (toSave.length === 0) {
      setOpen(false)
      return
    }
    startTransition(async () => {
      const res = await bulkUpdateActualGuests(tenantSlug, { entries: toSave })
      // Sin router.refresh(): bulkUpdateActualGuests revalida las páginas
      // que muestran asistencia y Next devuelve la página actual ya
      // re-renderizada en la respuesta de la action (el calendario con el día
      // abierto y su cupo). Un refresh encima era otra lectura entera.
      if (res.ok) {
        toast.success(res.message ?? 'Asistencia guardada.')
        setOpen(false)
      } else {
        toast.error(res.message ?? 'No pudimos guardar la asistencia.')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" data-tour="reservas-pasar-lista">
          <ClipboardCheck aria-hidden />
          Pasar lista
          {rows !== null && missing > 0 ? (
            <Badge tone="warning" className="tabular-nums" title="Reservas sin contar">
              {missing}
              <span className="sr-only">sin contar</span>
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Pasar lista</DialogTitle>
          <DialogDescription>
            {dayLabel}
            {rows === null
              ? ''
              : missing === 0
                ? ' · ya están todas contadas'
                : ` · faltan contar ${missing} de ${candidates.length}`}
            . Si vinieron distinto, corregí el número; si vinieron los que reservaron, confirmá con
            el tilde.
          </DialogDescription>
        </DialogHeader>

        <DialogBody aria-busy={loading || undefined}>
          {loading ? (
            <div role="status" className="grid gap-2 py-1">
              <span className="sr-only">Cargando el día…</span>
              {['a', 'b', 'c'].map((k) => (
                <Skeleton key={k} aria-hidden className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <EmptyState
              size="sm"
              icon={ClipboardCheck}
              title="No hay nada para contar"
              description="Este día no tiene reservas con asistencia para registrar: las canceladas y las que no vinieron no cuentan."
            />
          ) : (
            <ul className="grid gap-2">
              {candidates.map((r) => {
                const value = countFor(r)
                const untouched = draft[r.id] === undefined && r.actual_guests === null
                const differs = value !== r.estimated_guests
                const justConfirmed = draft[r.id] !== undefined
                return (
                  <li
                    key={r.id}
                    className={cn(
                      'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2',
                      untouched ? 'border-dashed border-border-strong' : 'border-border bg-card',
                    )}
                  >
                    <span className="w-11 shrink-0 type-body tabular-nums text-muted-foreground">
                      {hhmm(r.reservation_time_local)}
                    </span>
                    <span className="min-w-0 flex-1 basis-32">
                      <span className="block truncate type-body font-medium">{r.guest_name}</span>
                      <span className="block type-caption text-muted-foreground">
                        reservó {r.estimated_guests}
                        {differs
                          ? ` · ${value > r.estimated_guests ? '+' : '−'}${Math.abs(value - r.estimated_guests)}`
                          : ''}
                        {untouched ? ' · sin contar' : ''}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <NumberField
                        value={value}
                        onValueChange={(n) => {
                          if (n !== null) setDraft((prev) => ({ ...prev, [r.id]: n }))
                        }}
                        min={1}
                        max={99}
                        aria-label={`Personas que vinieron a la mesa de ${r.guest_name}`}
                        incrementLabel="Una persona más"
                        decrementLabel="Una persona menos"
                        disabled={pending}
                        className={cn('w-36', untouched && '[&_input]:text-muted-foreground')}
                      />
                      {/* Tocar ± ya confirma. Este tilde es para el caso más común:
                          vinieron los que reservaron y no hay nada que cambiar. Sin
                          él, "no toqué nada" y "vinieron los 20" se verían igual y
                          no habría forma de anotar el segundo. */}
                      <Button
                        type="button"
                        variant={untouched ? 'secondary' : 'ghost'}
                        size="icon"
                        aria-label={
                          justConfirmed
                            ? `${value} confirmados en ${r.guest_name}`
                            : `Confirmar ${value} en ${r.guest_name}`
                        }
                        aria-pressed={justConfirmed}
                        disabled={pending || justConfirmed}
                        onClick={() => setDraft((prev) => ({ ...prev, [r.id]: value }))}
                        className={cn(justConfirmed && 'text-success-text')}
                      >
                        <Check aria-hidden />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </DialogBody>

        <DialogFooter className="sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {missing > 0 ? (
              <Button type="button" variant="ghost" size="sm" onClick={confirmAllPending}>
                Vinieron todos como reservaron
              </Button>
            ) : null}
            <span aria-live="polite" className="type-small text-muted-foreground">
              {toSave.length === 0
                ? 'Tocá las que quieras registrar'
                : `Se guardan ${toSave.length} ${toSave.length === 1 ? 'reserva' : 'reservas'}`}
            </span>
          </div>
          <Button
            type="button"
            onClick={save}
            loading={pending}
            loadingText="Guardando…"
            disabled={toSave.length === 0}
          >
            Guardar todo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
