'use client'

import { Check, PencilLine, Plus, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { plural } from '@/components/administracion/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DataTableBody,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRoot,
  DataTableScroll,
  DataTableShell,
} from '@/components/ui/data-table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type SlidingTab, SlidingTabs } from '@/components/ui/sliding-tabs'
import { StatCard } from '@/components/ui/stat-card'
import { Textarea } from '@/components/ui/textarea'
import { ACC_UNREACHABLE } from '@/lib/accounting/action-state'
import { importAccounts } from '@/lib/accounting/actions/master'
import {
  type ChartImportRow,
  type PastedChartLineError,
  parsePastedChart,
} from '@/lib/accounting/chart'
import { CHART_IMPORT_MAX_ROWS } from '@/lib/accounting/schemas'
import { ACCOUNT_TYPES, type AccountType } from '@/lib/accounting/types'
import { cn } from '@/lib/utils'
import { Callout, Field } from '../../../ajustes/_components/form-bits'
import { failureKey } from '../../_lib/feedback'
import {
  buildImportPreview,
  type ImportPreview,
  type ImportPreviewKind,
  type ImportPreviewRow,
  pastedRootCodes,
} from '../../_lib/import-preview'
import { ACCOUNT_TYPE_NAMES } from '../../_lib/tree'

type PreviewFilter = 'all' | 'new' | 'changed' | 'error'

/** Más que esto no se dibuja de una (los filtros acotan). */
const RENDER_LIMIT = 300

const PLACEHOLDER = [
  '1.0.00.00.000 ACTIVO',
  '1.1.00.00.000 ACTIVO CORRIENTE',
  '1.1.01.01.000 CAJA Y BANCOS',
  '1.1.01.01.001 CAJA',
].join('\n')

const KIND_BADGE: Readonly<Record<ImportPreviewKind, string>> = {
  new: 'border-success/30 bg-success/10 text-success',
  changed: 'border-warning/40 bg-warning/10 text-warning-text',
  same: '',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
}

function StatusBadge({ row }: { row: ImportPreviewRow }) {
  if (row.kind === 'same') return <Badge variant="muted">{row.status}</Badge>
  return (
    <Badge variant="outline" className={cn('font-normal', KIND_BADGE[row.kind])}>
      {row.status}
    </Badge>
  )
}

type Reviewed = { text: string; rows: ChartImportRow[]; lineErrors: PastedChartLineError[] }

/**
 * «Importar plan» (#16): pegar → `parsePastedChart` → ensayo en la base (`acc_import_accounts` con
 * `p_dry_run`) → la vista previa (nuevas, las que cambian y qué, sin cambios, errores por línea, con
 * el grupo inferido y el tipo) → «Importar» lo hace de verdad, todo o nada. Las cuentas principales
 * nuevas piden su tipo acá mismo.
 */
export function ImportForm({
  tenantSlug,
  plan,
}: {
  tenantSlug: string
  /** El plan de hoy (código y nombre), para nombrar los grupos inferidos. */
  plan: ReadonlyArray<{ code: string; name: string }>
}) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [busyAction, setBusyAction] = useState<'review' | 'import' | null>(null)
  const planNames = useMemo(() => new Map(plan.map((a) => [a.code, a.name])), [plan])
  const [text, setText] = useState('')
  const [reviewed, setReviewed] = useState<Reviewed | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [rootTypes, setRootTypes] = useState<Record<string, AccountType>>({})
  const [filter, setFilter] = useState<PreviewFilter>('all')
  const [message, setMessage] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const stale = reviewed !== null && reviewed.text !== text

  /** Las filas para la base; el tipo elegido, solo en las que quedan como cuentas principales. */
  const toInput = (rows: readonly ChartImportRow[], types: Record<string, AccountType>) => {
    const roots = pastedRootCodes(rows, planNames.keys())
    return rows.map((r) => {
      const type = roots.has(r.code) ? types[r.code] : undefined
      return { code: r.code, name: r.name, ...(type ? { type } : {}) }
    })
  }

  /** El ensayo en la base. `notice`: un aviso que queda arriba (p. ej., por qué se volvió a revisar). */
  const review = (source: string, types: Record<string, AccountType>, notice?: string) => {
    const parsed = parsePastedChart(source)
    setMessage(notice ?? null)
    if (parsed.rows.length === 0) {
      setReviewed({ text: source, rows: [], lineErrors: parsed.errors })
      setPreview(null)
      setMessage(
        parsed.errors.length > 0
          ? 'No pudimos leer ninguna cuenta: revisá los renglones de abajo.'
          : 'No encontramos cuentas. Pegá una por renglón, con el código y el nombre («1.1.01.01.001 CAJA»).',
      )
      textRef.current?.focus()
      return
    }
    if (parsed.rows.length > CHART_IMPORT_MAX_ROWS) {
      setMessage(
        `Pegaste ${plural(parsed.rows.length, 'cuenta', 'cuentas')}: se pueden importar hasta 2000 por vez. Partí la lista en tandas.`,
      )
      return
    }
    setBusyAction('review')
    startTransition(async () => {
      try {
        const result = await importAccounts(tenantSlug, {
          rows: toInput(parsed.rows, types),
          dryRun: true,
        })
        if (!result.ok) {
          setMessage(result.message)
          return
        }
        const next = buildImportPreview(result.data, planNames)
        setReviewed({ text: source, rows: parsed.rows, lineErrors: parsed.errors })
        setPreview(next)
        setFilter((current) =>
          next.counts.errors > 0 ? 'error' : current === 'error' ? 'all' : current,
        )
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      } finally {
        setBusyAction(null)
      }
    })
  }

  const doImport = () => {
    if (!reviewed || !preview?.canImport || stale || busy) return
    setMessage(null)
    setBusyAction('import')
    startTransition(async () => {
      try {
        const result = await importAccounts(tenantSlug, {
          rows: toInput(reviewed.rows, rootTypes),
          dryRun: false,
        })
        if (!result.ok) {
          // El plan cambió entre el ensayo y ahora (otra persona): se vuelve a revisar y se ve qué falla.
          if (failureKey(result) === 'import_has_errors') {
            const notice =
              'No se importó nada: el plan cambió mientras tanto y ahora hay líneas con errores.'
            toast.error(notice)
            review(reviewed.text, rootTypes, notice)
          } else {
            toast.error(result.message)
            setMessage(result.message)
          }
          return
        }
        toast.success(result.message)
        router.push(`/${tenantSlug}/administracion/plan-de-cuentas`)
      } catch {
        toast.error(ACC_UNREACHABLE.offline)
      } finally {
        setBusyAction(null)
      }
    })
  }

  const setRootType = (code: string, type: AccountType) => {
    const next = { ...rootTypes, [code]: type }
    setRootTypes(next)
    if (reviewed && !stale) review(reviewed.text, next)
  }

  const lineErrors = reviewed && !stale ? reviewed.lineErrors : []
  const shown = preview
    ? preview.rows.filter(
        (r) =>
          filter === 'all' ||
          (filter === 'new' && r.kind === 'new') ||
          (filter === 'changed' && r.kind === 'changed') ||
          (filter === 'error' && r.kind === 'error'),
      )
    : []
  const visible = shown.slice(0, RENDER_LIMIT)
  const changes = preview ? preview.counts.creates + preview.counts.updates : 0

  const filterTabs: SlidingTab<PreviewFilter>[] = preview
    ? [
        { value: 'all', label: `Todas · ${preview.counts.total}` },
        { value: 'new', label: `Nuevas · ${preview.counts.creates}` },
        { value: 'changed', label: `Cambian · ${preview.counts.updates}` },
        { value: 'error', label: `Con errores · ${preview.counts.errors}` },
      ]
    : []

  const typeSelect = (row: ImportPreviewRow, className?: string) => (
    <Select
      value={rootTypes[row.code] ?? row.type ?? ''}
      onValueChange={(v) => setRootType(row.code, v as AccountType)}
      disabled={busy || stale}
    >
      <SelectTrigger
        className={cn('w-full data-[size=default]:h-11 md:data-[size=default]:h-9', className)}
        aria-label={`Tipo de ${row.code} ${row.name}`}
        aria-invalid={row.error === 'import_type_required' ? true : undefined}
      >
        <SelectValue placeholder="Elegí el tipo" />
      </SelectTrigger>
      <SelectContent>
        {ACCOUNT_TYPES.map((t) => (
          <SelectItem key={t} value={t}>
            {ACCOUNT_TYPE_NAMES[t]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const groupText = (row: ImportPreviewRow) =>
    row.parentCode ? (
      <>
        <span className="font-mono text-xs text-muted-foreground">{row.parentCode}</span>
        {row.parentName ? ` ${row.parentName}` : ''}
      </>
    ) : row.kind === 'error' && row.error !== 'import_type_required' ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <span className="text-muted-foreground">Cuenta principal</span>
    )

  const typeText = (row: ImportPreviewRow) =>
    row.type ? (
      <>
        {ACCOUNT_TYPE_NAMES[row.type]}
        {row.postable === false ? <span className="text-muted-foreground"> · grupo</span> : null}
      </>
    ) : (
      <span className="text-muted-foreground">—</span>
    )

  const nameBlock = (row: ImportPreviewRow) => (
    <div className="min-w-0 space-y-1">
      <p className="text-sm font-medium text-pretty">{row.name}</p>
      {row.systemLabel || row.isTreasury ? (
        <div className="flex flex-wrap gap-1">
          {row.systemLabel ? (
            <Badge variant="outline" className="max-w-full whitespace-normal text-left font-normal">
              Usada por el sistema: {row.systemLabel}
            </Badge>
          ) : null}
          {row.isTreasury ? (
            <Badge variant="outline" className="font-normal">
              Caja o banco
            </Badge>
          ) : null}
        </div>
      ) : null}
      {row.details.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {row.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
      {row.error ? <p className="text-xs text-destructive text-pretty">{row.error}</p> : null}
    </div>
  )

  return (
    <div className="space-y-6">
      <section className="card-hairline rounded-xl border bg-card" aria-labelledby="imp-paste">
        <header className="border-b border-border/60 px-5 py-4">
          <h2 id="imp-paste" className="font-serif text-lg font-semibold tracking-tight">
            Pegá el plan
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">
            El grupo de cada cuenta sale del código:{' '}
            <span className="font-mono">1.1.01.01.001</span> va adentro de{' '}
            <span className="font-mono">1.1.01.01.000</span>. Los códigos que ya existen se
            actualizan; los nuevos se crean.
          </p>
        </header>
        <div className="grid gap-4 p-5">
          <Field
            id="imp-text"
            label="Las cuentas, una por renglón"
            hint="El código y el nombre («1.1.01.01.001 CAJA»). Sirve copiar de un PDF, de Excel (dos columnas) o del sistema anterior: los títulos, las fechas y los renglones sin código se saltean."
          >
            <Textarea
              ref={textRef}
              id="imp-text"
              value={text}
              rows={10}
              spellCheck={false}
              autoComplete="off"
              placeholder={PLACEHOLDER}
              aria-describedby="imp-text-hint"
              onChange={(e) => setText(e.target.value)}
              className="max-h-[50vh] min-h-48 font-mono text-base md:text-sm"
            />
          </Field>

          {lineErrors.length > 0 ? (
            <Callout
              tone="warning"
              title={`${plural(lineErrors.length, 'renglón no se pudo leer', 'renglones no se pudieron leer')}:`}
            >
              <ul className="space-y-0.5">
                {lineErrors.slice(0, 20).map((e) => (
                  <li key={e.line}>
                    Renglón {e.line} («{e.raw.trim().slice(0, 60)}»): {e.message}
                  </li>
                ))}
                {lineErrors.length > 20 ? <li>…y {lineErrors.length - 20} más.</li> : null}
              </ul>
            </Callout>
          ) : null}

          {message ? <Callout tone="error">{message}</Callout> : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {text ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 md:h-9"
                disabled={busy}
                onClick={() => {
                  setText('')
                  setReviewed(null)
                  setPreview(null)
                  setRootTypes({})
                  setMessage(null)
                  textRef.current?.focus()
                }}
              >
                Empezar de nuevo
              </Button>
            ) : null}
            <Button
              type="button"
              variant={preview && !stale ? 'outline' : 'default'}
              className="h-11 min-w-[160px] md:h-9"
              disabled={busy || text.trim() === ''}
              onClick={() => review(text, rootTypes)}
            >
              {busyAction === 'review' ? 'Revisando…' : preview ? 'Revisar de nuevo' : 'Revisar'}
            </Button>
          </div>
        </div>
      </section>

      {preview ? (
        <section className="space-y-4" aria-labelledby="imp-preview">
          <div className="space-y-1">
            <h2 id="imp-preview" className="font-serif text-lg font-semibold tracking-tight">
              Lo que va a pasar
            </h2>
            <p className="text-sm text-muted-foreground text-pretty">
              Todavía no se guardó nada. Nunca se borra ni se desactiva una cuenta.
            </p>
          </div>

          {stale ? (
            <Callout tone="warning" title="Cambiaste el texto.">
              Tocá «Revisar de nuevo» antes de importar.
            </Callout>
          ) : null}

          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard icon={Plus} label="Nuevas" value={String(preview.counts.creates)} />
            <StatCard icon={PencilLine} label="Cambian" value={String(preview.counts.updates)} />
            <StatCard icon={Check} label="Sin cambios" value={String(preview.counts.unchanged)} />
            <StatCard
              icon={TriangleAlert}
              iconClassName={preview.counts.errors > 0 ? 'text-destructive' : undefined}
              label="Con errores"
              value={String(preview.counts.errors)}
            />
          </div>

          {preview.missingTypes > 0 ? (
            <Callout tone="warning" title="Falta el tipo de las cuentas principales nuevas.">
              {preview.missingTypes === 1
                ? 'Hay una cuenta principal nueva: elegí su tipo (activo, pasivo, patrimonio neto, ingreso o egreso) en la columna «Grupo».'
                : `Hay ${preview.missingTypes} cuentas principales nuevas: elegí el tipo de cada una en la columna «Grupo».`}{' '}
              Las que van adentro toman ese tipo.
            </Callout>
          ) : null}

          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
            <SlidingTabs tabs={filterTabs} value={filter} onChange={setFilter} size="sm" />
          </div>

          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground">
              {filter === 'error'
                ? 'No hay líneas con errores.'
                : filter === 'new'
                  ? 'No hay cuentas nuevas.'
                  : filter === 'changed'
                    ? 'Ninguna cuenta cambia.'
                    : 'No hay líneas.'}
            </p>
          ) : (
            <DataTableShell>
              <div className="hidden md:block">
                <DataTableScroll>
                  <DataTableRoot>
                    <DataTableHead>
                      <tr>
                        <DataTableHeader className="w-16">Línea</DataTableHeader>
                        <DataTableHeader>Código</DataTableHeader>
                        <DataTableHeader>Cuenta</DataTableHeader>
                        <DataTableHeader>Qué pasa</DataTableHeader>
                        <DataTableHeader>Grupo</DataTableHeader>
                        <DataTableHeader>Tipo</DataTableHeader>
                      </tr>
                    </DataTableHead>
                    <DataTableBody>
                      {visible.map((row) => (
                        <tr
                          key={row.row}
                          className={cn(
                            'align-top transition-colors hover:bg-cream-tint',
                            row.kind === 'error' && 'bg-destructive/5',
                          )}
                        >
                          <DataTableCell className="py-2.5 align-top text-xs text-muted-foreground tabular-nums">
                            {row.row}
                          </DataTableCell>
                          <DataTableCell className="whitespace-nowrap py-2.5 align-top font-mono text-xs tabular-nums">
                            {row.code}
                          </DataTableCell>
                          <DataTableCell className="py-2.5 align-top">
                            {nameBlock(row)}
                          </DataTableCell>
                          <DataTableCell className="py-2.5 align-top">
                            <StatusBadge row={row} />
                          </DataTableCell>
                          <DataTableCell className="min-w-48 py-2.5 align-top text-sm">
                            {row.rootNeedsType ? typeSelect(row, 'max-w-48') : groupText(row)}
                          </DataTableCell>
                          <DataTableCell className="whitespace-nowrap py-2.5 align-top text-sm">
                            {typeText(row)}
                          </DataTableCell>
                        </tr>
                      ))}
                    </DataTableBody>
                  </DataTableRoot>
                </DataTableScroll>
              </div>
              <ul className="divide-y divide-border/60 md:hidden">
                {visible.map((row) => (
                  <li
                    key={row.row}
                    className={cn(
                      'space-y-2 px-4 py-3',
                      row.kind === 'error' && 'bg-destructive/5',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs tabular-nums">
                        <span className="text-muted-foreground">#{row.row} · </span>
                        {row.code}
                      </span>
                      <StatusBadge row={row} />
                    </div>
                    {nameBlock(row)}
                    <div className="grid gap-1 text-xs">
                      {row.rootNeedsType ? (
                        typeSelect(row)
                      ) : (
                        <p>
                          <span className="text-muted-foreground">Grupo: </span>
                          {groupText(row)}
                        </p>
                      )}
                      {row.type ? (
                        <p>
                          <span className="text-muted-foreground">Tipo: </span>
                          {typeText(row)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {shown.length > visible.length ? (
                <DataTableFooter>
                  Mostrando {visible.length} de {shown.length}: usá los filtros para ver el resto.
                </DataTableFooter>
              ) : null}
            </DataTableShell>
          )}
        </section>
      ) : null}

      {preview ? (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-border/60 bg-background/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-xl sm:border sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-pretty" role="status">
              {stale
                ? 'Revisá de nuevo para importar lo que pegaste.'
                : preview.counts.errors > 0
                  ? `Corregí ${preview.counts.errors === 1 ? 'la línea con error' : `las ${preview.counts.errors} líneas con error`} y revisá de nuevo.`
                  : changes === 0
                    ? 'No hay nada para cambiar: el plan ya está así.'
                    : `Se ${preview.counts.creates === 1 ? 'crea 1 cuenta' : `crean ${preview.counts.creates} cuentas`} y se ${
                        preview.counts.updates === 1
                          ? 'actualiza 1'
                          : `actualizan ${preview.counts.updates}`
                      }. No se borra nada.`}
            </p>
            <Button
              type="button"
              className="h-11 min-w-[200px] md:h-9"
              disabled={busy || stale || !preview.canImport}
              onClick={doImport}
            >
              {busyAction === 'import'
                ? 'Importando…'
                : changes === 1
                  ? 'Importar 1 cuenta'
                  : `Importar ${changes} cuentas`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
