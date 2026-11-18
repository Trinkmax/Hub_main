'use client'

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Save,
} from 'lucide-react'
import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { FileDropZone } from '@/components/administracion/importar/file-drop-zone'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ZoneChoice, ZoneChoices } from '@/lib/purchasing/sheet'
import {
  applyItemsSheet,
  type ItemsSheetApplyState,
  type ItemsSheetNewZone,
  type ItemsSheetPreview,
  previewItemsSheet,
} from '@/lib/purchasing/sheet-actions'
import { cn } from '@/lib/utils'

type Applied = Extract<ItemsSheetApplyState, { ok: true }>

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('es-AR')} ${n === 1 ? one : many}`
}

/** ['Notas', 'Activo'] → «Notas y Activo». */
function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
}

/** Lo que se va a hacer con cada zona nueva, tal como lo muestra la vista previa. */
function choicesOf(preview: ItemsSheetPreview | null): ZoneChoices {
  return Object.fromEntries((preview?.newZones ?? []).map((z) => [z.key, z.choice]))
}

/** Cuántas zonas se arman o cambian de nombre al guardar. */
function zoneWritesOf(preview: ItemsSheetPreview): number {
  return preview.newZones.filter((z) => z.choice.kind !== 'existing').length
}

/**
 * Compras › Insumos › Planilla: bajar la lista, cambiarla afuera y subirla. Subir muestra primero qué cambia
 * (`previewItemsSheet`); guardar vuelve a leer el archivo y solo guarda si sigue siendo lo que se vio. Si la
 * planilla trae zonas que HUB no tiene, cada elección («es nueva», «es una que ya está», «le cambié el nombre»)
 * vuelve a pedir la vista previa, así lo que se ve es lo que se guarda.
 */
export function ItemsSheetImport({
  tenantSlug,
  itemCount,
}: {
  tenantSlug: string
  itemCount: number
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ItemsSheetPreview | null>(null)
  const [applied, setApplied] = useState<Applied | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reading, startReading] = useTransition()
  const [refreshing, startRefreshing] = useTransition()
  const [applying, startApplying] = useTransition()
  // La última vista previa pedida: si se eligen dos zonas seguido, la respuesta vieja no pisa la nueva.
  const asked = useRef(0)
  const downloadHref = `/api/compras/insumos/planilla?slug=${encodeURIComponent(tenantSlug)}`

  function pick(next: File) {
    setFile(next)
    setPreview(null)
    setApplied(null)
    setError(null)
    setNotice(null)
    const ticket = ++asked.current
    startReading(async () => {
      const form = new FormData()
      form.set('file', next)
      try {
        const result = await previewItemsSheet(tenantSlug, form)
        if (ticket !== asked.current) return
        if (result.ok) setPreview(result.preview)
        else setError(result.message)
      } catch {
        // Sin conexión (o se cortó): que se pueda volver a elegir, sin tirar la pantalla.
        setError('No pudimos subir la planilla. Revisá la conexión y elegila de nuevo.')
      }
    })
  }

  /** Lo que es una zona nueva: se vuelve a pedir la vista previa con esa elección. */
  function chooseZone(key: string, choice: ZoneChoice) {
    if (!file || !preview) return
    const choices = { ...choicesOf(preview), [key]: choice }
    setError(null)
    setNotice(null)
    const ticket = ++asked.current
    startRefreshing(async () => {
      const form = new FormData()
      form.set('file', file)
      form.set('zones', JSON.stringify(choices))
      try {
        const result = await previewItemsSheet(tenantSlug, form)
        if (ticket !== asked.current) return
        if (result.ok) setPreview(result.preview)
        else setError(result.message)
      } catch {
        setError('No pudimos actualizar la vista previa. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setApplied(null)
    setError(null)
    setNotice(null)
  }

  function apply() {
    if (!file || !preview) return
    setError(null)
    setNotice(null)
    startApplying(async () => {
      const form = new FormData()
      form.set('file', file)
      form.set('fingerprint', preview.fingerprint)
      form.set('zones', JSON.stringify(choicesOf(preview)))
      let result: ItemsSheetApplyState
      try {
        result = await applyItemsSheet(tenantSlug, form)
      } catch {
        // Puede haberse guardado antes de cortarse: subirla de nuevo muestra lo que falta (o que no falta nada).
        setError(
          'Se cortó la conexión y no sabemos si llegó a guardarse. Subí la planilla de nuevo para ver qué falta.',
        )
        return
      }
      if (!result.ok) {
        if (result.preview) {
          setPreview(result.preview)
          setNotice(result.message)
        } else {
          setError(result.message)
        }
        return
      }
      setApplied(result)
      setPreview(null)
      toast.success('Insumos actualizados.')
    })
  }

  if (applied) {
    return <AppliedSummary applied={applied} tenantSlug={tenantSlug} onAgain={reset} />
  }

  return (
    <div className="space-y-6">
      {!preview ? (
        <ol className="card-hairline divide-y rounded-xl border bg-card">
          <Step n={1} title="Bajá la planilla">
            <p className="text-sm text-muted-foreground text-pretty">
              {itemCount > 0
                ? `Trae los ${plural(itemCount, 'insumo', 'insumos')} con su código, zona, unidad, objetivo, presentación y proveedor.`
                : 'Todavía no hay insumos: baja vacía, con los títulos y las listas para elegir.'}
            </p>
            <Button asChild variant="outline" className="h-11 gap-2 self-start md:h-10">
              <a href={downloadHref} download>
                <Download className="size-4" aria-hidden />
                Bajar la planilla
              </a>
            </Button>
          </Step>
          <Step n={2} title="Cambiala en Excel o en Google Sheets">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-pretty">
              <li>
                Cambiá lo que necesites: <strong>objetivo</strong>, <strong>presentación</strong>,
                cuánto trae cada una, <strong>proveedor</strong>, zona, unidad o frecuencia.
              </li>
              <li>
                Para agregar un insumo, sumá una fila con el <strong>nombre</strong> y la{' '}
                <strong>unidad</strong>.
              </li>
              <li>
                Para que uno deje de contarse, poné <strong>«No» en Activo</strong>. Borrar la fila
                no lo saca de HUB: queda como está.
              </li>
              <li>
                Zona, Proveedor, Frecuencia y Activo se eligen de una lista. Un proveedor nuevo se
                carga antes en{' '}
                <Link
                  href={`/${tenantSlug}/compras/proveedores`}
                  className="font-medium underline underline-offset-2 hover:text-foreground"
                >
                  Proveedores
                </Link>
                .
              </li>
              <li>
                Una <strong>zona nueva</strong> se puede escribir en la planilla: al subirla te
                preguntamos si es nueva, si es una que ya está o si le cambiaste el nombre.
              </li>
            </ul>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground pointer-coarse:py-2">
                ¿Con Google Sheets?
              </summary>
              <p className="mt-2 text-pretty text-muted-foreground">
                Subí el archivo a tu Drive y abrilo con Hojas de cálculo de Google. Cuando termines,
                bajalo con Archivo › Descargar › Microsoft Excel (.xlsx) y subí ese.
              </p>
            </details>
          </Step>
          <Step n={3} title="Subila">
            <FileDropZone
              accept=".xlsx,.csv,.txt"
              title="Soltá acá la planilla"
              touchTitle="Elegí la planilla"
              hint="Excel (.xlsx) o CSV. Antes de guardar te mostramos qué cambia."
              art={<FileSpreadsheet className="size-9 text-primary" aria-hidden />}
              disabled={reading}
              onFile={pick}
            />
          </Step>
        </ol>
      ) : null}

      <div aria-live="polite" className="empty:hidden">
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
        {notice ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-text"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {notice}
          </p>
        ) : null}
      </div>

      {preview ? (
        <PreviewView
          preview={preview}
          applying={applying}
          refreshing={refreshing}
          onApply={apply}
          onReset={reset}
          onChooseZone={chooseZone}
        />
      ) : null}
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 px-4 py-5 sm:px-5">
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-full bg-primary/10 font-serif text-base font-semibold text-primary tabular-nums"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="pt-1 font-serif text-lg leading-tight font-semibold tracking-tight">
          <span className="sr-only">Paso {n}: </span>
          {title}
        </h2>
        {children}
      </div>
    </li>
  )
}

function PreviewView({
  preview,
  applying,
  refreshing,
  onApply,
  onReset,
  onChooseZone,
}: {
  preview: ItemsSheetPreview
  applying: boolean
  refreshing: boolean
  onApply: () => void
  onReset: () => void
  onChooseZone: (key: string, choice: ZoneChoice) => void
}) {
  if (preview.noColumns) {
    return (
      <div className="space-y-4">
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive text-pretty"
        >
          No encontramos la fila de títulos en «{preview.fileName}». Tiene que tener al menos la
          columna «Insumo» (o «Código») y alguna más, como «Objetivo» o «Proveedor». Lo más fácil:
          bajá la planilla de HUB y cambiá esa.
        </p>
        <Button type="button" variant="outline" className="h-11 gap-2 md:h-10" onClick={onReset}>
          <RotateCcw className="size-4" aria-hidden />
          Elegir otro archivo
        </Button>
      </div>
    )
  }

  const changes = preview.updates.length + preview.creates.length + zoneWritesOf(preview)
  const summary = [
    preview.updates.length ? plural(preview.updates.length, 'cambia', 'cambian') : null,
    preview.creates.length ? plural(preview.creates.length, 'se agrega', 'se agregan') : null,
    preview.newZones.length
      ? plural(preview.newZones.length, 'zona nueva en la planilla', 'zonas nuevas en la planilla')
      : null,
    preview.problems.length
      ? plural(preview.problems.length, 'fila con problemas', 'filas con problemas')
      : null,
    preview.same ? plural(preview.same, 'queda igual', 'quedan igual') : null,
  ].filter(Boolean)

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="truncate text-sm text-muted-foreground">
          {preview.fileName} · {plural(preview.rows, 'fila', 'filas')}
        </p>
        <p className="font-serif text-xl font-semibold tracking-tight text-balance">
          {summary.length > 0 ? summary.join(' · ') : 'La planilla no trae insumos.'}
        </p>
        {preview.missing.length > 0 ? (
          <p className="text-sm text-muted-foreground text-pretty">
            {preview.missing.length === 1
              ? `No vino la columna ${preview.missing[0]}: eso queda como está en HUB.`
              : `No vinieron las columnas ${listText(preview.missing)}: eso queda como está en HUB.`}
          </p>
        ) : null}
      </div>

      {preview.newZones.length > 0 ? (
        <NewZonesGroup
          zones={preview.newZones}
          options={preview.zoneOptions}
          busy={refreshing || applying}
          onChoose={onChooseZone}
        />
      ) : null}

      {preview.updates.length > 0 ? (
        <Group title="Cambian" tone="info">
          {preview.updates.map((u) => (
            <li key={u.key} className="grid gap-1 py-3">
              <span className="font-medium text-pretty">{u.label}</span>
              <ul className="grid gap-0.5 text-sm">
                {u.changes.map((change) => (
                  <li
                    key={change}
                    className={cn(
                      'text-pretty',
                      change.startsWith('Se desactiva')
                        ? 'font-medium text-warning-text'
                        : 'text-muted-foreground',
                    )}
                  >
                    {change}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </Group>
      ) : null}

      {preview.creates.length > 0 ? (
        <Group title="Se agregan" tone="success">
          {preview.creates.map((c) => (
            <li key={c.key} className="grid gap-0.5 py-3">
              <span className="font-medium text-pretty">{c.label}</span>
              <span className="text-sm text-muted-foreground text-pretty">{c.detail}</span>
            </li>
          ))}
        </Group>
      ) : null}

      {preview.problems.length > 0 ? (
        <Group
          title="Con problemas (no se cargan)"
          tone="danger"
          note="Corregilas en la planilla y subila de nuevo, o cambialas a mano en Insumos."
        >
          {preview.problems.map((p) => (
            <li key={p.key} className="grid gap-0.5 py-3">
              <span className="font-medium text-pretty">
                <span className="text-muted-foreground tabular-nums">Fila {p.line} · </span>
                {p.label}
              </span>
              {p.reasons.map((reason) => (
                <span key={reason} className="text-sm text-destructive text-pretty">
                  {reason}
                </span>
              ))}
            </li>
          ))}
        </Group>
      ) : null}

      {preview.notInSheet > 0 ? (
        <p className="text-sm text-muted-foreground text-pretty">
          {preview.notInSheet === 1
            ? '1 insumo de HUB no está en la planilla: queda como está.'
            : `${preview.notInSheet.toLocaleString('es-AR')} insumos de HUB no están en la planilla: quedan como están.`}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button
          type="button"
          className="h-11 gap-2 md:h-10"
          onClick={onApply}
          disabled={applying || refreshing || changes === 0}
        >
          {applying || refreshing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          {applying
            ? 'Guardando…'
            : refreshing
              ? 'Actualizando…'
              : changes === 0
                ? 'No hay cambios para guardar'
                : `Guardar ${plural(changes, 'cambio', 'cambios')}`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 gap-2 md:h-10"
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

type ZoneOption = ItemsSheetPreview['zoneOptions'][number]

/**
 * Las zonas que la planilla trae y HUB no tiene (Tomás las cambia desde el Excel). De cada una: cuántos insumos
 * lleva, dónde están hoy y qué es, con lo que va a pasar escrito abajo.
 */
function NewZonesGroup({
  zones,
  options,
  busy,
  onChoose,
}: {
  zones: ItemsSheetNewZone[]
  options: ZoneOption[]
  busy: boolean
  onChoose: (key: string, choice: ZoneChoice) => void
}) {
  // A una zona de HUB se le cambia el nombre una sola vez: la que ya lo cambia otra no se ofrece para eso.
  const renamedBy = new Map(
    zones.flatMap((z) => (z.choice.kind === 'rename' ? [[z.choice.zoneId, z.key] as const] : [])),
  )
  return (
    <section
      aria-labelledby="pur-new-zones"
      aria-busy={busy}
      className="card-hairline rounded-xl border border-warning/50 bg-card px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="warning" id="pur-new-zones">
          {zones.length === 1 ? 'Zona nueva' : 'Zonas nuevas'}
        </Badge>
        <p className="text-xs text-muted-foreground text-pretty">
          La planilla trae {zones.length === 1 ? 'un lugar' : 'lugares'} que HUB no tiene. Decí qué
          es cada uno antes de guardar.
        </p>
      </div>
      <ul className="mt-1 divide-y">
        {zones.map((zone) => (
          <NewZoneRow
            key={zone.key}
            zone={zone}
            options={options}
            busy={busy}
            renamedBy={renamedBy}
            onChoose={(choice) => onChoose(zone.key, choice)}
          />
        ))}
      </ul>
    </section>
  )
}

const ZONE_KINDS: ReadonlyArray<{ kind: ZoneChoice['kind']; label: string }> = [
  { kind: 'create', label: 'Es nueva' },
  { kind: 'existing', label: 'Es una que ya está' },
  { kind: 'rename', label: 'Le cambié el nombre' },
]

function NewZoneRow({
  zone,
  options,
  busy,
  renamedBy,
  onChoose,
}: {
  zone: ItemsSheetNewZone
  options: ZoneOption[]
  busy: boolean
  renamedBy: ReadonlyMap<string, string>
  onChoose: (choice: ZoneChoice) => void
}) {
  const { choice } = zone
  // La zona de HUB que se ofrece: la elegida, o la que más se le parece, o la primera del recorrido.
  const targetId =
    choice.kind === 'create' ? (zone.similarId ?? options[0]?.id ?? null) : choice.zoneId
  const target = options.find((o) => o.id === targetId) ?? null
  const freeToRename = (id: string) => (renamedBy.get(id) ?? zone.key) === zone.key
  const choose = (kind: ZoneChoice['kind'], zoneId: string | null = targetId) => {
    if (kind === 'create') onChoose({ kind: 'create' })
    else if (zoneId) onChoose({ kind, zoneId })
  }
  const insumos = zone.count === 1 ? 'El insumo va' : `Los ${zone.count} insumos van`
  const consequence =
    choice.kind === 'create'
      ? 'Se arma al guardar, al final del recorrido. Después la acomodás en Zonas del recorrido.'
      : choice.kind === 'existing'
        ? `${insumos} a «${target?.name ?? 'esa zona'}», que queda con su nombre.`
        : `«${target?.name ?? 'Esa zona'}» pasa a llamarse «${zone.name}»${
            target?.items
              ? `, con ${target.items === 1 ? 'el insumo que tiene' : `los ${target.items} insumos que tiene`} hoy`
              : ''
          }.`
  const groupName = `pur-zone-${zone.key}`

  return (
    <li className="grid gap-2.5 py-3.5">
      <div className="grid gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold text-pretty">{zone.name}</span>
          <span className="text-sm text-muted-foreground tabular-nums">
            {plural(zone.count, 'insumo', 'insumos')}
          </span>
        </div>
        {zone.fromText ? (
          <p className="text-sm text-muted-foreground text-pretty">Hoy: {zone.fromText}</p>
        ) : null}
      </div>
      <fieldset disabled={busy} className="flex flex-wrap gap-2">
        <legend className="sr-only">¿Qué es «{zone.name}»?</legend>
        {ZONE_KINDS.map(({ kind, label }) => {
          const checked = choice.kind === kind
          const unavailable =
            kind !== 'create' && (!target || (kind === 'rename' && !freeToRename(target.id)))
          return (
            <label
              key={kind}
              className={cn(
                'inline-flex min-h-10 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 pointer-coarse:min-h-11',
                checked
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card hover:bg-muted',
                unavailable && 'cursor-not-allowed opacity-50 hover:bg-card',
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={kind}
                checked={checked}
                disabled={unavailable}
                onChange={() => choose(kind)}
                className="sr-only"
              />
              {label}
            </label>
          )
        })}
      </fieldset>
      {choice.kind !== 'create' ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {choice.kind === 'rename' ? '¿A cuál le cambiaste el nombre?' : '¿Cuál es?'}
          </span>
          <select
            value={targetId ?? ''}
            disabled={busy}
            onChange={(e) => choose(choice.kind, e.target.value)}
            className="h-10 min-w-0 max-w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground pointer-coarse:h-11"
          >
            {options.map((o) => (
              <option
                key={o.id}
                value={o.id}
                disabled={choice.kind === 'rename' && !freeToRename(o.id)}
              >
                {o.name} ({plural(o.items, 'insumo', 'insumos')})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p
        className={cn(
          'text-sm text-pretty',
          choice.kind === 'rename' ? 'font-medium text-warning-text' : 'text-foreground',
        )}
      >
        {consequence}
      </p>
    </li>
  )
}

const TONES = {
  success: 'success',
  info: 'info',
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
  note?: string
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
    applied.updated ? plural(applied.updated, 'insumo cambiado', 'insumos cambiados') : null,
    applied.created ? plural(applied.created, 'agregado', 'agregados') : null,
  ].filter(Boolean)
  return (
    <div className="space-y-5">
      <div className="card-hairline space-y-2 rounded-xl border bg-card p-5">
        <p className="flex items-center gap-2 font-serif text-xl font-semibold tracking-tight">
          <CheckCircle2 className="size-5 text-success" aria-hidden />
          Listo
        </p>
        <p className="text-sm text-pretty">
          {parts.length > 0 ? `${listText(parts as string[])}.` : 'No hubo nada para cambiar.'} La
          cocina ya cuenta con los datos nuevos y los próximos pedidos salen con ellos.
        </p>
        {applied.zonesCreated.length > 0 ? (
          <p className="text-sm text-pretty">
            {applied.zonesCreated.length === 1 ? 'Se armó la zona ' : 'Se armaron las zonas '}
            {listText(applied.zonesCreated.map((name) => `«${name}»`))}, al final del recorrido.
          </p>
        ) : null}
        {applied.zonesRenamed.map((r) => (
          <p key={r.to} className="text-sm text-pretty">
            «{r.from ?? 'La zona'}» ahora se llama «{r.to}».
          </p>
        ))}
        {applied.skipped > 0 ? (
          <p className="text-sm text-warning-text text-pretty">
            {applied.skipped === 1
              ? '1 fila con problemas no se cargó: corregila y subí la planilla de nuevo.'
              : `${applied.skipped} filas con problemas no se cargaron: corregilas y subí la planilla de nuevo.`}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {applied.zonesCreated.length > 0 ? (
          <Button asChild className="h-11 md:h-10">
            <Link href={`/${tenantSlug}/compras/insumos?zonas=1`}>Acomodar las zonas</Link>
          </Button>
        ) : null}
        <Button
          asChild
          variant={applied.zonesCreated.length > 0 ? 'outline' : 'default'}
          className="h-11 md:h-10"
        >
          <Link href={`/${tenantSlug}/compras/insumos`}>Ver los insumos</Link>
        </Button>
        <Button type="button" variant="ghost" className="h-11 gap-2 md:h-10" onClick={onAgain}>
          <RotateCcw className="size-4" aria-hidden />
          Subir otra planilla
        </Button>
      </div>
    </div>
  )
}
