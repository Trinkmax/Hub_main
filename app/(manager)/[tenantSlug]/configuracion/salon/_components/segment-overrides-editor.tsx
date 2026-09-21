'use client'

import { CalendarClock, Loader2, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useId, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isRealIsoDay } from '@/lib/salon/date-presets'
import { removeSegmentOverride, upsertSegmentOverride } from '@/lib/salon/segment-actions'
import { type SegmentActionResult, segmentOverrideSchema } from '@/lib/salon/segment-schemas'
import {
  type IsoDow,
  isoDowOf,
  isSegmentKey,
  resolveDaySegmentCaps,
  SEGMENT_KEYS,
  type SegmentKey,
  type SegmentOverrideRow,
  type SegmentWeeklyCapRow,
} from '@/lib/salon/segments'
import { SEGMENT_LABELS, SEGMENT_WITH_ARTICLE } from '@/lib/salon/segments-copy'
import { cn } from '@/lib/utils'

/**
 * Configuración → Capacidad → «Cupos especiales por fecha».
 *
 * Un día puntual que no sigue la regla semanal: abrimos la terraza, feriado,
 * cerrado por evento privado. Gana sobre el cupo del día de la semana y NO
 * hereda su aviso (lib/salon/segments.ts → resolveDaySegmentCaps).
 *
 * Es la misma action que usan el «Cupo del día» y el «Subir a N hoy» de la
 * vista del día del calendario, así que lo que se carga acá aparece allá y al
 * revés. Solo se listan los de hoy en adelante: los pasados ya no cambian nada.
 *
 * Guardar y quitar ofrecen «Deshacer» (la action devuelve lo que había antes):
 * cargar el servicio o la fecha equivocados no obliga a reconstruir a mano el
 * cupo anterior.
 */

type Props = {
  tenantSlug: string
  /** Hoy en Córdoba ('YYYY-MM-DD'): piso de la fecha y corte de la lista. */
  today: string
  initialOverrides: SegmentOverrideRow[]
  /** Lo GUARDADO (no el borrador del editor de arriba): contra qué se compara el especial. */
  weekly: SegmentWeeklyCapRow[]
  fallbackTotal: number
}

type FieldErrors = { date?: string; capacity?: string; warn?: string; reason?: string }

const DOW_ABBR: Record<IsoDow, string> = {
  1: 'lun',
  2: 'mar',
  3: 'mié',
  4: 'jue',
  5: 'vie',
  6: 'sáb',
  7: 'dom',
}
/** «¿Volver al cupo de los lunes?» */
const DOW_PLURAL: Record<IsoDow, string> = {
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábados',
  7: 'domingos',
}

const UNREACHABLE =
  'No pudimos hablar con el servidor. Revisá la conexión y probá de nuevo: lo que cargaste sigue acá.'

/** '2026-10-12' → 'lun 12/10'. Sin Intl: el server y el navegador dicen lo mismo. */
function shortDay(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${DOW_ABBR[isoDowOf(iso)]} ${day}/${month}`
}

function rowKey(o: Pick<SegmentOverrideRow, 'override_date' | 'segment'>): string {
  return `${o.override_date}:${o.segment}`
}

/** Por fecha y, dentro del día, en el orden del servicio (almuerzo → cena). */
function sortOverrides(rows: SegmentOverrideRow[]): SegmentOverrideRow[] {
  return [...rows].sort((a, b) =>
    a.override_date === b.override_date
      ? SEGMENT_KEYS.indexOf(a.segment) - SEGMENT_KEYS.indexOf(b.segment)
      : a.override_date < b.override_date
        ? -1
        : 1,
  )
}

function upsertRow(rows: SegmentOverrideRow[], row: SegmentOverrideRow): SegmentOverrideRow[] {
  return sortOverrides([...rows.filter((r) => rowKey(r) !== rowKey(row)), row])
}

function capacityText(capacity: number): string {
  return capacity === 0 ? 'cerrado' : capacity === 1 ? '1 lugar' : `${capacity} lugares`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

async function callAction<T>(
  op: string,
  run: () => Promise<SegmentActionResult<T>>,
): Promise<SegmentActionResult<T>> {
  try {
    return await run()
  } catch (error) {
    console.error(
      `[configuracion.salon.${op}]`,
      error instanceof Error ? error.message : 'sin respuesta',
    )
    return { ok: false, message: UNREACHABLE }
  }
}

export function SegmentOverridesEditor({
  tenantSlug,
  today,
  initialOverrides,
  weekly,
  fallbackTotal,
}: Props) {
  const baseId = useId()
  const titleId = `${baseId}-title`
  const formRef = useRef<HTMLFormElement>(null)

  const [overrides, setOverrides] = useState(() => sortOverrides(initialOverrides))
  const [date, setDate] = useState('')
  const [segment, setSegment] = useState<SegmentKey>('lunch')
  const [capacity, setCapacity] = useState('')
  const [warn, setWarn] = useState('')
  const [reason, setReason] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<SegmentOverrideRow | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /**
   * Qué cupo tendría ese servicio ese día SIN el especial. Sale del mismo
   * `resolveDaySegmentCaps` que usa el calendario, con los especiales vacíos:
   * así «en vez de 70» nunca contradice lo que muestra el día.
   */
  function baseCap(isoDate: string, seg: SegmentKey): { capacity: number | null; text: string } {
    const cap = resolveDaySegmentCaps(isoDate, {
      weekly,
      overrides: [],
      settings: [],
      fallbackTotal,
    })[seg]
    const dow = isoDowOf(isoDate)
    switch (cap.source) {
      case 'weekly':
        return { capacity: cap.capacity, text: `cupo de los ${DOW_PLURAL[dow]}` }
      case 'fallback':
        return { capacity: cap.capacity, text: 'cupo general' }
      default:
        return { capacity: null, text: 'sin tope' }
    }
  }

  function baseLine(isoDate: string, seg: SegmentKey): string {
    const base = baseCap(isoDate, seg)
    if (base.capacity === null) return 'Sin el especial, ese servicio no tiene tope.'
    return base.capacity === 0
      ? `Sin el especial, está cerrado (${base.text}).`
      : `En vez de ${base.capacity} (${base.text}).`
  }

  /** «El almuerzo del lun 12/10 tiene 70 (cupo de los lunes).»: contra qué se compara el especial. */
  function baseHint(isoDate: string, seg: SegmentKey): string {
    const base = baseCap(isoDate, seg)
    const who = `${capitalize(SEGMENT_WITH_ARTICLE[seg])} del ${shortDay(isoDate)}`
    if (base.capacity === null) return `${who} no tiene tope.`
    if (base.capacity === 0) return `${who} está cerrado (${base.text}).`
    return `${who} tiene ${base.capacity} (${base.text}).`
  }

  // ── Validación del alta (el mismo schema que la action) ──
  const validation = useMemo(() => {
    const errors: FieldErrors = {}
    const trimmedDate = date.trim()
    if (trimmedDate === '') errors.date = 'Elegí la fecha'
    else if (!isRealIsoDay(trimmedDate)) errors.date = 'Esa fecha no existe'
    else if (trimmedDate < today) errors.date = 'Elegí hoy o una fecha que viene'
    if (capacity.trim() === '') errors.capacity = 'Poné el cupo (0 = cerrado)'

    const parsed = segmentOverrideSchema.safeParse({
      override_date: trimmedDate,
      segment,
      capacity: capacity.trim() === '' ? Number.NaN : Number(capacity),
      warn_at: warn.trim() === '' ? null : Number(warn),
      reason,
    })
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (field === 'capacity' && !errors.capacity) errors.capacity = issue.message
        if (field === 'warn_at' && !errors.warn) errors.warn = issue.message
        if (field === 'reason' && !errors.reason) errors.reason = issue.message
        if (field === 'override_date' && !errors.date) errors.date = issue.message
      }
    }
    const valid = Object.keys(errors).length === 0 && parsed.success
    return { errors, input: valid && parsed.success ? parsed.data : null }
  }, [date, segment, capacity, warn, reason, today])

  const shown: FieldErrors = attempted ? validation.errors : {}
  const dateOk = date !== '' && isRealIsoDay(date) && date >= today
  const existing = dateOk
    ? overrides.find((o) => rowKey(o) === rowKey({ override_date: date, segment }))
    : undefined

  function resetForm() {
    setDate('')
    setCapacity('')
    setWarn('')
    setReason('')
    setAttempted(false)
  }

  function focusFirstInvalid() {
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    })
  }

  // ── Deshacer ──

  /** Vuelve (fecha, servicio) a como estaba: lo borra si no había nada o restaura el anterior. */
  function restore(
    key: Pick<SegmentOverrideRow, 'override_date' | 'segment'>,
    previous: SegmentOverrideRow | null,
  ) {
    setBusyKey(rowKey(key))
    startTransition(async () => {
      const result = previous
        ? await callAction('undoOverride', () => upsertSegmentOverride(tenantSlug, previous))
        : await callAction('undoOverride', () =>
            removeSegmentOverride(tenantSlug, {
              override_date: key.override_date,
              segment: key.segment,
            }),
          )
      setBusyKey(null)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setOverrides((prev) =>
        previous ? upsertRow(prev, previous) : prev.filter((r) => rowKey(r) !== rowKey(key)),
      )
      toast.success('Listo, quedó como estaba.')
    })
  }

  // ── Alta ──

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAttempted(true)
    setFormError(null)
    const input = validation.input
    if (!input) {
      focusFirstInvalid()
      return
    }
    const row: SegmentOverrideRow = {
      segment: input.segment,
      override_date: input.override_date,
      capacity: input.capacity,
      warn_at: input.warn_at,
      reason: input.reason,
    }
    startTransition(async () => {
      const result = await callAction('saveOverride', () =>
        upsertSegmentOverride(tenantSlug, input),
      )
      if (!result.ok) {
        // Lo cargado se queda en el form para corregir o reintentar.
        setFormError(result.message)
        toast.error(result.message)
        return
      }
      const previous = result.data.previous
      setOverrides((prev) => upsertRow(prev, row))
      resetForm()
      toast.success(
        `${SEGMENT_LABELS[row.segment]} del ${shortDay(row.override_date)}: ${capacityText(row.capacity)}.`,
        {
          action: { label: 'Deshacer', onClick: () => restore(row, previous) },
        },
      )
    })
  }

  // ── Quitar ──

  function confirmRemove() {
    const row = toDelete
    setToDelete(null)
    if (!row) return
    setBusyKey(rowKey(row))
    startTransition(async () => {
      const result = await callAction('removeOverride', () =>
        removeSegmentOverride(tenantSlug, {
          override_date: row.override_date,
          segment: row.segment,
        }),
      )
      setBusyKey(null)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setOverrides((prev) => prev.filter((r) => rowKey(r) !== rowKey(row)))
      // Si otro dueño ya lo había quitado, `previous` viene null: se restaura
      // lo que veíamos en pantalla.
      const previous = result.data.previous ?? row
      toast.success(`Se quitó el cupo especial del ${shortDay(row.override_date)}.`, {
        action: { label: 'Deshacer', onClick: () => restore(row, previous) },
      })
    })
  }

  const deleteBase = toDelete ? baseCap(toDelete.override_date, toDelete.segment) : null

  return (
    <section
      aria-labelledby={titleId}
      className="card-hairline min-w-0 space-y-5 rounded-xl border border-border/70 bg-card/85 p-4 sm:p-5"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" aria-hidden />
          <h2 id={titleId} className="font-serif text-lg font-semibold">
            Cupos especiales por fecha
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Para un día puntual: abrimos la terraza, feriado, cerrado por evento privado. Gana sobre
          el cupo del día de la semana.
        </p>
      </div>

      {/* ── Alta ── */}
      <form
        ref={formRef}
        onSubmit={submit}
        noValidate
        className="space-y-3 rounded-lg border border-dashed border-border/70 p-3"
        aria-label="Agregar cupo especial"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0 space-y-1.5">
            <Label
              htmlFor={`${baseId}-date`}
              className="text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              Fecha
            </Label>
            <Input
              id={`${baseId}-date`}
              type="date"
              min={today}
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setFormError(null)
              }}
              aria-invalid={shown.date ? true : undefined}
              aria-describedby={shown.date ? `${baseId}-date-err` : undefined}
              className="h-10"
            />
            {shown.date ? (
              <p id={`${baseId}-date-err`} className="text-xs text-destructive">
                {shown.date}
              </p>
            ) : null}
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label
              htmlFor={`${baseId}-segment`}
              className="text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              Servicio
            </Label>
            <Select
              value={segment}
              onValueChange={(v) => {
                if (isSegmentKey(v)) setSegment(v)
                setFormError(null)
              }}
            >
              <SelectTrigger id={`${baseId}-segment`} className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEGMENT_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {SEGMENT_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label
              htmlFor={`${baseId}-capacity`}
              className="text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              Cupo
            </Label>
            <Input
              id={`${baseId}-capacity`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={3}
              value={capacity}
              onChange={(e) => {
                setCapacity(e.target.value.replace(/\D/g, '').slice(0, 3))
                setFormError(null)
              }}
              placeholder="120"
              aria-invalid={shown.capacity ? true : undefined}
              aria-describedby={shown.capacity ? `${baseId}-capacity-err` : undefined}
              className="h-10 tabular-nums"
            />
            {shown.capacity ? (
              <p id={`${baseId}-capacity-err`} className="text-xs text-destructive">
                {shown.capacity}
              </p>
            ) : null}
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label
              htmlFor={`${baseId}-warn`}
              className="text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              Aviso <span className="normal-case tracking-normal">(opcional)</span>
            </Label>
            <Input
              id={`${baseId}-warn`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={3}
              value={warn}
              onChange={(e) => {
                setWarn(e.target.value.replace(/\D/g, '').slice(0, 3))
                setFormError(null)
              }}
              placeholder="aviso"
              aria-invalid={shown.warn ? true : undefined}
              aria-describedby={shown.warn ? `${baseId}-warn-err` : undefined}
              className="h-10 tabular-nums"
            />
            {shown.warn ? (
              <p id={`${baseId}-warn-err`} className="text-xs text-destructive">
                {shown.warn}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor={`${baseId}-reason`}
            className="text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            Motivo <span className="normal-case tracking-normal">(opcional)</span>
          </Label>
          <Input
            id={`${baseId}-reason`}
            value={reason}
            maxLength={120}
            onChange={(e) => {
              setReason(e.target.value)
              setFormError(null)
            }}
            placeholder="Feriado, terraza abierta…"
            aria-invalid={shown.reason ? true : undefined}
            aria-describedby={shown.reason ? `${baseId}-reason-err` : undefined}
            className="h-10"
          />
          {shown.reason ? (
            <p id={`${baseId}-reason-err`} className="text-xs text-destructive">
              {shown.reason}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <p
            className={cn(
              'text-xs sm:mr-auto',
              formError ? 'text-destructive' : 'text-muted-foreground',
            )}
            aria-live="polite"
          >
            {formError ??
              (dateOk
                ? existing
                  ? `Ya hay un cupo especial para ${SEGMENT_WITH_ARTICLE[segment]} de ese día (${capacityText(existing.capacity)}): se reemplaza.`
                  : baseHint(date, segment)
                : null)}
          </p>
          <Button type="submit" disabled={pending} className="gap-2">
            {pending && busyKey === null ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            {existing ? 'Reemplazar' : 'Agregar'}
          </Button>
        </div>
      </form>

      {/* ── Próximos ── */}
      {overrides.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay cupos especiales de hoy en adelante.</p>
      ) : (
        <ul className="divide-y divide-border/60" aria-label="Cupos especiales de hoy en adelante">
          {overrides.map((o) => {
            const key = rowKey(o)
            const busy = pending && busyKey === key
            const parts = [
              shortDay(o.override_date),
              SEGMENT_LABELS[o.segment],
              o.capacity === 0 ? 'Cerrado' : String(o.capacity),
              ...(o.warn_at !== null ? [`aviso ${o.warn_at}`] : []),
              ...(o.reason ? [o.reason] : []),
            ]
            return (
              <li key={key} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm">
                    <span className="font-medium tabular-nums">{parts[0]}</span>
                    {parts.slice(1).map((part, i) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: partes fijas por posición (servicio, cupo, aviso, motivo)
                        key={i}
                        className={cn(i === 1 && 'font-semibold tabular-nums')}
                      >
                        {' · '}
                        {part}
                      </span>
                    ))}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {baseLine(o.override_date, o.segment)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={pending}
                  aria-label={`Quitar el cupo especial de ${SEGMENT_WITH_ARTICLE[o.segment]} del ${shortDay(o.override_date)}`}
                  onClick={() => setToDelete(o)}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-4" aria-hidden />
                  )}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toDelete
                ? `¿Volver al cupo de los ${DOW_PLURAL[isoDowOf(toDelete.override_date)]}?`
                : '¿Quitar el cupo especial?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && deleteBase
                ? `${capitalize(SEGMENT_WITH_ARTICLE[toDelete.segment])} del ${shortDay(toDelete.override_date)} ${
                    deleteBase.capacity === null
                      ? 'queda sin tope'
                      : deleteBase.capacity === 0
                        ? 'vuelve a estar cerrado'
                        : `vuelve a ${capacityText(deleteBase.capacity)}${
                            deleteBase.text === 'cupo general' ? ' (cupo general)' : ''
                          }`
                  }. Las reservas no se tocan.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmRemove}
            >
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
