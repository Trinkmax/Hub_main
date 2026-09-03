'use client'

import { Check, ClipboardCheck, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { GuestCountStepper } from '@/components/reservations/guest-count-stepper'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [rows, setRows] = useState<ReservationWithJoins[] | null>(null)
  const [loading, setLoading] = useState(false)

  // El día COMPLETO, pedido al abrir. No se puede usar la lista de la página:
  // está paginada de a 25 y filtrada por los filtros activos, así que un viernes
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
  // stepper o el check de la fila. Una fila que no tocó no se manda.
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
      if (res.ok) {
        toast.success(res.message ?? 'Asistencia guardada.')
        setOpen(false)
        router.refresh()
      } else {
        toast.error(res.message ?? 'No pudimos guardar la asistencia.')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2" data-tour="reservas-pasar-lista">
          <ClipboardCheck className="size-4" />
          Pasar lista
          {rows !== null && missing > 0 ? (
            <span className="rounded-full bg-warning/20 px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums text-foreground">
              {missing}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Pasar lista</DialogTitle>
          <DialogDescription>
            {dayLabel}
            {rows === null
              ? ''
              : missing === 0
                ? ' · ya están todas contadas'
                : ` · faltan contar ${missing} de ${candidates.length}`}
            . Tocá el número si vinieron distinto, o el ✓ si vinieron los que reservaron.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Cargando el día…</p>
        ) : candidates.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay reservas con asistencia para registrar este día.
          </p>
        ) : (
          <ScrollArea className="max-h-[55vh] -mx-1 px-1">
            <ul className="space-y-1.5">
              {candidates.map((r) => {
                const value = countFor(r)
                const untouched = draft[r.id] === undefined && r.actual_guests === null
                const differs = value !== r.estimated_guests
                const justConfirmed = draft[r.id] !== undefined
                return (
                  <li
                    key={r.id}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-3 py-2',
                      untouched ? 'border-dashed border-border' : 'border-border/70 bg-card/50',
                    )}
                  >
                    <span className="w-11 shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                      {hhmm(r.reservation_time_local)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.guest_name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        reservó {r.estimated_guests}
                        {differs
                          ? ` · ${value > r.estimated_guests ? '+' : '−'}${Math.abs(value - r.estimated_guests)}`
                          : ''}
                        {untouched ? ' · sin contar' : ''}
                      </span>
                    </span>
                    <GuestCountStepper
                      value={value}
                      onChange={(n) => setDraft((prev) => ({ ...prev, [r.id]: n }))}
                      size="md"
                      disabled={pending}
                    />
                    {/* Tocar ± ya confirma. Este check es para el caso más común:
                      vinieron los que reservaron y no hay nada que cambiar. Sin
                      él, "no toqué nada" y "vinieron los 20" se verían igual y
                      no habría forma de anotar el segundo. */}
                    <Button
                      type="button"
                      variant={untouched ? 'outline' : 'ghost'}
                      size="icon"
                      aria-label={`Confirmar ${value} en ${r.guest_name}`}
                      disabled={pending || justConfirmed}
                      onClick={() => setDraft((prev) => ({ ...prev, [r.id]: value }))}
                      className={cn('size-9 shrink-0', justConfirmed && 'text-success')}
                    >
                      <Check className="size-4" aria-hidden />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {missing > 0 ? (
              <Button type="button" variant="ghost" size="sm" onClick={confirmAllPending}>
                Vinieron todos como reservaron
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {toSave.length === 0
                ? 'Tocá las que quieras registrar'
                : `Se guardan ${toSave.length} ${toSave.length === 1 ? 'reserva' : 'reservas'}`}
            </span>
          </div>
          <Button onClick={save} disabled={pending || toSave.length === 0} className="gap-2">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Guardar todo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
