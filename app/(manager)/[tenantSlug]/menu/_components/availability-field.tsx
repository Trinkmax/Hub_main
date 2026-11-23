'use client'

import { Clock, Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  AVAILABILITY_PRESETS,
  availabilitySentence,
  crossesMidnight,
  dayName,
  dayShort,
  fromDrafts,
  isAvailableAt,
  MAX_WINDOWS,
  newWindowDraft,
  sameAvailability,
  toDrafts,
  toggleDraftDay,
  WEEK_ORDER,
  type WindowDraft,
} from '@/lib/menu/availability'
import { cn } from '@/lib/utils'

/**
 * La hora de ahora, de a minutos. `null` hasta que la pantalla está en el navegador: lo que depende
 * del reloj («Ahora no se muestra») no sale en el HTML del servidor, así no hay dos versiones.
 */
export function useMinuteNow(): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

const CHIP =
  'inline-flex min-h-9 items-center rounded-full border px-3 text-sm outline-none transition-colors duration-(--duration-fast) ease-(--ease-out) focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none'
const CHIP_OFF = 'border-border bg-background text-foreground hover:bg-secondary/60'
const CHIP_ON = 'border-primary bg-primary text-primary-foreground'

/**
 * «¿Cuándo se muestra?»: el horario de un rubro de la carta.
 *
 * Pedido de los socios (22/11/2026): «agregar en carta menús al mediodía, debe aparecer en
 * determinados horarios» y «fines de semana debe aparecer únicamente el menú del fin de semana».
 * Los casos de siempre se eligen de un toque; después se ajustan los días y las horas. Abajo, la
 * oración dice en palabras lo que va a pasar, y si ahora mismo se está mostrando.
 *
 * `drafts: null` = siempre. La forma que se guarda sale de `fromDrafts`.
 */
export function AvailabilityField({
  drafts,
  onChange,
  timeZone,
  disabled = false,
}: {
  drafts: WindowDraft[] | null
  onChange: (next: WindowDraft[] | null) => void
  /** La zona horaria del bar: las horas son las suyas, no las del teléfono de quien edita. */
  timeZone: string
  disabled?: boolean
}) {
  const headingId = useId()
  const now = useMinuteNow()
  const value = drafts === null ? null : fromDrafts(drafts)
  const preset = AVAILABILITY_PRESETS.find((each) => sameAvailability(each.value, value))
  // Un horario propio: hay franjas y no coinciden con ninguno de los atajos.
  const custom = drafts !== null && !preset

  const setDraft = (index: number, next: WindowDraft) => {
    if (drafts === null) return
    onChange(drafts.map((draft, at) => (at === index ? next : draft)))
  }
  const remove = (index: number) => {
    if (drafts === null) return
    const rest = drafts.filter((_, at) => at !== index)
    onChange(rest.length === 0 ? null : rest)
  }

  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-3" data-testid="horario">
      <div>
        <h3 id={headingId} className="flex items-center gap-1.5 text-sm font-medium">
          <Clock aria-hidden className="size-4 text-muted-foreground" />
          ¿Cuándo se muestra?
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
          En la carta que ve el cliente. Lo de adentro (subcategorías y productos) la sigue. Las
          horas son las del bar.
        </p>
      </div>

      {/* Un `fieldset` no se achica por debajo de su contenido salvo que se le diga (`min-w-0`). */}
      <fieldset className="flex min-w-0 flex-wrap gap-1.5" disabled={disabled}>
        <legend className="sr-only">Horarios de siempre</legend>
        {AVAILABILITY_PRESETS.map((each) => (
          <button
            key={each.id}
            type="button"
            aria-pressed={!custom && preset?.id === each.id}
            onClick={() => onChange(each.value === null ? null : toDrafts(each.value))}
            className={cn(CHIP, !custom && preset?.id === each.id ? CHIP_ON : CHIP_OFF)}
            data-testid={`horario-${each.id}`}
          >
            {each.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => {
            if (drafts === null) onChange([newWindowDraft()])
          }}
          className={cn(CHIP, custom ? CHIP_ON : CHIP_OFF)}
          data-testid="horario-otro"
        >
          Otro horario
        </button>
      </fieldset>

      {drafts !== null ? (
        <div className="grid min-w-0 grid-cols-1 gap-2">
          {drafts.map((draft, index) => (
            <WindowEditor
              // Las franjas no tienen identidad propia: el lugar en la lista es lo que las nombra.
              // biome-ignore lint/suspicious/noArrayIndexKey: ver arriba
              key={index}
              draft={draft}
              label={drafts.length > 1 ? `Franja ${index + 1}` : null}
              disabled={disabled}
              onChange={(next) => setDraft(index, next)}
              onRemove={drafts.length > 1 ? () => remove(index) : null}
            />
          ))}
          {drafts.length < MAX_WINDOWS ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-self-start gap-1.5"
              disabled={disabled}
              onClick={() => onChange([...drafts, newWindowDraft()])}
              data-testid="horario-agregar"
            >
              <Plus className="size-3.5" aria-hidden /> Agregar otra franja
            </Button>
          ) : null}
        </div>
      ) : null}

      <p
        role="status"
        aria-live="polite"
        className="rounded-lg bg-secondary/50 px-3 py-2 text-sm text-pretty"
        data-testid="horario-oracion"
      >
        {availabilitySentence(value)}
        {value !== null && now !== null ? (
          <span className="text-muted-foreground">
            {' '}
            {isAvailableAt(value, now, timeZone)
              ? 'Ahora se está mostrando.'
              : 'Ahora no se muestra.'}
          </span>
        ) : null}
      </p>
    </section>
  )
}

function WindowEditor({
  draft,
  label,
  disabled,
  onChange,
  onRemove,
}: {
  draft: WindowDraft
  /** «Franja 2»: solo cuando hay más de una. */
  label: string | null
  disabled: boolean
  onChange: (next: WindowDraft) => void
  onRemove: (() => void) | null
}) {
  const allDayId = useId()
  const fromId = useId()
  const toId = useId()
  return (
    <fieldset
      disabled={disabled}
      className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-border/70 bg-card p-3"
      data-testid="horario-franja"
    >
      <legend className="sr-only">{label ?? 'Días y horas'}</legend>
      {label || onRemove ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </span>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Quitar la ${(label ?? 'franja').toLowerCase()}`}
              className="-m-1 flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Los siete en una fila también en el celular más angosto: se reparten el ancho. */}
      <fieldset className="grid min-w-0 grid-cols-7 gap-1 sm:flex sm:flex-wrap">
        <legend className="sr-only">Días</legend>
        {WEEK_ORDER.map((day) => {
          const on = draft.days.includes(day)
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              aria-label={dayName(day)}
              title={dayName(day)}
              onClick={() => onChange(toggleDraftDay(draft, day))}
              className={cn(
                'flex h-10 w-full items-center justify-center rounded-full border text-sm font-medium outline-none transition-colors duration-(--duration-fast) ease-(--ease-out) focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none sm:w-10',
                on ? CHIP_ON : CHIP_OFF,
              )}
            >
              {dayShort(day).slice(0, 2)}
            </button>
          )
        })}
      </fieldset>

      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <label
          htmlFor={allDayId}
          className="flex min-h-10 cursor-pointer items-center gap-2 text-sm"
        >
          <Switch
            id={allDayId}
            checked={draft.allDay}
            onCheckedChange={(allDay) => onChange({ ...draft, allDay })}
          />
          Todo el día
        </label>
        {draft.allDay ? null : (
          <div className="flex w-full min-w-0 items-center gap-2 text-sm sm:w-auto">
            <label htmlFor={fromId}>De</label>
            <Input
              id={fromId}
              type="time"
              step={300}
              value={draft.from}
              onChange={(event) => onChange({ ...draft, from: event.target.value })}
              className="min-w-0 flex-1 sm:w-[8.25rem] sm:flex-none"
              data-testid="horario-desde"
            />
            <label htmlFor={toId}>a</label>
            <Input
              id={toId}
              type="time"
              step={300}
              value={draft.to}
              onChange={(event) => onChange({ ...draft, to: event.target.value })}
              className="min-w-0 flex-1 sm:w-[8.25rem] sm:flex-none"
              data-testid="horario-hasta"
            />
          </div>
        )}
      </div>

      {crossesMidnight(draft) ? (
        <p className="text-xs text-muted-foreground text-pretty">
          Termina al día siguiente: la madrugada cuenta como parte de la noche en que empezó.
        </p>
      ) : null}
    </fieldset>
  )
}
