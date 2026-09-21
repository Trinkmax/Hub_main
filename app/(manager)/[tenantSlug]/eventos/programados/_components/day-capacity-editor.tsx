'use client'

import { Loader2, SlidersHorizontal } from 'lucide-react'
import { useId, useState } from 'react'
import { keepOpenOnToast } from '@/components/reservations/reservation-quick-view'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { segmentOverrideSchema } from '@/lib/salon/segment-schemas'
import { type IsoDow, SEGMENT_KEYS, type SegmentKey, type SegmentLoad } from '@/lib/salon/segments'
import { capSourceLabel, SEGMENT_LABELS } from '@/lib/salon/segments-copy'

/** Lo que manda "Guardar" de una fila: un cupo especial ya validado con el zod de la action. */
export type DayOverrideInput = {
  segment: SegmentKey
  capacity: number
  warn_at: number | null
  reason: string | null
}

/**
 * «Cupo de los jueves»: a lo que vuelve un servicio cuando se quita su cupo
 * especial. Sale de `capSourceLabel` (una sola fuente para el nombre del día
 * en plural) aunque hoy el servicio esté en un especial.
 */
export function weekdayCapLabel(s: SegmentLoad, isoDow: IsoDow): string {
  return capSourceLabel({ ...s, capSource: 'weekly' }, isoDow)
}

/** 'Cupo de los jueves' → 'cupo de los jueves', para meterlo en una frase. */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function toDraft(capacity: number | null): string {
  return capacity === null ? '' : String(capacity)
}

type Drafts = Record<SegmentKey, string>
type Seen = Record<SegmentKey, number | null>

function capsOf(segments: Record<SegmentKey, SegmentLoad>): Seen {
  return {
    lunch: segments.lunch.capacity,
    tea_time: segments.tea_time.capacity,
    dinner: segments.dinner.capacity,
  }
}

/**
 * «Cupo del día»: el cupo especial de ESTE día por servicio, sin ir a
 * Configuración. Es para lo que pasa de golpe: "hoy abrimos la terraza", un
 * feriado (el 12/10 ya tiene un cumple de 25 al mediodía), un cierre por evento
 * privado. Misma action que el editor de Configuración → Capacidad.
 *
 * Solo lo ve el dueño (la RLS de la tabla también es owner-only). Cada servicio
 * se guarda por separado y cada guardado trae su "Deshacer" (lo resuelve la
 * vista del día con el `previous` que devuelve la action), así que no hace
 * falta un AlertDialog para "Volver al cupo de los jueves": es reversible.
 */
export function DayCapacityEditor({
  date,
  dayLabel,
  isoDow,
  segments,
  busy,
  onSave,
  onRemove,
}: {
  /** yyyy-MM-dd del día abierto. */
  date: string
  /** 'jue 10/09'. */
  dayLabel: string
  isoDow: IsoDow
  /** null mientras el día carga: el botón queda deshabilitado en su lugar (sin saltos). */
  segments: Record<SegmentKey, SegmentLoad> | null
  /** Servicio con un guardado en curso. */
  busy: SegmentKey | null
  onSave: (input: DayOverrideInput) => Promise<boolean>
  onRemove: (segment: SegmentKey) => Promise<boolean>
}) {
  const baseId = useId()
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<Drafts>({ lunch: '', tea_time: '', dinner: '' })
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Partial<Record<SegmentKey | 'reason', string>>>({})

  // Cuando el cupo real de un servicio cambia (se guardó, se quitó el especial
  // o se cambió de día) el input vuelve a mostrar el valor vigente. Lo que el
  // dueño está tipeando en otro servicio no se pisa.
  const [seen, setSeen] = useState<Seen | null>(null)
  if (segments) {
    const changed = SEGMENT_KEYS.filter((k) => seen === null || seen[k] !== segments[k].capacity)
    if (changed.length > 0) {
      setSeen(capsOf(segments))
      setDrafts((prev) => {
        const next = { ...prev }
        for (const k of changed) next[k] = toDraft(segments[k].capacity)
        return next
      })
    }
  }

  function onOpenChange(next: boolean) {
    if (next && segments) {
      setDrafts({
        lunch: toDraft(segments.lunch.capacity),
        tea_time: toDraft(segments.tea_time.capacity),
        dinner: toDraft(segments.dinner.capacity),
      })
      // El motivo es uno solo para los 3 servicios: arranca con el del primer
      // especial vigente, así editar "Feriado" no obliga a volver a escribirlo.
      const current = SEGMENT_KEYS.map((k) => segments[k]).find(
        (s) => s.capSource === 'override' && s.capReason,
      )
      setReason(current?.capReason ?? '')
      setErrors({})
    }
    setOpen(next)
  }

  async function save(key: SegmentKey) {
    if (!segments) return
    const s = segments[key]
    const raw = drafts[key].trim()
    // Number('') es 0: un input vacío tiene que fallar, no cerrar el servicio.
    const capacity = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
    // Un especial que ya tenía aviso lo conserva si sigue entrando en el cupo
    // nuevo. Uno recién creado arranca sin aviso: NO hereda el semanal (R7),
    // con la terraza abierta "avisame en 50" deja de tener sentido.
    const warnAt =
      s.capSource === 'override' && s.warnAt !== null && s.warnAt <= capacity ? s.warnAt : null
    const parsed = segmentOverrideSchema.safeParse({
      override_date: date,
      segment: key,
      capacity,
      warn_at: warnAt,
      reason,
    })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path[0] === 'reason' ? 'reason' : key
      setErrors({ [field]: issue?.message ?? 'Revisá el cupo.' })
      return
    }
    setErrors({})
    await onSave({
      segment: key,
      capacity: parsed.data.capacity,
      warn_at: parsed.data.warn_at,
      reason: parsed.data.reason,
    })
  }

  const reasonId = `${baseId}-motivo`
  const reasonErrorId = `${baseId}-motivo-error`
  const normalizedReason = reason.trim()

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2" disabled={!segments}>
          <SlidersHorizontal className="size-4" aria-hidden />
          Cupo del día
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-4"
        // «Deshacer» del toast de este mismo guardado: el editor queda abierto
        // y el número vuelve al anterior a la vista, en vez de cerrarse.
        onInteractOutside={keepOpenOnToast}
      >
        <div className="space-y-1">
          <p className="font-serif text-sm font-semibold">Cupo del {dayLabel}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Solo para este día: abrimos la terraza, feriado, cerrado por evento privado. Gana sobre
            el cupo de la semana. 0 = cerrado.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={reasonId} className="text-xs">
            Motivo (opcional)
          </Label>
          <Input
            id={reasonId}
            value={reason}
            maxLength={120}
            placeholder="Terraza abierta"
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={errors.reason ? reasonErrorId : undefined}
            className="h-9"
          />
          {errors.reason ? (
            <p id={reasonErrorId} role="alert" className="text-[11px] text-destructive">
              {errors.reason}
            </p>
          ) : null}
        </div>

        {segments ? (
          <ul className="space-y-3 border-t border-border/60 pt-3">
            {SEGMENT_KEYS.map((key) => {
              const s = segments[key]
              const inputId = `${baseId}-${key}`
              const sourceId = `${inputId}-origen`
              const errorId = `${inputId}-error`
              const error = errors[key]
              const pending = busy !== null
              const dirty =
                drafts[key].trim() !== toDraft(s.capacity) ||
                (s.capSource === 'override' && normalizedReason !== (s.capReason ?? ''))
              return (
                <li key={key}>
                  {/* Un form por servicio: Enter en el número guarda ESE servicio. */}
                  <form
                    className="space-y-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void save(key)
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Label htmlFor={inputId} className="w-20 shrink-0">
                        {SEGMENT_LABELS[key]}
                      </Label>
                      <Input
                        id={inputId}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={999}
                        step={1}
                        value={drafts[key]}
                        placeholder={s.capacity === null ? 'Sin tope' : String(s.capacity)}
                        onChange={(e) => {
                          const value = e.target.value
                          setDrafts((prev) => ({ ...prev, [key]: value }))
                        }}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${sourceId} ${errorId}` : sourceId}
                        disabled={pending}
                        className="h-9 w-20 font-mono tabular-nums"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={pending || !dirty}
                        aria-label={`Guardar ${SEGMENT_LABELS[key]}`}
                        className="gap-1.5"
                      >
                        {busy === key ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : null}
                        Guardar
                      </Button>
                    </div>
                    <p id={sourceId} className="pl-22 text-[11px] text-muted-foreground">
                      {capSourceLabel(s, isoDow)}
                    </p>
                    {error ? (
                      <p id={errorId} role="alert" className="pl-22 text-[11px] text-destructive">
                        {error}
                      </p>
                    ) : null}
                    {s.capSource === 'override' ? (
                      <div className="pl-22">
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          disabled={pending}
                          onClick={() => void onRemove(key)}
                          className="h-auto px-0 py-0.5 text-xs"
                        >
                          Volver al {lowerFirst(weekdayCapLabel(s, isoDow))}
                        </Button>
                      </div>
                    ) : null}
                  </form>
                </li>
              )
            })}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
