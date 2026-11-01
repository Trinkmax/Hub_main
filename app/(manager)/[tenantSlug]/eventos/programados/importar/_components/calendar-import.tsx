'use client'

import { AlertTriangle, CalendarCheck, Download, Loader2, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { FileDropZone } from '@/components/administracion/importar/file-drop-zone'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { buildCsv } from '@/lib/csv/write'
import {
  applyCalendarImport,
  type CalendarImportApplyState,
  type CalendarImportItem,
  type CalendarImportPreview,
  previewCalendarImport,
} from '@/lib/salon/calendar-import-actions'
import { cn } from '@/lib/utils'

type Name = { label: string; calendarName: string | null }
type Applied = Extract<CalendarImportApplyState, { ok: true }>

const WEEKDAY = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' })
const MONTH = new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'UTC' })

/** «2026-11-15» → «Dom 15/11». */
function dayLabel(date: string): string {
  const weekday = WEEKDAY.format(new Date(`${date}T00:00:00Z`)).replace('.', '')
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${date.slice(8, 10)}/${date.slice(5, 7)}`
}

/** ['2026-11', '2026-12'] → «noviembre y diciembre de 2026». */
function monthsLabel(months: readonly string[]): string {
  const names = months.map((m) => MONTH.format(new Date(`${m}-01T00:00:00Z`)))
  const years = [...new Set(months.map((m) => m.slice(0, 4)))]
  const list =
    names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`
  return years.length === 1 ? `${list} de ${years[0]}` : list
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** «15/12/2026» del mes que viene, para la plantilla. */
function exampleDate(today: string, day: number): string {
  const [y, m] = today.split('-').map(Number)
  const next = new Date(Date.UTC(y ?? 2026, m ?? 1, day))
  return `${String(day).padStart(2, '0')}/${String(next.getUTCMonth() + 1).padStart(2, '0')}/${next.getUTCFullYear()}`
}

/** Las fechas que cambian de película el mismo día: una que se quita y una que se agrega. */
function pairChanges(items: readonly CalendarImportItem[]) {
  const removesByDate = new Map<string, CalendarImportItem[]>()
  for (const it of items) {
    if (it.kind === 'remove')
      removesByDate.set(it.date, [...(removesByDate.get(it.date) ?? []), it])
  }
  const pairs: Array<{ from: CalendarImportItem; to: CalendarImportItem }> = []
  const paired = new Set<string>()
  for (const it of items) {
    if (it.kind !== 'create') continue
    const from = removesByDate.get(it.date)?.shift()
    if (!from) continue
    pairs.push({ from, to: it })
    paired.add(from.key)
    paired.add(it.key)
  }
  return { pairs, paired }
}

export function CalendarImport({
  tenantSlug,
  names,
  today,
}: {
  tenantSlug: string
  names: Name[]
  today: string
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<CalendarImportPreview | null>(null)
  const [applied, setApplied] = useState<Applied | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removeMissing, setRemoveMissing] = useState(true)
  const [reading, startReading] = useTransition()
  const [applying, startApplying] = useTransition()

  function pick(next: File) {
    setFile(next)
    setPreview(null)
    setApplied(null)
    setError(null)
    startReading(async () => {
      const form = new FormData()
      form.set('file', next)
      const result = await previewCalendarImport(tenantSlug, form)
      if (result.ok) setPreview(result.preview)
      else setError(result.message)
    })
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setApplied(null)
    setError(null)
    setRemoveMissing(true)
  }

  function apply() {
    if (!file) return
    setError(null)
    startApplying(async () => {
      const form = new FormData()
      form.set('file', file)
      form.set('removeMissing', removeMissing ? '1' : '0')
      const result = await applyCalendarImport(tenantSlug, form)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setApplied(result)
      setPreview(null)
      toast.success('Calendario actualizado.')
    })
  }

  function downloadTemplate() {
    const films = names.slice(0, 3).map((n) => n.label)
    const rows = [
      [exampleDate(today, 15), films[0] ?? 'Película', '21:00', 50],
      [exampleDate(today, 22), films[1] ?? films[0] ?? 'Película', '', ''],
      [
        `${exampleDate(today, 6)}; ${exampleDate(today, 8)}`,
        films[2] ?? films[0] ?? 'Película',
        '',
        '',
      ],
    ]
    const blob = new Blob([buildCsv(['Fecha', 'Película', 'Hora', 'Cupo'], rows)], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'fechas-calendario.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (applied) {
    return <AppliedSummary applied={applied} tenantSlug={tenantSlug} onAgain={reset} />
  }

  return (
    <div className="space-y-6">
      {!preview ? (
        <>
          <section
            aria-labelledby="como-armar"
            className="card-hairline space-y-4 rounded-xl border bg-card p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 id="como-armar" className="font-serif text-lg font-semibold tracking-tight">
                Cómo armar el Excel
              </h2>
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 sm:h-9"
                onClick={downloadTemplate}
              >
                <Download className="size-4" aria-hidden />
                Bajar la plantilla
              </Button>
            </div>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-pretty">
              <li>
                Una columna <strong>Fecha</strong> y otra <strong>Película</strong> (o evento). Si
                querés, <strong>Hora</strong> y <strong>Cupo</strong>; si no están, se usan los de
                siempre.
              </li>
              <li>
                Las fechas, como te salgan: «15/12», «15/12/2026» o «domingo 15 de diciembre».
                Varias en una celda, separadas con punto y coma: «6/12; 8/12».
              </li>
              <li>
                Las películas, con el nombre de Entradas o del calendario. Si un nombre no está, te
                avisamos antes de guardar.
              </li>
              <li>
                El Excel manda en los meses que trae y solo para las películas que nombra: el resto
                del calendario no se toca.
              </li>
            </ul>
            {names.length > 0 ? (
              <details className="group text-sm">
                <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                  Nombres que reconoce ({names.length})
                </summary>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {names.map((n) => (
                    <li
                      key={`${n.label}-${n.calendarName ?? ''}`}
                      className="rounded-full border bg-background px-2.5 py-1 text-xs"
                    >
                      {n.label}
                      {n.calendarName ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · «{n.calendarName}» en el calendario
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <FileDropZone
            accept=".xlsx,.csv,.txt"
            title="Soltá acá el Excel con las fechas"
            touchTitle="Elegí el Excel con las fechas"
            hint="Excel (.xlsx) o CSV. Antes de guardar te mostramos los cambios."
            disabled={reading}
            onFile={pick}
          />
        </>
      ) : null}

      <div aria-live="polite">
        {reading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Leyendo {file?.name ?? 'el archivo'}…
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
      </div>

      {preview ? (
        <PreviewView
          preview={preview}
          removeMissing={removeMissing}
          onRemoveMissing={setRemoveMissing}
          applying={applying}
          onApply={apply}
          onReset={reset}
        />
      ) : null}
    </div>
  )
}

function PreviewView({
  preview,
  removeMissing,
  onRemoveMissing,
  applying,
  onApply,
  onReset,
}: {
  preview: CalendarImportPreview
  removeMissing: boolean
  onRemoveMissing: (value: boolean) => void
  applying: boolean
  onApply: () => void
  onReset: () => void
}) {
  const { pairs, paired } = pairChanges(preview.items)
  const creates = preview.items.filter((i) => i.kind === 'create' && !paired.has(i.key))
  const updates = preview.items.filter((i) => i.kind === 'update')
  const removes = preview.items.filter((i) => i.kind === 'remove' && !paired.has(i.key))
  const keeps = preview.items.filter((i) => i.kind === 'keep')
  const sames = preview.items.filter((i) => i.kind === 'same')
  const allRemoves = removes.length + pairs.length
  const changes =
    creates.length +
    pairs.length +
    updates.filter((u) => u.newTime || u.newCapacity).length +
    (removeMissing ? allRemoves : 0)

  if (preview.noColumns) {
    return (
      <div className="space-y-4">
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          No encontramos las columnas de fecha y película en «{preview.fileName}». Poné una fila de
          títulos con «Fecha» y «Película» (o bajá la plantilla) y subilo de nuevo.
        </p>
        <Button type="button" variant="outline" className="h-11 gap-2 sm:h-9" onClick={onReset}>
          <RotateCcw className="size-4" aria-hidden />
          Elegir otro archivo
        </Button>
      </div>
    )
  }

  const summary = [
    creates.length ? plural(creates.length, 'se agrega', 'se agregan') : null,
    pairs.length ? plural(pairs.length, 'cambia de película', 'cambian de película') : null,
    updates.length ? plural(updates.length, 'cambia hora o cupo', 'cambian hora o cupo') : null,
    removes.length ? plural(removes.length, 'se quita', 'se quitan') : null,
    keeps.length ? plural(keeps.length, 'queda por reservas', 'quedan por reservas') : null,
    sames.length ? plural(sames.length, 'queda igual', 'quedan igual') : null,
    preview.problems.length
      ? plural(preview.problems.length, 'con problemas', 'con problemas')
      : null,
  ].filter(Boolean)

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {preview.fileName}
          {preview.months.length > 0 ? ` · ${monthsLabel(preview.months)}` : ''}
        </p>
        <p className="font-serif text-xl font-semibold tracking-tight text-balance">
          {summary.length > 0 ? summary.join(' · ') : 'No encontramos fechas para cargar.'}
        </p>
      </div>

      {creates.length > 0 ? (
        <Group title="Se agregan" tone="success">
          {creates.map((i) => (
            <Row key={i.key} item={i} detail={`${i.time} · cupo ${i.capacity ?? '—'}`} />
          ))}
        </Group>
      ) : null}

      {pairs.length > 0 ? (
        <Group
          title="Cambian de película"
          tone="info"
          note={
            removeMissing
              ? null
              : 'Con «Quitar» apagado, se agrega la nueva y la anterior también queda.'
          }
        >
          {pairs.map(({ from, to }) => (
            <li
              key={to.key}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5"
            >
              <span className="font-medium">
                <span className="tabular-nums">{dayLabel(to.date)}</span> ·{' '}
                <span className="text-muted-foreground line-through decoration-1">
                  {from.label}
                </span>{' '}
                → {to.label}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {to.time} · cupo {to.capacity ?? '—'}
              </span>
            </li>
          ))}
        </Group>
      ) : null}

      {updates.length > 0 ? (
        <Group title="Cambian hora o cupo" tone="info">
          {updates.map((i) => (
            <Row
              key={i.key}
              item={i}
              detail={[
                i.newTime ? `hora ${i.time} → ${i.newTime}` : null,
                i.newCapacity ? `cupo ${i.capacity} → ${i.newCapacity}` : null,
                i.timeBlocked ? 'la hora no se cambia: tiene reservas' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </Group>
      ) : null}

      {removes.length > 0 ? (
        <Group
          title="Se quitan del calendario"
          tone="danger"
          note="Están en el calendario pero no en el Excel, y no tienen reservas."
        >
          {removes.map((i) => (
            <Row key={i.key} item={i} detail={i.time} muted={!removeMissing} />
          ))}
        </Group>
      ) : null}

      {allRemoves > 0 ? (
        <div className="flex items-start justify-between gap-4 rounded-xl border px-4 py-3">
          <div className="grid min-w-0 gap-0.5">
            <Label htmlFor="remove-missing">Quitar las que no están en el Excel</Label>
            <p id="remove-missing-hint" className="text-xs text-muted-foreground text-pretty">
              Apagado, solo se agregan y se cambian fechas: no se quita ninguna.
            </p>
          </div>
          <Switch
            id="remove-missing"
            checked={removeMissing}
            onCheckedChange={onRemoveMissing}
            aria-describedby="remove-missing-hint"
          />
        </div>
      ) : null}

      {keeps.length > 0 ? (
        <Group
          title="Quedan porque tienen reservas"
          tone="warning"
          note="No están en el Excel. Si hay que sacarlas, mové o cancelá sus reservas desde el calendario."
        >
          {keeps.map((i) => (
            <Row
              key={i.key}
              item={i}
              detail={`${i.time} · ${plural(i.reservations, 'reserva', 'reservas')}`}
            />
          ))}
        </Group>
      ) : null}

      {preview.problems.length > 0 ? (
        <Group
          title="Con problemas (no se cargan)"
          tone="danger"
          note="Corregilas en el Excel y subilo de nuevo, o cargalas a mano."
        >
          {preview.problems.map((p) => (
            <li key={`${p.line}-${p.text}`} className="grid gap-0.5 py-2.5">
              <span className="font-medium">
                <span className="text-muted-foreground tabular-nums">Fila {p.line} · </span>
                {p.text}
              </span>
              <span className="text-sm text-destructive">{p.reason}</span>
            </li>
          ))}
        </Group>
      ) : null}

      {sames.length > 0 ? (
        <details className="rounded-xl border bg-card px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {plural(sames.length, 'fecha queda igual', 'fechas quedan igual')}
          </summary>
          <ul className="mt-2 divide-y">
            {sames.map((i) => (
              <Row key={i.key} item={i} detail={i.time} />
            ))}
          </ul>
        </details>
      ) : null}

      {preview.duplicates > 0 ? (
        <p className="text-sm text-muted-foreground">
          {plural(preview.duplicates, 'fila repetida se tomó', 'filas repetidas se tomaron')} una
          sola vez.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button
          type="button"
          className="h-11 gap-2 sm:h-9"
          onClick={onApply}
          disabled={applying || changes === 0}
        >
          {applying ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <CalendarCheck className="size-4" aria-hidden />
          )}
          {applying
            ? 'Guardando…'
            : changes === 0
              ? 'No hay cambios para guardar'
              : `Guardar ${plural(changes, 'cambio', 'cambios')}`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 gap-2 sm:h-9"
          onClick={onReset}
          disabled={applying}
        >
          <RotateCcw className="size-4" aria-hidden />
          Elegir otro archivo
        </Button>
      </div>
    </div>
  )
}

const TONES = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  danger: 'destructive',
} as const

function Group({
  title,
  tone,
  note,
  children,
}: {
  title: string
  tone: keyof typeof TONES
  note?: string | null
  children: React.ReactNode
}) {
  return (
    <section className="card-hairline rounded-xl border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={TONES[tone]}>{title}</Badge>
        {note ? <p className="text-xs text-muted-foreground text-pretty">{note}</p> : null}
      </div>
      <ul className="mt-1 divide-y">{children}</ul>
    </section>
  )
}

function Row({
  item,
  detail,
  muted = false,
}: {
  item: CalendarImportItem
  detail: string
  muted?: boolean
}) {
  return (
    <li
      className={cn(
        'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5',
        muted && 'opacity-50',
      )}
    >
      <span className="font-medium">
        <span className="tabular-nums">{dayLabel(item.date)}</span> · {item.label}
        {item.calendarName ? (
          <span className="font-normal text-muted-foreground"> («{item.calendarName}»)</span>
        ) : null}
      </span>
      <span className="text-sm text-muted-foreground tabular-nums">{detail}</span>
    </li>
  )
}

function AppliedSummary({
  applied,
  tenantSlug,
  onAgain,
}: {
  applied: Applied
  tenantSlug: string
  onAgain: () => void
}) {
  const parts = [
    applied.created ? plural(applied.created, 'fecha agregada', 'fechas agregadas') : null,
    applied.updated ? plural(applied.updated, 'cambiada', 'cambiadas') : null,
    applied.removed ? plural(applied.removed, 'quitada', 'quitadas') : null,
  ].filter(Boolean)
  const calendarHref = `/${tenantSlug}/eventos/programados${applied.firstMonth ? `?month=${applied.firstMonth}` : ''}`
  return (
    <div className="space-y-5">
      <div className="card-hairline space-y-2 rounded-xl border bg-card p-5">
        <p className="flex items-center gap-2 font-serif text-xl font-semibold tracking-tight">
          <CalendarCheck className="size-5 text-success" aria-hidden />
          Listo
        </p>
        <p className="text-sm text-pretty">
          {parts.length > 0 ? `${parts.join(', ')}.` : 'No hubo nada para cambiar.'} Las películas
          con página en Entradas ya muestran sus fechas.
        </p>
      </div>
      {applied.skipped.length > 0 ? (
        <Group title="No se tocaron" tone="warning">
          {applied.skipped.map((s) => (
            <li key={`${s.date}-${s.label}-${s.reason}`} className="grid gap-0.5 py-2.5">
              <span className="font-medium">
                <span className="tabular-nums">{dayLabel(s.date)}</span> · {s.label}
              </span>
              <span className="text-sm text-muted-foreground">{s.reason}</span>
            </li>
          ))}
        </Group>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild className="h-11 sm:h-9">
          <Link href={calendarHref}>Ver el calendario</Link>
        </Button>
        <Button type="button" variant="ghost" className="h-11 gap-2 sm:h-9" onClick={onAgain}>
          <RotateCcw className="size-4" aria-hidden />
          Cargar otro Excel
        </Button>
      </div>
    </div>
  )
}
