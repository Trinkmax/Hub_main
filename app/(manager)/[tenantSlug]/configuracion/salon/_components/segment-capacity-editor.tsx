'use client'

import { CalendarRange, Copy, Loader2, Repeat, Save } from 'lucide-react'
import { useId, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { saveSegmentConfig } from '@/lib/salon/segment-actions'
import {
  type SegmentActionResult,
  segmentSettingInputSchema,
  segmentWeeklyCellSchema,
} from '@/lib/salon/segment-schemas'
import {
  type IsoDow,
  isSegmentKey,
  resolveSegmentSettings,
  SEGMENT_KEYS,
  type SegmentKey,
  type SegmentSettingRow,
  type SegmentWeeklyCapRow,
} from '@/lib/salon/segments'
import { SEGMENT_LABELS, SEGMENT_WITH_ARTICLE } from '@/lib/salon/segments-copy'
import { cn } from '@/lib/utils'

/**
 * Configuración → Capacidad → «Cupos por servicio».
 *
 * La grilla es servicio × día de la semana (3 × 7): cuántas PERSONAS entran en
 * el almuerzo, la merienda y la cena de cada día, más un aviso opcional. Es lo
 * que leen el calendario, el alta de reservas y el salón (lib/salon/segments.ts)
 * para decir «Cena 119/120» en vez del viejo «171 de 130» del día entero.
 *
 * Cómo se lee una celda:
 * - vacía → ese día usa el cupo general (PA + PB) y se BORRA su fila al guardar;
 * - 0 → el servicio está cerrado ese día;
 * - aviso → a partir de ese número el día se pinta ámbar (con la nota del
 *   servicio, ej. «Conviene abrir la terraza»).
 *
 * Todo el borrador vive acá y se guarda con UN botón: la grilla se edita de a
 * muchas celdas (los atajos copian 4 o 6 de una) y guardar celda por celda
 * dejaría el calendario a medio cambiar mientras el dueño sigue tipeando.
 *
 * En escritorio es una tabla; a 360 px la tabla no entra sin scroll
 * horizontal, así que en el celu cada servicio es una pestaña con 7 filas. Las
 * dos vistas leen y escriben el MISMO estado (una sola se ve por CSS).
 */

const ISO_DOWS = [1, 2, 3, 4, 5, 6, 7] as const satisfies ReadonlyArray<IsoDow>
/** Martes a viernes: a donde copia «Copiar lunes a lun–vie». */
const WEEKDAYS_AFTER_MONDAY = [2, 3, 4, 5] as const satisfies ReadonlyArray<IsoDow>

const DOW_SHORT: Record<IsoDow, string> = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
  7: 'Dom',
}
const DOW_LONG: Record<IsoDow, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
}

const SAVE_UNREACHABLE =
  'No se pudieron guardar los cupos. Revisá la conexión y probá de nuevo: lo que cargaste sigue acá.'

type CellDraft = { capacity: string; warn: string }
type SettingDraft = { time: string; note: string }
type Draft = {
  cells: Record<SegmentKey, Record<IsoDow, CellDraft>>
  settings: Record<SegmentKey, SettingDraft>
}

type CellErrors = { capacity?: string; warn?: string }
type SettingErrors = { time?: string; note?: string }
type SavePayload = {
  weekly: Array<{
    segment: SegmentKey
    iso_dow: IsoDow
    capacity: number | null
    warn_at: number | null
  }>
  settings: Array<{ segment: SegmentKey; default_time: string; warn_note: string | null }>
}
type Validation = {
  cells: Record<SegmentKey, Partial<Record<IsoDow, CellErrors>>>
  settings: Record<SegmentKey, SettingErrors>
  /** null si hay algún error: no se manda nada a medio validar. */
  payload: SavePayload | null
  /** Primer servicio con error, para abrir su pestaña en el celu. */
  firstInvalid: SegmentKey | null
}

/** Solo dígitos y hasta 3 (el tope es 999): pegar «70 personas» deja «70». */
function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 3)
}

function toNumber(raw: string): number | null {
  const trimmed = raw.trim()
  return trimmed === '' ? null : Number(trimmed)
}

function buildDraft(
  weekly: ReadonlyArray<SegmentWeeklyCapRow>,
  settings: ReadonlyArray<SegmentSettingRow>,
): Draft {
  // Las horas/notas sin fila salen con los defaults del dominio (13:00 / 15:30
  // / 21:00): el editor muestra lo mismo que después usa el alta de reserva.
  const resolved = resolveSegmentSettings(settings)
  const cells = {} as Draft['cells']
  const settingDrafts = {} as Draft['settings']
  for (const segment of SEGMENT_KEYS) {
    const row = {} as Record<IsoDow, CellDraft>
    for (const dow of ISO_DOWS) {
      const saved = weekly.find((w) => w.segment === segment && w.iso_dow === dow)
      row[dow] = {
        capacity: saved ? String(saved.capacity) : '',
        warn: saved && saved.warn_at !== null ? String(saved.warn_at) : '',
      }
    }
    cells[segment] = row
    settingDrafts[segment] = {
      time: resolved[segment].defaultTime,
      note: resolved[segment].warnNote ?? '',
    }
  }
  return { cells, settings: settingDrafts }
}

/**
 * Forma canónica para comparar con lo guardado: «070» y «70» son lo mismo, y
 * una nota con espacios al final también. Evita ofrecer «Guardar» sin cambios.
 */
function normalizeDraft(draft: Draft): Draft {
  const cells = {} as Draft['cells']
  const settings = {} as Draft['settings']
  for (const segment of SEGMENT_KEYS) {
    const row = {} as Record<IsoDow, CellDraft>
    for (const dow of ISO_DOWS) {
      const cell = draft.cells[segment][dow]
      const capacity = toNumber(cell.capacity)
      const warn = toNumber(cell.warn)
      row[dow] = {
        capacity: capacity === null ? '' : String(capacity),
        warn: warn === null ? '' : String(warn),
      }
    }
    cells[segment] = row
    settings[segment] = {
      time: draft.settings[segment].time.trim(),
      note: draft.settings[segment].note.trim(),
    }
  }
  return { cells, settings }
}

/**
 * Valida el borrador entero con los MISMOS schemas que usa la server action:
 * lo que acá pasa, allá pasa. Los mensajes («El aviso tiene que ser menor o
 * igual al cupo», «Poné el cupo antes del aviso») salen del schema.
 */
function validateDraft(draft: Draft): Validation {
  const cells = {} as Validation['cells']
  const settings = {} as Validation['settings']
  const weekly: SavePayload['weekly'] = []
  const settingsOut: SavePayload['settings'] = []
  let firstInvalid: SegmentKey | null = null

  for (const segment of SEGMENT_KEYS) {
    const rowErrors: Partial<Record<IsoDow, CellErrors>> = {}
    for (const dow of ISO_DOWS) {
      const cell = draft.cells[segment][dow]
      const parsed = segmentWeeklyCellSchema.safeParse({
        segment,
        iso_dow: dow,
        capacity: toNumber(cell.capacity),
        warn_at: toNumber(cell.warn),
      })
      if (parsed.success) {
        weekly.push(parsed.data)
        continue
      }
      const errors: CellErrors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]
        if (field === 'capacity' && !errors.capacity) errors.capacity = issue.message
        if (field === 'warn_at' && !errors.warn) errors.warn = issue.message
      }
      rowErrors[dow] = errors
      firstInvalid ??= segment
    }
    cells[segment] = rowErrors

    const setting = draft.settings[segment]
    const parsedSetting = segmentSettingInputSchema.safeParse({
      segment,
      default_time: setting.time.trim(),
      warn_note: setting.note,
    })
    if (parsedSetting.success) {
      settingsOut.push(parsedSetting.data)
      settings[segment] = {}
    } else {
      const errors: SettingErrors = {}
      for (const issue of parsedSetting.error.issues) {
        const field = issue.path[0]
        if (field === 'default_time' && !errors.time) errors.time = 'Poné una hora (HH:MM)'
        if (field === 'warn_note' && !errors.note) errors.note = issue.message
      }
      settings[segment] = errors
      firstInvalid ??= segment
    }
  }

  return {
    cells,
    settings,
    payload: firstInvalid === null ? { weekly, settings: settingsOut } : null,
    firstInvalid,
  }
}

function segmentHasErrors(validation: Validation, segment: SegmentKey): boolean {
  const s = validation.settings[segment]
  return Object.keys(validation.cells[segment]).length > 0 || Boolean(s.time || s.note)
}

export function SegmentCapacityEditor({
  tenantSlug,
  weekly,
  settings,
  fallbackTotal,
}: {
  tenantSlug: string
  weekly: SegmentWeeklyCapRow[]
  settings: SegmentSettingRow[]
  /** PA + PB: lo que usa un día sin fila. 0 = sin tope. */
  fallbackTotal: number
}) {
  const baseId = useId()
  const titleId = `${baseId}-title`
  const containerRef = useRef<HTMLElement>(null)

  const [saved, setSaved] = useState<Draft>(() => normalizeDraft(buildDraft(weekly, settings)))
  const [draft, setDraft] = useState<Draft>(() => buildDraft(weekly, settings))
  const [tab, setTab] = useState<SegmentKey>('lunch')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const validation = useMemo(() => validateDraft(draft), [draft])
  const dirty = useMemo(
    () => JSON.stringify(normalizeDraft(draft)) !== JSON.stringify(saved),
    [draft, saved],
  )

  const cupoPlaceholder = fallbackTotal > 0 ? String(fallbackTotal) : '—'
  const emptyMeaning =
    fallbackTotal > 0
      ? `Vacío = usa el cupo general (${fallbackTotal}).`
      : 'Vacío = sin tope (el cupo general por planta está en 0).'

  function setCell(segment: SegmentKey, dow: IsoDow, field: keyof CellDraft, raw: string) {
    const value = onlyDigits(raw)
    setSaveError(null)
    setDraft((prev) => ({
      ...prev,
      cells: {
        ...prev.cells,
        [segment]: {
          ...prev.cells[segment],
          [dow]: { ...prev.cells[segment][dow], [field]: value },
        },
      },
    }))
  }

  function setSetting(segment: SegmentKey, field: keyof SettingDraft, value: string) {
    setSaveError(null)
    setDraft((prev) => ({
      ...prev,
      settings: { ...prev.settings, [segment]: { ...prev.settings[segment], [field]: value } },
    }))
  }

  /** Copia el lunes (cupo y aviso) a los días pedidos del mismo servicio. */
  function copyMonday(segment: SegmentKey, targets: ReadonlyArray<IsoDow>, message: string) {
    setSaveError(null)
    setDraft((prev) => {
      const monday = prev.cells[segment][1]
      const row = { ...prev.cells[segment] }
      for (const dow of targets) row[dow] = { ...monday }
      return { ...prev, cells: { ...prev.cells, [segment]: row } }
    })
    // El toast de sonner es una región viva: el lector de pantalla también se entera.
    toast(message)
  }

  /**
   * Lleva el foco al primer campo con error VISIBLE: en el celu las otras
   * pestañas no están montadas, así que primero se abre la del servicio.
   */
  function focusFirstInvalid(segment: SegmentKey | null) {
    if (segment) setTab(segment)
    requestAnimationFrame(() => {
      const candidates =
        containerRef.current?.querySelectorAll<HTMLElement>('[aria-invalid="true"]')
      const target = Array.from(candidates ?? []).find((el) => el.offsetParent !== null)
      target?.focus()
    })
  }

  function save() {
    const payload = validation.payload
    if (!payload) {
      toast.error('Revisá los cupos marcados en rojo.')
      focusFirstInvalid(validation.firstInvalid)
      return
    }
    const sent = draft
    setSaveError(null)
    startTransition(async () => {
      let result: SegmentActionResult<null>
      try {
        result = await saveSegmentConfig(tenantSlug, payload)
      } catch (error) {
        console.error(
          '[configuracion.salon.saveSegmentConfig]',
          error instanceof Error ? error.message : 'sin respuesta',
        )
        result = { ok: false, message: SAVE_UNREACHABLE }
      }
      if (!result.ok) {
        // Lo tipeado se queda: el dueño corrige o reintenta sin volver a cargar.
        setSaveError(result.message)
        toast.error(result.message)
        return
      }
      const normalized = normalizeDraft(sent)
      setSaved(normalized)
      // Si siguió tipeando mientras guardaba, no le pisamos lo nuevo.
      setDraft((prev) => (prev === sent ? normalized : prev))
      toast.success('Cupos guardados.')
    })
  }

  // ── Piezas compartidas por las dos vistas ──

  function cellInputs(segment: SegmentKey, dow: IsoDow, view: 'd' | 'm') {
    const cell = draft.cells[segment][dow]
    const errors = validation.cells[segment][dow]
    const label = SEGMENT_LABELS[segment]
    const day = DOW_LONG[dow].toLowerCase()
    const capErrId = `${baseId}-${view}-${segment}-${dow}-cap`
    const warnErrId = `${baseId}-${view}-${segment}-${dow}-warn`
    const closed = cell.capacity.trim() !== '' && toNumber(cell.capacity) === 0
    const compact = view === 'd'
    return {
      capacity: (
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={3}
          value={cell.capacity}
          onChange={(e) => setCell(segment, dow, 'capacity', e.target.value)}
          placeholder={cupoPlaceholder}
          aria-label={`Cupo de ${label}, ${day}`}
          aria-invalid={errors?.capacity ? true : undefined}
          aria-describedby={errors?.capacity ? capErrId : undefined}
          className={cn(
            'px-1 text-center font-semibold tabular-nums placeholder:font-normal',
            compact ? 'h-9 text-base md:text-base' : 'h-10 text-base',
            cell.capacity === '' && 'border-dashed',
            closed && 'bg-muted/60 text-muted-foreground',
          )}
        />
      ),
      warn: (
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={3}
          value={cell.warn}
          onChange={(e) => setCell(segment, dow, 'warn', e.target.value)}
          placeholder={closed ? 'cerrado' : 'aviso'}
          aria-label={`Aviso de ${label}, ${day}`}
          aria-invalid={errors?.warn ? true : undefined}
          aria-describedby={errors?.warn ? warnErrId : undefined}
          className={cn(
            'px-1 text-center tabular-nums',
            compact ? 'h-7 text-xs md:text-xs' : 'h-10 text-base',
          )}
        />
      ),
      capErrId,
      warnErrId,
      errors,
    }
  }

  function segmentExtras(segment: SegmentKey, view: 'd' | 'm') {
    const setting = draft.settings[segment]
    const errors = validation.settings[segment]
    const label = SEGMENT_LABELS[segment]
    const prefix = `${baseId}-${view}-${segment}`
    const mondayEmpty = draft.cells[segment][1].capacity.trim() === ''
    // Container query: la misma pieza va en una columna angosta (tabla de
    // escritorio con 3 servicios lado a lado, pestaña del celu) y en una ancha
    // (escritorio mediano). Con lugar, hora y nota van en la misma fila.
    return (
      <div className="@container space-y-3">
        <div className="grid gap-3 @md:grid-cols-[8rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label
              htmlFor={`${prefix}-time`}
              className="text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              Hora al reservar
            </Label>
            <Input
              id={`${prefix}-time`}
              type="time"
              step={900}
              value={setting.time}
              onChange={(e) => setSetting(segment, 'time', e.target.value)}
              aria-invalid={errors.time ? true : undefined}
              aria-describedby={errors.time ? `${prefix}-time-err` : `${prefix}-time-help`}
              className="h-10 w-32 tabular-nums"
            />
            {errors.time ? (
              <p id={`${prefix}-time-err`} className="text-xs text-destructive">
                {errors.time}
              </p>
            ) : (
              <p id={`${prefix}-time-help`} className="text-[11px] text-muted-foreground">
                Viene cargada al tocar «Nueva reserva» en {SEGMENT_WITH_ARTICLE[segment]}.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor={`${prefix}-note`}
              className="text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              Nota del aviso
            </Label>
            <Input
              id={`${prefix}-note`}
              value={setting.note}
              maxLength={80}
              onChange={(e) => setSetting(segment, 'note', e.target.value)}
              placeholder="Conviene abrir la terraza"
              aria-invalid={errors.note ? true : undefined}
              aria-describedby={errors.note ? `${prefix}-note-err` : `${prefix}-note-help`}
              className="h-10"
            />
            {errors.note ? (
              <p id={`${prefix}-note-err`} className="text-xs text-destructive">
                {errors.note}
              </p>
            ) : (
              <p id={`${prefix}-note-help`} className="text-[11px] text-muted-foreground">
                Se muestra cuando {SEGMENT_WITH_ARTICLE[segment]} llega al aviso.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={mondayEmpty}
            aria-label={`Copiar lunes a lun–vie (${label})`}
            onClick={() =>
              copyMonday(
                segment,
                WEEKDAYS_AFTER_MONDAY,
                `${label}: de martes a viernes quedó igual que el lunes.`,
              )
            }
          >
            <Copy aria-hidden />
            Copiar lunes a lun–vie
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={mondayEmpty}
            aria-label={`Igual toda la semana (${label})`}
            onClick={() =>
              copyMonday(segment, ISO_DOWS, `${label}: toda la semana quedó igual que el lunes.`)
            }
          >
            <Repeat aria-hidden />
            Igual toda la semana
          </Button>
        </div>
      </div>
    )
  }

  // Errores de la tabla de escritorio: en una celda de 80 px el mensaje no
  // entra, así que la celda se marca en rojo y el texto va en esta lista (y
  // queda atado al input con aria-describedby).
  const desktopErrors = SEGMENT_KEYS.flatMap((segment) =>
    ISO_DOWS.flatMap((dow) => {
      const errors = validation.cells[segment][dow]
      if (!errors) return []
      const where = `${SEGMENT_LABELS[segment]} · ${DOW_LONG[dow].toLowerCase()}`
      const out: Array<{ id: string; text: string }> = []
      if (errors.capacity) {
        out.push({ id: `${baseId}-d-${segment}-${dow}-cap`, text: `${where}: ${errors.capacity}` })
      }
      if (errors.warn) {
        out.push({ id: `${baseId}-d-${segment}-${dow}-warn`, text: `${where}: ${errors.warn}` })
      }
      return out
    }),
  )

  return (
    <section
      ref={containerRef}
      aria-labelledby={titleId}
      className="card-hairline min-w-0 space-y-5 rounded-xl border border-border/70 bg-card/85 p-4 sm:p-5"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <CalendarRange className="size-4 text-primary" aria-hidden />
          <h2 id={titleId} className="font-serif text-lg font-semibold">
            Cupos por servicio
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Personas por servicio. En la cena, el cupo de un evento se descuenta de este número (cena
          120 con Sushi libre de 70 → quedan 50 para reservas normales). 0 = cerrado ese día.{' '}
          {emptyMeaning}
        </p>
      </div>

      {/* ── Escritorio: tabla servicio × día ── */}
      <div className="hidden space-y-4 md:block">
        <table className="w-full table-fixed border-separate border-spacing-1">
          <caption className="sr-only">
            Cupo y aviso de personas por servicio y día de la semana
          </caption>
          <colgroup>
            <col className="w-28" />
            {ISO_DOWS.map((dow) => (
              <col key={dow} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <td />
              {ISO_DOWS.map((dow) => (
                <th
                  key={dow}
                  scope="col"
                  className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  <abbr title={DOW_LONG[dow]} className="no-underline">
                    {DOW_SHORT[dow]}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SEGMENT_KEYS.map((segment) => (
              <tr key={segment}>
                <th scope="row" className="pr-2 pt-1.5 text-left align-top font-normal">
                  <span className="block text-sm font-semibold">{SEGMENT_LABELS[segment]}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {draft.settings[segment].time || '—'}
                  </span>
                </th>
                {ISO_DOWS.map((dow) => {
                  const inputs = cellInputs(segment, dow, 'd')
                  return (
                    <td key={dow} className="align-top">
                      <div className="flex flex-col gap-1">
                        {inputs.capacity}
                        {inputs.warn}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {desktopErrors.length > 0 ? (
          <ul className="space-y-0.5 text-xs text-destructive" aria-live="polite">
            {desktopErrors.map((e) => (
              <li key={e.id} id={e.id}>
                {e.text}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-3">
          {SEGMENT_KEYS.map((segment) => (
            <fieldset
              key={segment}
              className="min-w-0 space-y-3 rounded-lg border border-border/60 p-3"
            >
              <legend className="px-1 text-sm font-semibold">{SEGMENT_LABELS[segment]}</legend>
              {segmentExtras(segment, 'd')}
            </fieldset>
          ))}
        </div>
      </div>

      {/* ── Celu: una pestaña por servicio, 7 filas ── */}
      <div className="md:hidden">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            if (isSegmentKey(v)) setTab(v)
          }}
        >
          <TabsList className="grid w-full grid-cols-3">
            {SEGMENT_KEYS.map((segment) => {
              const hasErrors = segmentHasErrors(validation, segment)
              return (
                <TabsTrigger key={segment} value={segment} className="gap-1">
                  {SEGMENT_LABELS[segment]}
                  {hasErrors ? (
                    <>
                      <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
                      <span className="sr-only">(con errores)</span>
                    </>
                  ) : null}
                </TabsTrigger>
              )
            })}
          </TabsList>

          {SEGMENT_KEYS.map((segment) => (
            <TabsContent key={segment} value={segment} className="space-y-5 pt-2">
              <div>
                <div
                  aria-hidden
                  className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-2 px-0.5 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground"
                >
                  <span>Día</span>
                  <span className="text-center">Cupo</span>
                  <span className="text-center">Aviso</span>
                </div>
                <ul className="divide-y divide-border/50">
                  {ISO_DOWS.map((dow) => {
                    const inputs = cellInputs(segment, dow, 'm')
                    const cell = draft.cells[segment][dow]
                    const caption =
                      cell.capacity.trim() === ''
                        ? 'cupo general'
                        : toNumber(cell.capacity) === 0
                          ? 'cerrado'
                          : null
                    return (
                      <li key={dow} className="py-1.5">
                        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-2">
                          <div className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {DOW_LONG[dow]}
                            </span>
                            {caption ? (
                              <span className="block text-[11px] text-muted-foreground">
                                {caption}
                              </span>
                            ) : null}
                          </div>
                          {inputs.capacity}
                          {inputs.warn}
                        </div>
                        {inputs.errors?.capacity ? (
                          <p id={inputs.capErrId} className="pt-1 text-xs text-destructive">
                            {inputs.errors.capacity}
                          </p>
                        ) : null}
                        {inputs.errors?.warn ? (
                          <p id={inputs.warnErrId} className="pt-1 text-xs text-destructive">
                            {inputs.errors.warn}
                          </p>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
              {segmentExtras(segment, 'm')}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-end">
        <p
          className={cn(
            'text-xs sm:mr-auto',
            saveError ? 'text-destructive' : 'text-muted-foreground',
          )}
          aria-live="polite"
        >
          {saveError ?? (dirty ? 'Tenés cambios sin guardar.' : 'Todo guardado.')}
        </p>
        <Button type="button" onClick={save} disabled={pending || !dirty} className="gap-2">
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          {pending ? 'Guardando…' : 'Guardar cupos'}
        </Button>
      </div>
    </section>
  )
}
