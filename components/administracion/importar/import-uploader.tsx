'use client'

import { ArrowRight, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { StepCard, StepRail, type StepRailItem } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import { formatDayMonth } from '@/lib/dates'
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
import { rowsBeforeStart, type WantedRange } from '@/lib/imports/ui/inbox'
import {
  IMPORT_SOURCE_COPY,
  importBatchHref,
  importHref,
  importSourceHref,
  type UiImportSource,
} from '@/lib/imports/ui/labels'
import { batchInput } from '@/lib/imports/ui/payloads'
import { count, progressText } from '@/lib/imports/ui/progress'
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
import { BankColumnMapper, type MapperPreview } from './bank-column-mapper'
import { FileDropZone } from './file-drop-zone'
import { SourceMark } from './inbox/source-mark'
import { ANSWER_BUTTON, QUIET_ANSWER, QuestionAnswers, QuestionCard } from './review/question-card'
import { ArrivalTicket } from './upload/arrival-ticket'
import { UploadProgress } from './upload/upload-progress'
import { WantRange } from './upload/want-range'

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
      title: 'Soltá acá el ZIP que bajaste de ARCA',
      hint: 'Tal cual vino, sin abrirlo con Excel. También sirve el CSV o el Excel. Hasta 20 MB.',
      accept: '.zip,.csv,.txt,.xlsx,.xls',
    },
    mp_release: {
      title: 'Soltá acá el reporte de Liquidaciones',
      hint: 'El .csv que te llegó por mail, sin abrirlo con Excel. Hasta 20 MB.',
      accept: '.csv,.txt,.zip,.xlsx',
    },
    bank_statement: {
      title: 'Soltá acá lo que exportaste del banco',
      hint: 'CSV, TXT o Excel. Hasta 20 MB.',
      accept: '.csv,.txt,.xls,.xlsx,.html,.htm,.zip',
    },
  }

const STEP_ONE_TITLE: Readonly<Record<UiImportSource, string>> = {
  arca_recibidos: 'Bajalo de ARCA',
  mp_release: 'Bajalo de Mercado Pago',
  bank_statement: 'Bajalo del home banking',
}

/** Solo en pantallas angostas: bajar el archivo es cosa de compu. */
const NARROW_NOTE: Readonly<Partial<Record<UiImportSource, string>>> = {
  arca_recibidos: 'Es más cómodo desde una compu: hay que entrar con clave fiscal.',
  mp_release: 'Mercado Pago no arma este reporte desde el celular: hacelo desde una compu.',
}

function errorKey(detail: Record<string, unknown> | undefined): string | null {
  return typeof detail?.key === 'string' ? detail.key : null
}

/**
 * Subir un archivo, en tres pasos a la vista: ① bajalo de allá (qué fechas
 * pedir y cómo se baja), ② subilo acá (se lee y se reconoce en el navegador, se
 * muestra el papel «Llegó esto» y recién ahí se sube) y ③ revisá y cargá (en la
 * pantalla siguiente). Es un asistente porque se hace una vez por semana o por
 * mes, y porque el paso 1 pasa en otra página.
 *
 * La subida es la de siempre: el lote, las filas en tandas (≤ 500 o ≤ 1 MB) con
 * su barra, y el armado. Si se corta, se retoma desde la tanda que faltó
 * (reenviar no duplica), y si el archivo ya se había subido, se sigue en ese
 * lote o se ofrece abrirlo. Lo que se manda no cambió (`batchInput`).
 */
export function ImportUploader({
  slug,
  context,
  blockedReason,
  howTo,
  wanted,
  firstTime,
  booksStartDate,
  account,
  notice,
  stepOneExtra,
}: {
  slug: string
  context: UploaderContext
  /** Algo que falta antes de poder subir (la billetera, la cuenta del banco). */
  blockedReason?: string | null
  /** El «cómo se baja» de este origen (los pasos y las maquetas del portal). */
  howTo: ReactNode
  /** Qué fechas pedir. */
  wanted: WantedRange
  /** Nunca se subió nada de este origen: el paso 1 arranca abierto. */
  firstTime: boolean
  /** La fecha de arranque del bar (para avisar lo que no se va a poder cargar). */
  booksStartDate: string | null
  /** Banco: «¿De qué cuenta es?», arriba de la ranura. */
  account?: ReactNode
  /** Un aviso calmo del paso 2 que no frena (ARCA sin el CUIT del bar). */
  notice?: ReactNode
  /** Algo más del paso 1 (Mercado Pago: completar el cierre con el mismo archivo). */
  stepOneExtra?: ReactNode
}) {
  const router = useRouter()
  const live = useId()
  const summaryRef = useRef<HTMLDivElement | null>(null)
  const errorRef = useRef<HTMLDivElement | null>(null)
  const uploadingRef = useRef(false)
  const [active, setActive] = useState<1 | 2>(firstTime ? 1 : 2)
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
  const readyPlan = plan?.ok === true ? plan.plan : null
  // Renglones del archivo con fecha anterior al arranque: esos no se van a poder cargar.
  const beforeStart = useMemo(
    () => (readyPlan ? rowsBeforeStart(source, readyPlan.rows, booksStartDate) : 0),
    [readyPlan, source, booksStartDate],
  )
  const allBeforeStart = readyPlan !== null && beforeStart >= readyPlan.rows.length

  // `#paso-1` en la URL abre siempre el «cómo se baja» (el link de las bandejas).
  useEffect(() => {
    const open = () => {
      if (window.location.hash === '#paso-1') setActive(1)
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])

  // No perder una subida a medias por cerrar la pestaña sin querer.
  useEffect(() => {
    if (!running) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [running])

  // Foco y aviso para lectores cuando aparece el papel o un error.
  const planOk = readyPlan !== null
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
      setAnnounce('Listo: mirá lo que llegó.')
    } catch {
      const message = 'No pude leer el archivo. Probá de nuevo o bajalo otra vez.'
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
        setAnnounce('Abriendo la carpeta de este archivo…')
        const created = await createImportBatch(
          slug,
          batchInput(p, file?.sha ?? '', {
            source: ctx.source,
            treasuryAccountId: ctx.source === 'bank_statement' ? ctx.treasuryAccountId : null,
          }),
        )
        if (created.ok) {
          batchId = created.data.batchId
        } else if (errorKey(created.detail) === 'import_file_already') {
          const existing =
            typeof created.detail?.batch_id === 'string' ? created.detail.batch_id : null
          if (created.detail?.resumable === true && existing) {
            toast.info('Este archivo había quedado a medio subir: sigo desde ahí.')
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
        setAnnounce(progressText('Guardando renglones:', done, total))
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

  // «Contame qué es cada columna»: cómo se lee con lo elegido (sin subir nada).
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
            'Con esas columnas no encuentro movimientos. Revisá la fecha, la descripción y el importe.',
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
      else toast.error(`No pude guardar el formato (igual podés subirlo): ${saved.message}`)
    } catch {
      toast.error('No pude guardar el formato: igual podés subir este archivo.')
    }
  }

  const busy = reading || running || job.kind === 'done'
  const finished = job.kind === 'done'
  const stepOne = finished || active === 2 ? 'done' : 'current'
  const stepTwo = finished ? 'done' : active === 2 ? 'current' : 'todo'
  const stepThree = finished ? 'current' : 'todo'
  const askedRange =
    wanted.from && wanted.to
      ? `Pedí del ${formatDayMonth(wanted.from)} al ${formatDayMonth(wanted.to)}`
      : 'Hoy no hay nada nuevo para pedir'
  const rail: StepRailItem[] = [
    { title: STEP_ONE_TITLE[source], state: stepOne, summary: askedRange },
    { title: 'Subilo acá', state: stepTwo, summary: file?.name },
    { title: 'Revisá y cargá', state: stepThree },
  ]
  const narrowNote = NARROW_NOTE[source]
  const uploadLabel = readyPlan
    ? readyPlan.rows.length === 1
      ? 'Subir y revisar'
      : `Subir y revisar los ${readyPlan.rows.length}`
    : ''
  const startUpload = () => {
    if (readyPlan) void upload(readyPlan, { batchId: null, chunk: 0, buildOnly: false })
  }
  const uploadDisabled = busy || Boolean(blockedReason) || job.kind !== 'idle'

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
      <StepRail
        steps={rail}
        label={`Pasos para ${copy.cta.charAt(0).toLowerCase()}${copy.cta.slice(1)}`}
        className="lg:sticky lg:top-20"
      />
      <div className="min-w-0 space-y-3">
        <p id={live} aria-live="polite" className="sr-only">
          {announce}
        </p>

        <StepCard
          n={1}
          id="paso-1"
          title={STEP_ONE_TITLE[source]}
          state={stepOne}
          summary={askedRange}
          action={
            // Mientras se lee o se sube no se ofrece: taparía el progreso del paso 2.
            stepOne === 'done' && !busy ? (
              <button type="button" className={QUIET_ANSWER} onClick={() => setActive(1)}>
                Ver cómo se baja
              </button>
            ) : null
          }
        >
          <div className="space-y-5">
            <WantRange wanted={wanted} />
            {narrowNote ? (
              <p className="rounded-xl bg-secondary/50 px-3.5 py-2.5 text-sm text-pretty lg:hidden">
                {narrowNote}
              </p>
            ) : null}
            {stepOneExtra}
            <div className="border-t border-border/60 pt-5">{howTo}</div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <Button
                type="button"
                className="h-12 w-full gap-2 px-5 text-base sm:w-auto"
                onClick={() => setActive(2)}
              >
                Ya lo tengo: seguir
                <ArrowRight aria-hidden className="size-4" />
              </Button>
              <Link href={importHref(slug)} className={QUIET_ANSWER}>
                Lo hago después
              </Link>
            </div>
          </div>
        </StepCard>

        <StepCard
          n={2}
          id="paso-2"
          title="Subilo acá"
          state={stepTwo}
          summary={finished ? 'Listo: ya se subió' : undefined}
          keepMounted={false}
        >
          <div className="space-y-4">
            {account}
            {notice}

            {blockedReason ? (
              <p className="rounded-xl bg-warning/10 px-3.5 py-2.5 text-sm text-warning-text text-pretty">
                {blockedReason}
              </p>
            ) : null}

            {!file || readError ? (
              <FileDropZone
                accept={DROP_COPY[source].accept}
                title={reading ? 'Leyendo el archivo…' : DROP_COPY[source].title}
                hint={DROP_COPY[source].hint}
                art={<SourceMark source={source} className="size-8" />}
                disabled={busy || Boolean(blockedReason)}
                onFile={(f) => void onFile(f)}
              />
            ) : null}

            {readError ? (
              <QuestionCard
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                tone="info"
                inset
                question={readError.message}
              >
                {readError.goTo ? (
                  <QuestionAnswers>
                    <Button asChild variant="outline" className={`${ANSWER_BUTTON} gap-2`}>
                      <Link href={importSourceHref(slug, readError.goTo)}>
                        Ir a {IMPORT_SOURCE_COPY[readError.goTo].short}
                        <ArrowRight className="size-4" aria-hidden />
                      </Link>
                    </Button>
                  </QuestionAnswers>
                ) : null}
              </QuestionCard>
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
              <QuestionCard role="alert" tone="info" inset question={plan.message}>
                <QuestionAnswers>
                  {'fix' in plan && plan.fix === 'sas_cuit' ? (
                    <Button asChild variant="outline" className={ANSWER_BUTTON}>
                      <Link href={`/${slug}/administracion/ajustes?tab=sas`}>
                        Ir a los datos del bar
                      </Link>
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" className={ANSWER_BUTTON} onClick={reset}>
                    Elegir otro archivo
                  </Button>
                </QuestionAnswers>
              </QuestionCard>
            ) : null}

            {file && readyPlan ? (
              <div className="space-y-4">
                <div ref={summaryRef} tabIndex={-1} className="outline-none">
                  <ArrivalTicket
                    plan={readyPlan}
                    beforeStart={beforeStart}
                    booksStartDate={booksStartDate}
                    className="mx-auto max-w-md"
                  />
                </div>
                {readyPlan.notices.length > 0 || readyPlan.rowErrors.length > 0 ? (
                  <div className="mx-auto max-w-md space-y-2 text-sm text-muted-foreground">
                    {readyPlan.notices.map((n) => (
                      <p key={n} className="text-pretty">
                        {n}
                      </p>
                    ))}
                    {readyPlan.rowErrors.length > 0 ? (
                      <details>
                        <summary className="cursor-pointer rounded-sm text-warning-text outline-none marker:text-warning focus-visible:ring-2 focus-visible:ring-ring">
                          {count(
                            readyPlan.rowErrors.length,
                            'renglón no se pudo leer',
                            'renglones no se pudieron leer',
                          )}{' '}
                          y no {readyPlan.rowErrors.length === 1 ? 'entra' : 'entran'}. Ver cuáles
                        </summary>
                        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                          {readyPlan.rowErrors.slice(0, 50).map((e, i) => (
                            <li key={`${i.toString()}-${e}`}>{e}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                ) : null}
                {job.kind === 'idle' ? (
                  <div className="mx-auto flex max-w-md flex-col items-stretch gap-2">
                    <p className="text-center text-sm text-muted-foreground">
                      Todavía no se carga nada: primero lo revisás.
                    </p>
                    {allBeforeStart ? (
                      <>
                        <Button type="button" className="h-12 text-base" onClick={reset}>
                          Elegir otro archivo
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11"
                          disabled={uploadDisabled}
                          onClick={startUpload}
                        >
                          Subirlo igual
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          className="h-12 gap-2 text-base"
                          disabled={uploadDisabled}
                          onClick={startUpload}
                        >
                          {uploadLabel}
                          <ArrowRight className="size-4" aria-hidden />
                        </Button>
                        <Button type="button" variant="outline" className="h-11" onClick={reset}>
                          Elegir otro archivo
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {job.kind === 'running' ? (
              <UploadProgress source={source} step={job.step} done={job.done} total={job.total} />
            ) : null}

            {job.kind === 'failed' && readyPlan ? (
              <QuestionCard
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                tone="info"
                inset
                question={job.message}
              >
                <QuestionAnswers>
                  <Button
                    type="button"
                    className={`${ANSWER_BUTTON} gap-2`}
                    onClick={() =>
                      void upload(readyPlan, {
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
                    <Button asChild variant="outline" className={ANSWER_BUTTON}>
                      <Link href={importBatchHref(slug, job.batchId)}>
                        Ir a revisar lo que llegó
                      </Link>
                    </Button>
                  ) : null}
                </QuestionAnswers>
              </QuestionCard>
            ) : null}

            {job.kind === 'already' ? (
              <QuestionCard
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                tone="info"
                inset
                question={job.message}
              >
                <QuestionAnswers>
                  {job.batchId ? (
                    <Button asChild className={`${ANSWER_BUTTON} gap-2`}>
                      <Link href={importBatchHref(slug, job.batchId)}>
                        Abrir esa revisión
                        <ArrowRight className="size-4" aria-hidden />
                      </Link>
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" className={ANSWER_BUTTON} onClick={reset}>
                    Elegir otro archivo
                  </Button>
                </QuestionAnswers>
              </QuestionCard>
            ) : null}
          </div>
        </StepCard>

        <StepCard n={3} id="paso-3" title="Revisá y cargá" state={stepThree}>
          {job.kind === 'done' ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="flex-1 text-sm">Listo: abriendo la revisión…</p>
              <Button asChild variant="outline" className="h-11">
                <Link href={importBatchHref(slug, job.batchId)}>Abrir la revisión</Link>
              </Button>
            </div>
          ) : null}
        </StepCard>
        {stepThree === 'todo' ? (
          <p className="px-1 text-sm text-muted-foreground text-pretty">
            Te muestro cada comprobante antes de cargar nada. Lo que no sepa, te lo pregunto.
          </p>
        ) : null}
      </div>
    </div>
  )
}
