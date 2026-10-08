'use client'

import { CheckCircle2, Pause, Play, Upload } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { Amount } from '@/components/administracion/amount'
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
import { formatMonthLabel } from '@/lib/dates'
import { postImportProposals } from '@/lib/imports/actions'
import { fetchPostQueue } from '@/lib/imports/review-actions'
import type { PostQueueItem } from '@/lib/imports/server/review'
import { type BatchAcceptableWarning, isBatchAcceptable } from '@/lib/imports/server/types'
import { chunkList, POST_CHUNK_SIZE } from '@/lib/imports/ui/chunks'
import { BATCH_WARNING_TEXT, importBatchHref } from '@/lib/imports/ui/labels'
import {
  count,
  emptyTally,
  type PostTally,
  progressPercent,
  progressText,
  tallyResults,
  tallySummary,
} from '@/lib/imports/ui/progress'
import { formatCents } from '@/lib/money'
import { OFFLINE_TEXT, useReview } from './review-context'

type Phase =
  | { kind: 'summary' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'paused'; done: number; total: number; message: string | null }
  | { kind: 'done'; tally: PostTally }

/**
 * «Cargar N comprobantes» (diseño §4.0 «Confirmar en tandas»): la barra de
 * abajo con lo que está listo y, al tocarla, el resumen previo (cuántos, cuánta
 * plata, en qué meses del libro y los avisos que se aceptan una sola vez para
 * todo el lote). Después carga de a 15 con su barra («Cargando 45 de 142…»); se
 * puede pausar y seguir, y lo ya cargado nunca se duplica.
 */
export function PostBar({
  readyCount,
  readyCents,
  months,
  movedToOpenMonth,
  warnings,
  unit,
}: {
  readyCount: number
  readyCents: number
  months: Array<{ month: string; count: number; totalCents: number }>
  movedToOpenMonth: number
  warnings: Partial<Record<WarningKey, number>>
  unit: readonly [string, string]
}) {
  const { slug, batchId, editable } = useReview()
  const titleId = useId()
  const ackId = useId()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'summary' })
  const [accepted, setAccepted] = useState(false)
  const stopRef = useRef(false)
  const runningRef = useRef(false)
  const queueRef = useRef<{ chunks: PostQueueItem[][]; next: number; tally: PostTally } | null>(
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

  const close = () => {
    if (running) return
    setOpen(false)
    setPhase({ kind: 'summary' })
    queueRef.current = null
  }

  const many = unit[1]
  const tally = phase.kind === 'done' ? phase.tally : null
  const leftForReview = tally ? tally.stale + tally.needsInput + tally.failed : 0

  return (
    <>
      <div className="sticky bottom-0 z-30 -mx-4 border-t border-border/60 bg-background/95 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:mx-0 lg:rounded-xl lg:border lg:px-5 lg:pb-2.5 lg:shadow-md">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <span className="font-medium">{count(readyCount, 'listo', 'listos')} para cargar</span>{' '}
            <span className="text-muted-foreground">
              · <Amount cents={readyCents} decimals={0} />
            </span>
          </p>
          <Button
            type="button"
            className="h-11 w-full gap-2 sm:w-auto"
            disabled={readyCount === 0}
            onClick={() => setOpen(true)}
          >
            <Upload className="size-4" aria-hidden />
            Cargar {readyCount === 1 ? `1 ${unit[0]}` : `${readyCount} ${many}`}
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
          showCloseButton={!running}
          onEscapeKeyDown={(e) => running && e.preventDefault()}
          onInteractOutside={(e) => running && e.preventDefault()}
          aria-labelledby={titleId}
        >
          <DialogHeader>
            <DialogTitle id={titleId}>
              {phase.kind === 'done' ? 'Listo' : 'Antes de cargar'}
            </DialogTitle>
            <DialogDescription>
              {phase.kind === 'done'
                ? 'Esto es lo que pasó con cada uno.'
                : 'Revisá el resumen. Cada uno se puede anular después desde su comprobante.'}
            </DialogDescription>
          </DialogHeader>

          {phase.kind === 'summary' ? (
            <div className="space-y-4 text-sm">
              <p>
                Vas a cargar <strong>{count(readyCount, unit[0], many)}</strong> por{' '}
                <strong>{formatCents(readyCents)}</strong>.
              </p>
              {months.length > 0 ? (
                <ul className="space-y-1 rounded-lg border border-border/70 p-3">
                  {months.map((m) => (
                    <li key={m.month} className="flex items-baseline justify-between gap-3">
                      <span>Libro de {formatMonthLabel(m.month)}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {m.count} · {formatCents(m.totalCents, { decimals: 0 })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {movedToOpenMonth > 0 ? (
                <p className="rounded-lg border border-info/30 bg-info/10 p-3 text-pretty">
                  {count(movedToOpenMonth, 'es', 'son')} de un mes que ya cerraste: se cargan en el
                  primer día abierto (no cambian los libros cerrados).
                </p>
              ) : null}
              {needsAck ? (
                <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
                  <p className="font-medium text-warning-text">Avisos para leer una sola vez</p>
                  <ul className="space-y-1.5">
                    {batchWarnings.map(([key, n]) => (
                      <li key={key} className="text-pretty">
                        <span className="font-medium">{count(n, unit[0], many)}:</span>{' '}
                        {BATCH_WARNING_TEXT[key]}
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-start gap-2 pt-1">
                    <Checkbox
                      id={ackId}
                      checked={accepted}
                      onCheckedChange={(v) => setAccepted(v === true)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={ackId} className="font-normal leading-snug">
                      Los leí: cargarlos igual
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
            <div className="space-y-3 text-sm" role="status" aria-live="polite">
              <p className="flex items-start gap-2 text-pretty">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                {tallySummary(tally, unit)}
              </p>
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            {phase.kind === 'summary' ? (
              <>
                <Button type="button" variant="outline" className="h-11 md:h-9" onClick={close}>
                  Volver
                </Button>
                <Button
                  type="button"
                  className="h-11 gap-2 md:h-9"
                  disabled={needsAck && !accepted}
                  onClick={() => void run(false)}
                >
                  <Upload className="size-4" aria-hidden />
                  Cargar {readyCount === 1 ? `1 ${unit[0]}` : `${readyCount} ${many}`}
                </Button>
              </>
            ) : null}
            {phase.kind === 'running' ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 md:h-9"
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
                <Button type="button" variant="outline" className="h-11 md:h-9" onClick={close}>
                  Cerrar
                </Button>
                <Button type="button" className="h-11 gap-2 md:h-9" onClick={() => void run(true)}>
                  <Play className="size-4" aria-hidden />
                  Seguir
                </Button>
              </>
            ) : null}
            {phase.kind === 'done' ? (
              <>
                {leftForReview > 0 ? (
                  <Button asChild variant="outline" className="h-11 md:h-9">
                    <Link href={importBatchHref(slug, batchId, { ver: 'revisar' })} onClick={close}>
                      Ver lo que quedó para revisar
                    </Link>
                  </Button>
                ) : null}
                <Button type="button" className="h-11 md:h-9" onClick={close}>
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
