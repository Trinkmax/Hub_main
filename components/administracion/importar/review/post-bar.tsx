'use client'

import { Pause, Play, Upload } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import {
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import type { WarningKey } from '@/lib/accounting/types'
import { formatMonthYear } from '@/lib/dates'
import { postImportProposals } from '@/lib/imports/actions'
import { fetchPostQueue } from '@/lib/imports/review-actions'
import type { PostQueueItem } from '@/lib/imports/server/review'
import { type BatchAcceptableWarning, isBatchAcceptable } from '@/lib/imports/server/types'
import { chunkList, POST_CHUNK_SIZE } from '@/lib/imports/ui/chunks'
import { BATCH_WARNING_TEXT, importBatchHref, importHref } from '@/lib/imports/ui/labels'
import {
  count,
  emptyTally,
  type PostTally,
  progressPercent,
  progressText,
  tallyResults,
  tallySummary,
} from '@/lib/imports/ui/progress'
import { formatCents, formatCentsShort } from '@/lib/money'
import { OFFLINE_TEXT, useReview } from './review-context'

type Phase =
  | { kind: 'summary' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'paused'; done: number; total: number; message: string | null }
  | { kind: 'done'; tally: PostTally }

type MonthRow = { month: string; count: number; totalCents: number }

/** «Cargar 1 compra» / «Cargar 18 compras». */
function loadLabel(n: number, unit: readonly [string, string]): string {
  return `Cargar ${n === 1 ? `1 ${unit[0]}` : `${n} ${unit[1]}`}`
}

/** Título y bajada del diálogo en cada momento. */
const HEADER: Readonly<
  Record<
    Phase['kind'],
    { title: (n: number, unit: readonly [string, string]) => string; description: string }
  >
> = {
  summary: {
    title: (n) => (n === 1 ? '¿Cargamos este?' : `¿Cargamos estos ${n}?`),
    description: 'Cada uno se puede anular después desde su comprobante. No hay «deshacer todo».',
  },
  running: {
    title: loadLabel,
    description: 'Dejá esta pestaña abierta hasta que termine.',
  },
  paused: {
    title: loadLabel,
    description: 'Lo que ya se cargó quedó registrado. Seguí cuando quieras.',
  },
  done: { title: () => 'Listo', description: 'Esto es lo que pasó con cada uno.' },
}

/**
 * «Cargar N comprobantes»: la barra de abajo con lo que está listo y, al
 * tocarla, el papel «Vas a cargar» (cuántos, de qué meses y, en las compras,
 * cuánta plata) con los avisos que se leen una sola vez. Después carga de a 15
 * con su barra («Cargando 45 de 142…»); se puede pausar y seguir, y lo ya
 * cargado nunca se duplica. Al terminar, el mismo papel con el sello «CARGADO».
 *
 * La mecánica es la de siempre (`fetchPostQueue` + `postImportProposals` de a
 * 15, con pausa, doble toque protegido y aviso al cerrar la pestaña). En el
 * banco y en Mercado Pago no se muestra importe: sumar lo que entró con lo que
 * salió no dice nada.
 */
export function PostBar({
  readyCount,
  readyCents,
  months,
  movedToOpenMonth,
  warnings,
  unit,
  showMoney,
  pendingAnswers,
}: {
  readyCount: number
  readyCents: number
  months: MonthRow[]
  movedToOpenMonth: number
  warnings: Partial<Record<WarningKey, number>>
  unit: readonly [string, string]
  /** Solo las compras de ARCA suman un importe que significa algo. */
  showMoney: boolean
  /** Preguntas o proveedores sin contestar: el botón queda en contorno (lo primario es la respuesta). */
  pendingAnswers: number
}) {
  const { slug, batchId, editable } = useReview()
  const ackId = useId()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'summary' })
  const [accepted, setAccepted] = useState(false)
  const stopRef = useRef(false)
  const runningRef = useRef(false)
  const queueRef = useRef<{ chunks: PostQueueItem[][]; next: number; tally: PostTally } | null>(
    null,
  )
  // Lo que se iba a cargar al abrir el diálogo: al terminar, la página ya no lo trae como «listo».
  const [snapshot, setSnapshot] = useState<{ months: MonthRow[]; cents: number; n: number } | null>(
    null,
  )

  const batchWarnings = (Object.entries(warnings) as Array<[WarningKey, number]>).filter(
    (entry): entry is [BatchAcceptableWarning, number] =>
      isBatchAcceptable(entry[0]) && entry[1] > 0,
  )
  const needsAck = batchWarnings.length > 0
  const running = phase.kind === 'running'

  // Cargando: no perder la tanda en curso por cerrar la pestaña sin querer.
  useEffect(() => {
    if (!running) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [running])

  if (!editable) return null
  if (readyCount === 0 && !open) return null

  const run = async (resume: boolean) => {
    // Un doble toque no arranca dos cargas a la vez.
    if (runningRef.current) return
    runningRef.current = true
    try {
      await runOnce(resume)
    } finally {
      runningRef.current = false
    }
  }

  const runOnce = async (resume: boolean) => {
    stopRef.current = false
    let queue = resume ? queueRef.current : null
    if (!queue) {
      setPhase({ kind: 'running', done: 0, total: readyCount })
      try {
        const fetched = await fetchPostQueue(slug, { batchId })
        if (!fetched.ok) {
          setPhase({ kind: 'paused', done: 0, total: readyCount, message: fetched.message })
          return
        }
        if (fetched.data.items.length === 0) {
          setPhase({ kind: 'done', tally: emptyTally() })
          return
        }
        queue = {
          chunks: chunkList(fetched.data.items, POST_CHUNK_SIZE),
          next: 0,
          tally: emptyTally(),
        }
        queueRef.current = queue
      } catch {
        setPhase({ kind: 'paused', done: 0, total: readyCount, message: OFFLINE_TEXT })
        return
      }
    }
    const total = queue.chunks.reduce((acc, c) => acc + c.length, 0)
    const acceptWarnings = accepted ? batchWarnings.map(([k]) => k) : []
    for (; queue.next < queue.chunks.length; queue.next++) {
      const done = queue.chunks.slice(0, queue.next).reduce((acc, c) => acc + c.length, 0)
      if (stopRef.current) {
        setPhase({ kind: 'paused', done, total, message: null })
        return
      }
      setPhase({ kind: 'running', done, total })
      const chunk = queue.chunks[queue.next] ?? []
      try {
        const result = await postImportProposals(slug, {
          batchId,
          items: chunk.map((i) => ({ key: i.key, previewHash: i.previewHash })),
          acceptWarnings,
        })
        if (!result.ok) {
          setPhase({ kind: 'paused', done, total, message: result.message })
          return
        }
        queue.tally = tallyResults(queue.tally, result.data.results)
      } catch {
        setPhase({ kind: 'paused', done, total, message: OFFLINE_TEXT })
        return
      }
    }
    setPhase({ kind: 'done', tally: queue.tally })
    queueRef.current = null
  }

  const openDialog = () => {
    setSnapshot({ months, cents: readyCents, n: readyCount })
    setOpen(true)
  }

  const close = () => {
    if (running) return
    setOpen(false)
    setPhase({ kind: 'summary' })
    queueRef.current = null
  }

  const many = unit[1]
  const tally = phase.kind === 'done' ? phase.tally : null
  const leftForReview = tally ? tally.stale + tally.needsInput + tally.failed : 0
  const shown = snapshot ?? { months, cents: readyCents, n: readyCount }
  // El detalle por mes y el total son de lo que se IBA a cargar: al terminar se muestran solo si
  // entró todo. Si alguno quedó en el camino, el papel dice cuántos se cargaron y nada más (un
  // total que incluye lo que no entró sería un número falso).
  const allIn = tally !== null && tally.posted === shown.n
  const ticket = (stamped: boolean) => (
    <Ticket className="mx-auto w-full max-w-sm" aria-label="Lo que se carga">
      <TicketHeader
        title={stamped ? 'Cargaste' : 'Vas a cargar'}
        subtitle={count(stamped && tally ? tally.posted : shown.n, unit[0], many)}
      >
        {stamped && tally && tally.posted > 0 ? (
          <TicketStamp tone="ok" animate>
            Cargado
          </TicketStamp>
        ) : null}
      </TicketHeader>
      {(!stamped || allIn) && shown.months.length > 0 ? (
        <>
          <TicketRule />
          {shown.months.map((m) => (
            <TicketRow
              key={m.month}
              label={`De ${formatMonthYear(m.month)}`}
              hint={showMoney ? count(m.count, unit[0], many) : undefined}
              value={showMoney ? formatCents(m.totalCents) : String(m.count)}
            />
          ))}
        </>
      ) : null}
      {showMoney && (!stamped || allIn) ? (
        <>
          <TicketRule double />
          <TicketTotal label="Total" value={formatCents(shown.cents)} />
        </>
      ) : null}
      {movedToOpenMonth > 0 && !stamped ? (
        <TicketNote>
          {movedToOpenMonth === 1 ? '1 es' : `${movedToOpenMonth} son`} de un mes que ya cerraste:{' '}
          {movedToOpenMonth === 1 ? 'queda' : 'quedan'} con fecha del primer día abierto.
        </TicketNote>
      ) : null}
    </Ticket>
  )

  return (
    <>
      <div
        id="cargar"
        className="sticky bottom-0 z-30 -mx-4 scroll-mt-28 border-t border-border/60 bg-background/95 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-6 sm:px-6 lg:mx-0 lg:rounded-2xl lg:border lg:px-5 lg:pb-2.5 lg:shadow-md"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <span className="font-medium">{count(readyCount, 'listo', 'listos')}</span>
            {showMoney ? (
              <span className="text-muted-foreground"> · {formatCentsShort(readyCents)}</span>
            ) : null}
          </p>
          <Button
            type="button"
            variant={pendingAnswers > 0 ? 'outline' : 'default'}
            className="h-12 w-full gap-2 px-5 text-base sm:w-auto"
            disabled={readyCount === 0}
            onClick={openDialog}
          >
            <Upload className="size-4" aria-hidden />
            {pendingAnswers > 0
              ? readyCount === 1
                ? 'Cargar el que ya está'
                : `Cargar los ${readyCount} que ya están`
              : loadLabel(readyCount, unit)}
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(next) => (next ? openDialog() : close())}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
          showCloseButton={!running}
          onEscapeKeyDown={(e) => running && e.preventDefault()}
          onInteractOutside={(e) => running && e.preventDefault()}
        >
          {/* Sin `id` propio: Radix une el título con el diálogo (con uno propio avisaba en la
              consola que faltaba el título). */}
          <DialogHeader>
            <DialogTitle>
              {HEADER[phase.kind].title(
                phase.kind === 'running' || phase.kind === 'paused' ? phase.total : shown.n,
                unit,
              )}
            </DialogTitle>
            <DialogDescription>{HEADER[phase.kind].description}</DialogDescription>
          </DialogHeader>

          {phase.kind === 'summary' ? (
            <div className="space-y-4 text-sm">
              {ticket(false)}
              {needsAck ? (
                <div className="space-y-2 rounded-xl bg-warning/10 p-3.5">
                  <p className="font-medium text-warning-text">Leé esto una sola vez</p>
                  <ul className="space-y-1.5">
                    {batchWarnings.map(([key, n]) => (
                      <li key={key} className="text-pretty">
                        <span className="font-medium">{count(n, unit[0], many)}:</span>{' '}
                        {BATCH_WARNING_TEXT[key]}
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-start gap-2.5 pt-1">
                    <Checkbox
                      id={ackId}
                      checked={accepted}
                      onCheckedChange={(v) => setAccepted(v === true)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={ackId} className="font-normal leading-snug">
                      Lo leí: cargalos igual
                    </Label>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {phase.kind === 'running' || phase.kind === 'paused' ? (
            <div className="space-y-3" role="status" aria-live="polite">
              <p className="font-medium">
                {phase.kind === 'running'
                  ? progressText('Cargando', phase.done, phase.total)
                  : `En pausa: ${phase.done} de ${phase.total} listos.`}
              </p>
              <Progress
                value={progressPercent(phase.done, phase.total)}
                aria-label="Progreso de la carga"
              />
              {phase.kind === 'paused' && phase.message ? (
                <p role="alert" className="text-sm text-destructive">
                  {phase.message}
                </p>
              ) : null}
              {phase.kind === 'running' ? (
                <p className="text-xs text-muted-foreground">
                  Van de a {POST_CHUNK_SIZE}. Si pausás o se corta, lo ya cargado queda y seguís
                  desde ahí.
                </p>
              ) : null}
            </div>
          ) : null}

          {tally ? (
            <div className="space-y-4 text-sm" role="status" aria-live="polite">
              {ticket(true)}
              <p className="text-center text-pretty">{tallySummary(tally, unit)}</p>
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            {phase.kind === 'summary' ? (
              <>
                <Button type="button" variant="outline" className="h-11" onClick={close}>
                  Volver
                </Button>
                <Button
                  type="button"
                  className="h-11 gap-2"
                  disabled={needsAck && !accepted}
                  onClick={() => void run(false)}
                >
                  <Upload className="size-4" aria-hidden />
                  {loadLabel(shown.n, unit)}
                </Button>
              </>
            ) : null}
            {phase.kind === 'running' ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2"
                onClick={() => {
                  stopRef.current = true
                }}
              >
                <Pause className="size-4" aria-hidden />
                Pausar
              </Button>
            ) : null}
            {phase.kind === 'paused' ? (
              <>
                <Button type="button" variant="outline" className="h-11" onClick={close}>
                  Cerrar
                </Button>
                <Button type="button" className="h-11 gap-2" onClick={() => void run(true)}>
                  <Play className="size-4" aria-hidden />
                  Seguir
                </Button>
              </>
            ) : null}
            {phase.kind === 'done' ? (
              <>
                {leftForReview > 0 ? (
                  <Button asChild variant="outline" className="h-11">
                    <Link href={importBatchHref(slug, batchId, { ver: 'revisar' })} onClick={close}>
                      Ver lo que quedó para revisar
                    </Link>
                  </Button>
                ) : null}
                <Button asChild variant="outline" className="h-11">
                  <Link href={importHref(slug)}>Volver a Importar</Link>
                </Button>
                <Button type="button" className="h-11" onClick={close}>
                  Cerrar
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
