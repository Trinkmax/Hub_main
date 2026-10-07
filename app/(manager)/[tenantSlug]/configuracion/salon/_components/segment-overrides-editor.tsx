'use client'

import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog, type ConfirmResult } from '@/components/ui/confirm-dialog'
import { DataTable } from '@/components/ui/data-table'
import { DatePicker } from '@/components/ui/date-picker'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import { Section } from '@/components/ui/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toastUndo } from '@/components/ui/toast'
import { capitalizeFirst, formatWeekdayDayMonth } from '@/lib/dates/format'
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

/** Lo que acepta la action (`segmentOverrideSchema`): hasta 999 personas. */
const MAX_CAPACITY = 999

const UNREACHABLE =
  'No pudimos hablar con el servidor. Revisá la conexión y probá de nuevo: lo que cargaste sigue acá.'

/** '2026-10-12' → 'lun 12/10'. A mano (lib/dates): el server y el navegador dicen lo mismo. */
const shortDay = formatWeekdayDayMonth

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
  const formRef = useRef<HTMLFormElement>(null)

  const [overrides, setOverrides] = useState(() => sortOverrides(initialOverrides))
  const [date, setDate] = useState('')
  const [segment, setSegment] = useState<SegmentKey>('lunch')
  const [capacity, setCapacity] = useState<number | null>(null)
  const [warn, setWarn] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<SegmentOverrideRow | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
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
    const who = `${capitalizeFirst(SEGMENT_WITH_ARTICLE[seg])} del ${shortDay(isoDate)}`
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
    if (capacity === null) errors.capacity = 'Poné el cupo (0 = cerrado)'

    const parsed = segmentOverrideSchema.safeParse({
      override_date: trimmedDate,
      segment,
      capacity: capacity ?? Number.NaN,
      warn_at: warn,
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
    // El reset del <form> vuelve los campos del kit (fecha, cupo, aviso) a vacío
    // y ellos avisan el cambio; el servicio queda como estaba.
    formRef.current?.reset()
    setDate('')
    setCapacity(null)
    setWarn(null)
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
    // Primero lo que los campos del kit ya saben que está mal (una fecha que no
    // existe, un número que no se entiende): muestran su mensaje y se enfoca el
    // primero. Después, las reglas del schema.
    if (!event.currentTarget.checkValidity()) return
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
      toastUndo(
        `${SEGMENT_LABELS[row.segment]} del ${shortDay(row.override_date)}: ${capacityText(row.capacity)}.`,
        { onUndo: () => restore(row, previous) },
      )
    })
  }

  // ── Quitar ──

  function askRemove(row: SegmentOverrideRow) {
    setToDelete(row)
    setDeleteOpen(true)
  }

  /** Espera con el diálogo abierto; si falla, el error queda adentro del diálogo. */
  async function confirmRemove(): Promise<ConfirmResult> {
    const row = toDelete
    if (!row) return
    const result = await callAction('removeOverride', () =>
      removeSegmentOverride(tenantSlug, {
        override_date: row.override_date,
        segment: row.segment,
      }),
    )
    if (!result.ok) return { ok: false, error: result.message }
    setOverrides((prev) => prev.filter((r) => rowKey(r) !== rowKey(row)))
    // Si otro dueño ya lo había quitado, `previous` viene null: se restaura
    // lo que veíamos en pantalla.
    const previous = result.data.previous ?? row
    toastUndo(`Se quitó el cupo especial del ${shortDay(row.override_date)}.`, {
      onUndo: () => restore(row, previous),
    })
  }

  const deleteBase = toDelete ? baseCap(toDelete.override_date, toDelete.segment) : null
  const formHint =
    formError ??
    (dateOk
      ? existing
        ? `Ya hay un cupo especial para ${SEGMENT_WITH_ARTICLE[segment]} de ese día (${capacityText(existing.capacity)}): se reemplaza.`
        : baseHint(date, segment)
      : null)

  return (
    <Section
      divider
      title="Cupos especiales por fecha"
      description="Para un día puntual: abrimos la terraza, feriado, cerrado por evento privado. Gana sobre el cupo del día de la semana."
    >
      {/* ── Alta ── */}
      <Card asChild>
        <form ref={formRef} onSubmit={submit} noValidate aria-label="Agregar cupo especial">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Fecha" error={shown.date}>
              <DatePicker
                value={date === '' ? null : date}
                onValueChange={(iso) => {
                  setDate(iso ?? '')
                  setFormError(null)
                }}
                min={today}
                today={today}
              />
            </Field>

            <Field label="Servicio">
              <Select
                value={segment}
                onValueChange={(v) => {
                  if (isSegmentKey(v)) setSegment(v)
                  setFormError(null)
                }}
              >
                <SelectTrigger>
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
            </Field>

            {/* Sin `value`: con un número fuera de rango, el NumberField controlado
                borraba lo tipeado. El reset del form los vacía después de guardar. */}
            <Field label="Cupo" hint="0 = cerrado ese día." error={shown.capacity}>
              <NumberField
                onValueChange={(n) => {
                  setCapacity(n)
                  setFormError(null)
                }}
                min={0}
                max={MAX_CAPACITY}
                steppers={false}
                placeholder="120"
              />
            </Field>

            <Field
              label="Aviso"
              hint="Desde este número el servicio se marca con aviso."
              error={shown.warn}
              optional
            >
              <NumberField
                onValueChange={(n) => {
                  setWarn(n)
                  setFormError(null)
                }}
                min={0}
                max={MAX_CAPACITY}
                steppers={false}
              />
            </Field>
          </div>

          <Field label="Motivo" error={shown.reason} optional>
            <Input
              value={reason}
              maxLength={120}
              onChange={(e) => {
                setReason(e.target.value)
                setFormError(null)
              }}
              placeholder="Feriado, terraza abierta…"
            />
          </Field>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <p
              className={cn(
                'text-pretty type-small sm:me-auto',
                formError ? 'text-destructive-text' : 'text-muted-foreground',
              )}
              aria-live="polite"
            >
              {formHint}
            </p>
            <Button
              type="submit"
              loading={pending && busyKey === null}
              loadingText="Guardando…"
              disabled={pending && busyKey !== null}
              className="max-sm:w-full"
            >
              <Plus aria-hidden />
              {existing ? 'Reemplazar' : 'Agregar'}
            </Button>
          </div>
        </form>
      </Card>

      {/* ── Próximos ── */}
      <DataTable
        caption="Cupos especiales de hoy en adelante"
        rows={overrides}
        getRowId={rowKey}
        empty={
          <EmptyState
            size="sm"
            icon={CalendarClock}
            title="No hay cupos especiales de hoy en adelante"
            description="Cargá uno arriba para un feriado, un evento privado o un día con la terraza abierta."
          />
        }
        // En el celular (tarjetas) el aviso va pegado al cupo y el motivo
        // adelante de «en vez de…»: así no quedan rayas sueltas en la tarjeta.
        columns={[
          {
            id: 'fecha',
            header: 'Fecha',
            cell: (o) => shortDay(o.override_date),
            className: 'whitespace-nowrap',
          },
          { id: 'servicio', header: 'Servicio', cell: (o) => SEGMENT_LABELS[o.segment] },
          {
            id: 'cupo',
            header: 'Cupo',
            numeric: true,
            mobile: 'secondary',
            cell: (o) => (
              <>
                {o.capacity === 0 ? 'Cerrado' : o.capacity}
                {o.warn_at !== null ? (
                  <span className="md:hidden"> · aviso {o.warn_at}</span>
                ) : null}
              </>
            ),
          },
          {
            id: 'aviso',
            header: 'Aviso',
            numeric: true,
            mobile: 'hidden',
            cell: (o) =>
              o.warn_at === null ? (
                <span className="text-subtle-foreground">
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">sin aviso</span>
                </span>
              ) : (
                o.warn_at
              ),
          },
          {
            id: 'motivo',
            header: 'Motivo',
            mobile: 'hidden',
            cell: (o) =>
              o.reason || (
                <span className="text-subtle-foreground">
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">sin motivo</span>
                </span>
              ),
          },
          {
            id: 'base',
            header: 'Sin el especial',
            mobile: 'meta',
            cell: (o) => (
              <span className="text-muted-foreground">
                {o.reason ? <span className="md:hidden">{o.reason} · </span> : null}
                {baseLine(o.override_date, o.segment)}
              </span>
            ),
          },
          {
            id: 'acciones',
            header: 'Acciones',
            headerHidden: true,
            align: 'end',
            cell: (o) => (
              <Button
                type="button"
                variant="danger-ghost"
                size="icon-sm"
                loading={pending && busyKey === rowKey(o)}
                disabled={pending && busyKey !== rowKey(o)}
                aria-label={`Quitar el cupo especial de ${SEGMENT_WITH_ARTICLE[o.segment]} del ${shortDay(o.override_date)}`}
                onClick={() => askRemove(o)}
              >
                <Trash2 aria-hidden />
              </Button>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={
          toDelete
            ? `¿Volver al cupo de los ${DOW_PLURAL[isoDowOf(toDelete.override_date)]}?`
            : '¿Quitar el cupo especial?'
        }
        description={
          toDelete && deleteBase
            ? `${capitalizeFirst(SEGMENT_WITH_ARTICLE[toDelete.segment])} del ${shortDay(toDelete.override_date)} ${
                deleteBase.capacity === null
                  ? 'queda sin tope'
                  : deleteBase.capacity === 0
                    ? 'vuelve a estar cerrado'
                    : `vuelve a ${capacityText(deleteBase.capacity)}${
                        deleteBase.text === 'cupo general' ? ' (cupo general)' : ''
                      }`
              }. Las reservas no se tocan.`
            : undefined
        }
        confirmLabel="Quitar cupo especial"
        pendingLabel="Quitando…"
        tone="danger"
        onConfirm={confirmRemove}
      />
    </Section>
  )
}
