'use client'

import { ArrowRight, FileCheck2, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Stepper } from '@/components/ui/stepper'
import {
  addImportItems,
  buildImportProposals,
  createImportBatch,
  saveImportLayout,
} from '@/lib/imports/actions'
import { type BankLayout, layoutToMapping } from '@/lib/imports/bank/statement'
import type { OpenedTable } from '@/lib/imports/detect'
import { sha256Hex } from '@/lib/imports/hash'
import type { DetectedSource } from '@/lib/imports/types'
import { findSavedLayout, type SavedLayout } from '@/lib/imports/ui/bank-mapping'
import { chunkByRowsAndBytes } from '@/lib/imports/ui/chunks'
import {
  IMPORT_SOURCE_COPY,
  importBatchHref,
  importSourceHref,
  type UiImportSource,
} from '@/lib/imports/ui/labels'
import { count, progressPercent, progressText } from '@/lib/imports/ui/progress'
import {
  openImportFile,
  type PlanResult,
  parseBankWith,
  planBank,
  planMercadoPago,
  planMisComprobantes,
  type UploadPlan,
  wrongPlace,
} from '@/lib/imports/ui/upload'
import { defaultInflateRaw } from '@/lib/imports/zip'
import { cn } from '@/lib/utils'
import { BankColumnMapper, type MapperPreview } from './bank-column-mapper'
import { FileDropZone } from './file-drop-zone'

/** Lo que cada pantalla le pasa al cargador (todo serializable, desde el servidor). */
export type UploaderContext =
  | { source: 'arca_recibidos'; sasCuit: string | null }
  | { source: 'mp_release'; sasCuit: string | null; ownCbus: string[]; cutoffHour: number }
  | { source: 'bank_statement'; treasuryAccountId: string; layouts: SavedLayout[] }

type LoadedFile = {
  name: string
  size: number
  sha: string
  table: OpenedTable
  detected: DetectedSource
}

type Job =
  | { kind: 'idle' }
  | { kind: 'running'; step: 'batch' | 'rows' | 'build'; done: number; total: number }
  | {
      kind: 'failed'
      message: string
      /** Lote ya creado (se reintenta desde la tanda que falló). */
      batchId: string | null
      nextChunk: number
      /** Las filas ya están: falló solo el armado. */
      buildOnly: boolean
    }
  | { kind: 'already'; message: string; batchId: string | null }
  | { kind: 'done'; batchId: string }

const UNREACHABLE = 'Sin conexión: no se pudo subir. Revisá internet y tocá «Reintentar».'

const DROP_COPY: Readonly<Record<UiImportSource, { title: string; hint: string; accept: string }>> =
  {
    arca_recibidos: {
      title: 'Soltá acá el ZIP de Mis Comprobantes',
      hint: 'El de «Recibidos», tal cual lo bajaste de ARCA (no lo abras con Excel). También sirve el CSV o el Excel. Hasta 20 MB.',
      accept: '.zip,.csv,.txt,.xlsx,.xls',
    },
    mp_release: {
      title: 'Soltá acá el reporte de Liquidaciones',
      hint: 'El CSV que te manda Mercado Pago por mail, sin abrirlo con Excel. Hasta 20 MB.',
      accept: '.csv,.txt,.zip,.xlsx',
    },
    bank_statement: {
      title: 'Soltá acá el extracto del banco',
      hint: 'Lo que exportás del home banking: CSV, TXT o Excel. Hasta 20 MB.',
      accept: '.csv,.txt,.xls,.xlsx,.html,.htm,.zip',
    },
  }

const STEPS = [
  { label: 'Elegí el archivo', description: 'Lo leemos en tu compu' },
  { label: 'Mirá lo que leímos', description: 'Antes de subir nada' },
  { label: 'Lo guardamos', description: 'Sin cargar los libros' },
  { label: 'Revisá y cargá', description: 'En la pantalla siguiente' },
]

function errorKey(detail: Record<string, unknown> | undefined): string | null {
  return typeof detail?.key === 'string' ? detail.key : null
}

/**
 * Subir un archivo (diseño §4.0): se lee y se reconoce en el navegador, se
 * muestra qué encontramos (período, filas, totales) y recién ahí se sube: el
 * lote, las filas en tandas (≤ 500 o ≤ 1 MB) con su barra de progreso, y el
 * armado de los comprobantes. Al terminar va a la revisión. Si se corta, se
 * retoma desde la tanda que faltó (reenviar no duplica), y si el archivo ya se
 * había subido, se sigue en ese lote o se ofrece abrirlo.
 */
export function ImportUploader({
  slug,
  context,
  blockedReason,
}: {
  slug: string
  context: UploaderContext
  /** Algo que falta antes de poder subir (la billetera, la cuenta del banco). */
  blockedReason?: string | null
}) {
  const router = useRouter()
  const live = useId()
  const summaryRef = useRef<HTMLHeadingElement | null>(null)
  const errorRef = useRef<HTMLDivElement | null>(null)
  const uploadingRef = useRef(false)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<{
    message: string
    goTo: UiImportSource | null
  } | null>(null)
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [bankLayout, setBankLayout] = useState<BankLayout | null>(null)
  const [job, setJob] = useState<Job>({ kind: 'idle' })
  const [announce, setAnnounce] = useState('')

  // El contexto llega del servidor en cada render: el plan se rehace solo si cambió de verdad.
  const contextKey = JSON.stringify(context)
  // biome-ignore lint/correctness/useExhaustiveDependencies: el contenido de `context` es `contextKey`
  const ctx = useMemo(() => context, [contextKey])
  const source = ctx.source
  const copy = IMPORT_SOURCE_COPY[source]
  const plan: PlanResult | null = useMemo(() => {
    if (!file) return null
    const info = { fileName: file.name, fileSize: file.size }
    switch (ctx.source) {
      case 'arca_recibidos':
        return planMisComprobantes(file.table, info, { sasCuit: ctx.sasCuit })
      case 'mp_release':
        return planMercadoPago(file.table, info, {
          sasCuit: ctx.sasCuit,
          ownCbus: ctx.ownCbus,
          cutoffHour: ctx.cutoffHour,
        })
      case 'bank_statement': {
        const layout =
          bankLayout ??
          findSavedLayout(file.table.rows, file.table.signatureDelimiter, ctx.layouts)?.layout ??
          null
        return planBank(file.table, info, { treasuryAccountId: ctx.treasuryAccountId, layout })
      }
    }
  }, [file, ctx, bankLayout])

  const running = job.kind === 'running'

  // No perder una subida a medias por cerrar la pestaña sin querer.
  useEffect(() => {
    if (!running) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [running])

  // Foco y aviso para lectores cuando aparece el resumen o un error.
  const planOk = plan?.ok === true
  useEffect(() => {
    if (planOk) summaryRef.current?.focus()
  }, [planOk])
  useEffect(() => {
    if (readError || job.kind === 'failed' || job.kind === 'already') errorRef.current?.focus()
  }, [readError, job.kind])

  const reset = () => {
    setFile(null)
    setBankLayout(null)
    setReadError(null)
    setJob({ kind: 'idle' })
    setAnnounce('')
  }

  const onFile = async (picked: File) => {
    reset()
    setReading(true)
    setAnnounce(`Leyendo ${picked.name}…`)
    try {
      // Que se vea «Leyendo…» antes de que el parser ocupe el hilo.
      await new Promise((resolve) => setTimeout(resolve, 0))
      const bytes = new Uint8Array(await picked.arrayBuffer())
      const opened = await openImportFile({
        bytes,
        fileName: picked.name,
        inflateRaw: defaultInflateRaw,
      })
      if (!opened.ok) {
        setReadError({ message: opened.message, goTo: null })
        setAnnounce(opened.message)
        return
      }
      const wrong = wrongPlace(source, opened.detected)
      if (wrong) {
        setReadError(wrong)
        setAnnounce(wrong.message)
        return
      }
      const sha = await sha256Hex(bytes)
      setFile({
        name: picked.name,
        size: picked.size,
        sha,
        table: opened.table,
        detected: opened.detected,
      })
      setAnnounce('Listo: revisá lo que encontramos.')
    } catch {
      const message = 'No pudimos leer el archivo. Probá de nuevo o bajalo otra vez.'
      setReadError({ message, goTo: null })
      setAnnounce(message)
    } finally {
      setReading(false)
    }
  }

  /** Sube el plan: lote → filas en tandas → armado. Se puede retomar. */
  const upload = async (
    p: UploadPlan,
    from: { batchId: string | null; chunk: number; buildOnly: boolean },
  ) => {
    // Un doble toque no arranca dos subidas a la vez.
    if (uploadingRef.current) return
    uploadingRef.current = true
    try {
      await uploadOnce(p, from)
    } finally {
      uploadingRef.current = false
    }
  }

  const uploadOnce = async (
    p: UploadPlan,
    from: { batchId: string | null; chunk: number; buildOnly: boolean },
  ) => {
    const chunks = chunkByRowsAndBytes(p.rows)
    const total = p.rows.length
    let batchId = from.batchId
    let at = from.buildOnly ? chunks.length : Math.min(Math.max(0, from.chunk), chunks.length)
    let done = chunks.slice(0, at).reduce((acc, c) => acc + c.length, 0)
    const fail = (message: string, buildOnly: boolean) => {
      setJob({ kind: 'failed', message, batchId, nextChunk: at, buildOnly })
      setAnnounce(message)
    }
    try {
      if (!batchId) {
        setJob({ kind: 'running', step: 'batch', done: 0, total })
        setAnnounce('Creando la importación…')
        const created = await createImportBatch(slug, {
          source: p.source,
          fileName: p.fileName,
          fileSha256: file?.sha ?? '',
          fileSize: p.fileSize,
          detectedFormat: p.detectedFormat,
          periodFrom: p.periodFrom,
          periodTo: p.periodTo,
          treasuryAccountId: ctx.source === 'bank_statement' ? ctx.treasuryAccountId : null,
          meta: p.meta,
        })
        if (created.ok) {
          batchId = created.data.batchId
        } else if (errorKey(created.detail) === 'import_file_already') {
          const existing =
            typeof created.detail?.batch_id === 'string' ? created.detail.batch_id : null
          if (created.detail?.resumable === true && existing) {
            toast.info('Este archivo había quedado a medio subir: seguimos desde ahí.')
            batchId = existing
          } else {
            setJob({ kind: 'already', message: created.message, batchId: existing })
            setAnnounce(created.message)
            return
          }
        } else {
          fail(created.message, false)
          return
        }
      }
      for (; at < chunks.length; at++) {
        const chunk = chunks[at] ?? []
        setJob({ kind: 'running', step: 'rows', done, total })
        // Para lectores, un aviso por tanda (no por cada número de la barra).
        setAnnounce(progressText('Guardando filas:', done, total))
        const added = await addImportItems(slug, { batchId, items: chunk })
        if (!added.ok) {
          fail(added.message, false)
          return
        }
        done += chunk.length
      }
      setJob({ kind: 'running', step: 'build', done: total, total })
      setAnnounce('Armando los comprobantes…')
      const built = await buildImportProposals(slug, { batchId })
      if (!built.ok) {
        fail(built.message, true)
        return
      }
      setJob({ kind: 'done', batchId })
      setAnnounce('Listo: abriendo la revisión.')
      toast.success('Listo: ya podés revisarlo.')
      router.push(importBatchHref(slug, batchId))
    } catch {
      fail(UNREACHABLE, batchId !== null && at >= chunks.length)
    }
  }

  // «Contanos qué es cada columna»: cómo se lee con lo elegido (sin subir nada).
  const bankContext = ctx.source === 'bank_statement' ? ctx : null
  const previewMapping = useCallback(
    (layout: BankLayout): MapperPreview => {
      if (!file || !bankContext) return { ok: false, message: 'Elegí el archivo de nuevo.' }
      const parsed = parseBankWith(file.table, {
        treasuryAccountId: bankContext.treasuryAccountId,
        layout,
      })
      if (!parsed.ok || parsed.items.length === 0) {
        return {
          ok: false,
          message:
            'Con esas columnas no encontramos movimientos. Revisá la fecha, la descripción y el importe.',
        }
      }
      return {
        ok: true,
        count: parsed.items.length,
        items: parsed.items.slice(0, 5).map((r) => ({
          date: r.item.date,
          description: r.item.description,
          amount: r.item.amount,
        })),
      }
    },
    [file, bankContext],
  )

  const confirmMapping = async (layout: BankLayout) => {
    setBankLayout(layout)
    if (!file || !bankContext) return
    const parsed = parseBankWith(file.table, {
      treasuryAccountId: bankContext.treasuryAccountId,
      layout,
    })
    if (!parsed.ok || !parsed.layout || !parsed.layoutSignature) return
    try {
      const saved = await saveImportLayout(slug, {
        signature: parsed.layoutSignature,
        mapping: layoutToMapping(parsed.layout),
        treasuryAccountId: bankContext.treasuryAccountId,
      })
      if (saved.ok) toast.success(saved.message)
      else toast.error(`No pudimos guardar el formato (igual podés importar): ${saved.message}`)
    } catch {
      toast.error('No pudimos guardar el formato: igual podés importar este archivo.')
    }
  }

  const step =
    job.kind === 'done' ? 3 : job.kind === 'running' || job.kind === 'failed' ? 2 : file ? 1 : 0

  const busy = reading || running || job.kind === 'done'

  return (
    <div className="space-y-5">
      <Stepper steps={STEPS} current={step} />
      <p className="-mt-2 text-sm font-medium sm:hidden">
        Paso {step + 1} de {STEPS.length}: {STEPS[step]?.label}
      </p>
      <p id={live} aria-live="polite" className="sr-only">
        {announce}
      </p>

      {blockedReason ? (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="text-warning-text">{blockedReason}</p>
        </div>
      ) : null}

      {!file || readError ? (
        <FileDropZone
          accept={DROP_COPY[source].accept}
          title={reading ? 'Leyendo el archivo…' : DROP_COPY[source].title}
          hint={DROP_COPY[source].hint}
          disabled={busy || Boolean(blockedReason)}
          onFile={(f) => void onFile(f)}
        />
      ) : null}

      {readError ? (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive outline-none sm:flex-row sm:items-center"
        >
          <p className="flex-1 text-pretty">{readError.message}</p>
          {readError.goTo ? (
            <Button asChild variant="outline" className="h-11 shrink-0 gap-2 md:h-9">
              <Link href={importSourceHref(slug, readError.goTo)}>
                Ir a {IMPORT_SOURCE_COPY[readError.goTo].title}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {file && plan && 'needsMapping' in plan && plan.needsMapping && job.kind === 'idle' ? (
        <BankColumnMapper
          rows={file.table.rows}
          candidateHeaderRow={plan.candidateHeaderRow}
          preview={previewMapping}
          onConfirm={(layout) => void confirmMapping(layout)}
          onCancel={reset}
        />
      ) : null}

      {file && plan && !plan.ok && 'message' in plan && job.kind === 'idle' ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive sm:flex-row sm:items-center"
        >
          <p className="flex-1 text-pretty">{plan.message}</p>
          <Button type="button" variant="outline" className="h-11 shrink-0 md:h-9" onClick={reset}>
            Elegir otro archivo
          </Button>
        </div>
      ) : null}

      {file && plan?.ok ? (
        <PlanSummary
          plan={plan.plan}
          headingRef={summaryRef}
          disabled={busy || Boolean(blockedReason) || job.kind !== 'idle'}
          onUpload={() => void upload(plan.plan, { batchId: null, chunk: 0, buildOnly: false })}
          onReset={reset}
          showActions={job.kind === 'idle'}
          unitMany={copy.unit[1]}
        />
      ) : null}

      {job.kind === 'running' ? (
        <section
          aria-label="Subiendo el archivo"
          className="card-hairline space-y-3 rounded-xl border bg-card p-5"
        >
          <p className="font-medium">
            {job.step === 'batch'
              ? 'Creando la importación…'
              : job.step === 'rows'
                ? progressText('Guardando filas:', job.done, job.total)
                : 'Armando los comprobantes con tus proveedores y cuentas…'}
          </p>
          <Progress
            value={
              job.step === 'batch'
                ? 2
                : job.step === 'build'
                  ? 100
                  : progressPercent(job.done, job.total)
            }
            aria-label="Progreso de la subida"
          />
          <p className="text-xs text-muted-foreground">
            No cierres esta pestaña hasta que termine. Todavía no se carga nada en los libros.
          </p>
        </section>
      ) : null}

      {job.kind === 'failed' && file && plan?.ok ? (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive outline-none sm:flex-row sm:items-center"
        >
          <p className="flex-1 text-pretty">{job.message}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 md:h-9"
              onClick={() =>
                void upload(plan.plan, {
                  batchId: job.batchId,
                  chunk: Math.max(0, job.nextChunk),
                  buildOnly: job.buildOnly,
                })
              }
            >
              <RotateCcw className="size-4" aria-hidden />
              Reintentar
            </Button>
            {job.batchId ? (
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={importBatchHref(slug, job.batchId)}>Ir a la revisión</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {job.kind === 'already' ? (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm outline-none sm:flex-row sm:items-center"
        >
          <p className="flex-1 text-pretty">{job.message}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {job.batchId ? (
              <Button asChild className="h-11 gap-2 md:h-9">
                <Link href={importBatchHref(slug, job.batchId)}>
                  Ver esa importación
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="h-11 md:h-9" onClick={reset}>
              Elegir otro archivo
            </Button>
          </div>
        </div>
      ) : null}

      {job.kind === 'done' ? (
        <div className="flex flex-col gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm sm:flex-row sm:items-center">
          <p className="flex-1">Listo: estamos abriendo la revisión…</p>
          <Button asChild variant="outline" className="h-11 md:h-9">
            <Link href={importBatchHref(slug, job.batchId)}>Abrir la revisión</Link>
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** «Esto encontramos»: lo que se va a subir, antes de mandar nada. */
function PlanSummary({
  plan,
  headingRef,
  disabled,
  showActions,
  onUpload,
  onReset,
  unitMany,
}: {
  plan: UploadPlan
  headingRef: RefObject<HTMLHeadingElement | null>
  disabled: boolean
  showActions: boolean
  onUpload: () => void
  onReset: () => void
  unitMany: string
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="card-hairline rounded-xl border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-success/30 bg-success/10 text-success">
            <FileCheck2 className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2
              id={titleId}
              ref={headingRef}
              tabIndex={-1}
              className="font-serif text-lg font-semibold tracking-tight outline-none"
            >
              Encontramos {plan.title}
            </h2>
            <p className="truncate text-xs text-muted-foreground" title={plan.fileName}>
              {plan.fileName}
            </p>
          </div>
        </div>
      </header>
      <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2">
        {plan.facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {fact.label}
            </dt>
            <dd
              className={cn(
                'text-sm text-pretty',
                fact.tone === 'warning' ? 'text-warning-text' : 'text-foreground',
              )}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
      {plan.rowErrors.length > 0 || plan.notices.length > 0 ? (
        <div className="space-y-2 border-t border-border/60 px-5 py-4 text-sm">
          {plan.notices.map((n) => (
            <p key={n} className="text-muted-foreground">
              {n}
            </p>
          ))}
          {plan.rowErrors.length > 0 ? (
            <details className="group">
              <summary className="cursor-pointer text-warning-text marker:text-warning">
                {count(plan.rowErrors.length, 'fila no se pudo leer', 'filas no se pudieron leer')}{' '}
                y {plan.rowErrors.length === 1 ? 'queda' : 'quedan'} afuera. Ver cuáles
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {plan.rowErrors.slice(0, 50).map((e, i) => (
                  <li key={`${i.toString()}-${e}`}>{e}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {showActions ? (
        <footer className="flex flex-col gap-3 border-t border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground text-pretty">
            Todavía no se carga nada en los libros: primero vas a revisar cada uno.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onReset}>
              Elegir otro archivo
            </Button>
            <Button
              type="button"
              className="h-11 gap-2 md:h-9"
              disabled={disabled}
              onClick={onUpload}
            >
              Subir {plan.rows.length === 1 ? 'y revisar' : `los ${plan.rows.length} ${unitMany}`}
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        </footer>
      ) : null}
    </section>
  )
}
