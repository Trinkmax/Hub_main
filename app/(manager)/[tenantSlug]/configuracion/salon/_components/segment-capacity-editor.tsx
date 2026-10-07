'use client'

import { CircleAlert, Copy, Repeat, Save } from 'lucide-react'
import { useId, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Card } from '@/components/ui/card'
import {
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableRow,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TimeField } from '@/components/ui/time-field'
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
  const containerRef = useRef<HTMLDivElement>(null)

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
    // En la tabla de escritorio, controles chicos (32 px); en el celular, los
    // de siempre (44 px con el dedo).
    const size = view === 'd' ? 'sm' : 'md'
    return {
      capacity: (
        <Input
          size={size}
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
            'px-1 text-center font-semibold type-amount placeholder:font-normal',
            // Vacío = usa el cupo general: el borde punteado lo dice sin texto.
            cell.capacity === '' && 'border-dashed',
            closed && 'bg-muted text-muted-foreground',
          )}
        />
      ),
      warn: (
        <Input
          size={size}
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
          className="px-1 text-center type-amount"
        />
      ),
      capErrId,
      warnErrId,
      errors,
    }
  }

  function segmentExtras(segment: SegmentKey) {
    const setting = draft.settings[segment]
    const errors = validation.settings[segment]
    const label = SEGMENT_LABELS[segment]
    const mondayEmpty = draft.cells[segment][1].capacity.trim() === ''
    // Container query: la misma pieza va en una columna angosta (las tres
    // tarjetas de escritorio lado a lado, la pestaña del celu) y en una ancha
    // (escritorio mediano). Con lugar, hora y nota van en la misma fila.
    return (
      <div className="@container flex flex-col gap-4">
        <div className="grid gap-4 @md:grid-cols-[9rem_minmax(0,1fr)]">
          <Field
            label="Hora al reservar"
            hint={`Viene cargada al tocar «Nueva reserva» en ${SEGMENT_WITH_ARTICLE[segment]}.`}
            error={errors.time}
          >
            <TimeField
              value={setting.time || null}
              onValueChange={(hhmm) => setSetting(segment, 'time', hhmm ?? '')}
            />
          </Field>
          <Field
            label="Nota del aviso"
            hint={`Se muestra cuando ${SEGMENT_WITH_ARTICLE[segment]} llega al aviso.`}
            error={errors.note}
            optional
          >
            <Input
              value={setting.note}
              maxLength={80}
              onChange={(e) => setSetting(segment, 'note', e.target.value)}
              placeholder="Conviene abrir la terraza"
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
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
            variant="secondary"
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

  // Errores de la tabla de escritorio: en una celda angosta el mensaje no
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
    <Section
      title="Cupos por servicio"
      description={
        <>
          Personas por servicio. En la cena, el cupo de un evento se descuenta de este número (cena
          120 con Sushi libre de 70 → quedan 50 para reservas normales). 0 = cerrado ese día.{' '}
          {emptyMeaning}
        </>
      }
    >
      <div ref={containerRef} className="flex min-w-0 flex-col gap-5">
        {/* ── Escritorio: tabla servicio × día ── */}
        <div className="hidden md:flex md:flex-col md:gap-4">
          <DataTableShell>
            <DataTableScroll>
              <DataTableRoot
                density="compact"
                caption="Cupo y aviso de personas por servicio y día de la semana"
                className="min-w-[38rem] table-fixed"
              >
                <colgroup>
                  <col className="w-28" />
                  {ISO_DOWS.map((dow) => (
                    <col key={dow} />
                  ))}
                </colgroup>
                <DataTableHead>
                  <tr>
                    <DataTableHeader>
                      <span className="sr-only">Servicio</span>
                    </DataTableHeader>
                    {ISO_DOWS.map((dow) => (
                      <DataTableHeader key={dow} align="center" className="last:pe-3">
                        <abbr title={DOW_LONG[dow]} className="no-underline">
                          {DOW_SHORT[dow]}
                        </abbr>
                      </DataTableHeader>
                    ))}
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {SEGMENT_KEYS.map((segment) => (
                    <DataTableRow key={segment}>
                      <th
                        scope="row"
                        className="px-[var(--cell-px,1rem)] py-[var(--cell-py,0.5rem)] text-start align-top font-normal"
                      >
                        <span className="block font-semibold text-foreground">
                          {SEGMENT_LABELS[segment]}
                        </span>
                        <span className="type-caption type-amount text-muted-foreground">
                          {draft.settings[segment].time || '—'}
                        </span>
                      </th>
                      {ISO_DOWS.map((dow) => {
                        const inputs = cellInputs(segment, dow, 'd')
                        return (
                          // `last:pe-3`: la última columna no queda pegada al borde
                          // de la tabla (las celdas van con 4 px para que entren 7 días).
                          <DataTableCell key={dow} className="px-1 align-top last:pe-3">
                            <div className="flex flex-col gap-1">
                              {inputs.capacity}
                              {inputs.warn}
                            </div>
                          </DataTableCell>
                        )
                      })}
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTableRoot>
            </DataTableScroll>
          </DataTableShell>

          <div aria-live="polite">
            {desktopErrors.length > 0 ? (
              <Callout tone="danger" title="Revisá estos cupos">
                <ul className="flex flex-col gap-0.5">
                  {desktopErrors.map((e) => (
                    <li key={e.id} id={e.id}>
                      {e.text}
                    </li>
                  ))}
                </ul>
              </Callout>
            ) : null}
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            {SEGMENT_KEYS.map((segment) => {
              const headingId = `${baseId}-d-${segment}-extras`
              return (
                <Card
                  key={segment}
                  role="group"
                  aria-labelledby={headingId}
                  padding="sm"
                  className="min-w-0 gap-3 sm:p-4"
                >
                  <h3 id={headingId} className="type-label text-foreground">
                    {SEGMENT_LABELS[segment]}
                  </h3>
                  {segmentExtras(segment)}
                </Card>
              )
            })}
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
            <TabsList aria-label="Servicios">
              {SEGMENT_KEYS.map((segment) => {
                const hasErrors = segmentHasErrors(validation, segment)
                return (
                  <TabsTrigger key={segment} value={segment}>
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
              <TabsContent key={segment} value={segment} className="flex flex-col gap-5 pt-2">
                <div>
                  <div
                    aria-hidden
                    className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 pb-1 type-caption text-muted-foreground"
                  >
                    <span>Día</span>
                    <span className="text-center">Cupo</span>
                    <span className="text-center">Aviso</span>
                  </div>
                  <ul className="divide-y divide-border">
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
                        <li key={dow} className="py-2">
                          <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-2">
                            <div className="min-w-0">
                              <span className="block truncate font-medium text-foreground">
                                {DOW_LONG[dow]}
                              </span>
                              {caption ? (
                                <span className="block type-caption text-muted-foreground">
                                  {caption}
                                </span>
                              ) : null}
                            </div>
                            {inputs.capacity}
                            {inputs.warn}
                          </div>
                          {inputs.errors?.capacity ? (
                            <CellError id={inputs.capErrId}>{inputs.errors.capacity}</CellError>
                          ) : null}
                          {inputs.errors?.warn ? (
                            <CellError id={inputs.warnErrId}>{inputs.errors.warn}</CellError>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </div>
                {segmentExtras(segment)}
              </TabsContent>
            ))}
          </Tabs>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
          <p
            className={cn(
              'type-small sm:me-auto',
              saveError ? 'text-destructive-text' : 'text-muted-foreground',
            )}
            aria-live="polite"
          >
            {saveError ?? (dirty ? 'Tenés cambios sin guardar.' : 'Todo guardado.')}
          </p>
          <Button
            type="button"
            onClick={save}
            disabled={!dirty && !pending}
            loading={pending}
            loadingText="Guardando…"
            className="max-sm:w-full"
          >
            <Save aria-hidden />
            Guardar cupos
          </Button>
        </div>
      </div>
    </Section>
  )
}

/** El error de una celda en el celular, con la misma cara que el de un `Field`. */
function CellError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1 pt-1 type-caption text-destructive-text">
      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
