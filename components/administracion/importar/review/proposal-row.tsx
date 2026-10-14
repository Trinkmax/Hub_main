'use client'

import { ArrowRight, RotateCcw, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { loadPartyItems } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-actions'
import { Amount } from '@/components/administracion/amount'
import { EntryPreview, type EntryPreviewData } from '@/components/administracion/entry-preview'
import { LedgerRail, LedgerRow } from '@/components/administracion/kit'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { OpenItemRef } from '@/lib/accounting/types'
import { formatIsoDay, isRealIsoDay, MONTH_NAMES_SHORT } from '@/lib/dates'
import { postImportProposals } from '@/lib/imports/actions'
import { previewImportProposal } from '@/lib/imports/review-actions'
import { isBatchAcceptable } from '@/lib/imports/server/types'
import { importBatchHref, SUMMARY_KIND_TEXT } from '@/lib/imports/ui/labels'
import {
  ANSWER,
  flowOf,
  needPillLabel,
  rowWords,
  SKIP_COPY,
  STALE_QUESTION,
  skipText,
  VOIDED_QUESTION,
} from '@/lib/imports/ui/review-copy'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ProposalStatusPill } from '../status-badge'
import { NeedLine, NeedQuestion, type QuestionFrame } from './need-block'
import { isOpenProposal, ProposalTicket, unbreakableNumbers } from './proposal-ticket'
import { ANSWER_BUTTON, QUIET_ANSWER, QuestionAnswers, QuestionCard } from './question-card'
import { OFFLINE_TEXT, useReview } from './review-context'
import type { ProposalView } from './types'
import { useRowActions } from './use-row-actions'

/**
 * El título y la línea gris de una hoja en una lista. En una compra manda el
 * proveedor («Limpieza Demo SA» · «Compra · Factura A 0002-…»); en un movimiento
 * de Mercado Pago o del banco manda lo que es («Cobros con QR del 08/10»,
 * «Pasaste plata a Caja»): si no, seis renglones seguidos se titulaban «Mercado
 * Pago». Las palabras las arma `rowWords()` (puro, con tests).
 */
export function lineWords(s: ProposalView['summary']): { title: string; paper: string } {
  return rowWords({ ...s, label: unbreakableNumbers(s.label) }, SUMMARY_KIND_TEXT[s.kind])
}

/**
 * El importe de un renglón: pesos sin centavos (los centavos quedan en el
 * papel) y, en un movimiento del banco o de Mercado Pago, para qué lado fue la
 * plata. «↓ salió $ 200.000» y «↑ entró $ 1.584.000» no pueden verse iguales:
 * la flecha lleva el color, la palabra lo dice igual sin él.
 */
export function RowMoney({ s, className }: { s: ProposalView['summary']; className?: string }) {
  const flow = flowOf(s)
  return (
    <span className={cn('inline-flex items-baseline justify-end gap-1.5', className)}>
      {flow ? (
        <span className="inline-flex items-baseline gap-1 text-xs font-normal text-muted-foreground">
          <span
            aria-hidden
            className={cn('font-semibold', flow === 'in' ? 'text-adm-in' : 'text-adm-out')}
          >
            {flow === 'in' ? '↑' : '↓'}
          </span>
          {flow === 'in' ? 'entró' : 'salió'}
        </span>
      ) : null}
      <Amount cents={s.total_cents} decimals={0} />
    </span>
  )
}

/** Qué pregunta trae una hoja, en dos palabras (para «Las que siguen»). */
export function askLabel(p: ProposalView): string {
  if (p.status === 'stale') return 'Cambió: miralo de nuevo'
  if (p.status === 'error') return 'No se pudo cargar'
  const need = p.needs[0]
  return need ? needPillLabel(need.key) : 'Falta un dato'
}

function canPreviewBooks(p: ProposalView, editable: boolean): boolean {
  return (
    editable &&
    p.hasValues &&
    (p.status === 'ready' ||
      p.status === 'error' ||
      p.status === 'posting' ||
      p.status === 'needs_input')
  )
}

// ─── «Ver cómo queda en los libros» ──────────────────────────────────────────

/** El asiento de una hoja, armado en el servidor con el contexto de hoy (solo cuando se pide). */
function LazyEntry({ p, onHash }: { p: ProposalView; onHash?: (hash: string) => void }) {
  const { slug, batchId } = useReview()
  const onHashRef = useRef(onHash)
  onHashRef.current = onHash
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; entries: EntryPreviewData[] }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    void (async () => {
      try {
        const result = await previewImportProposal(slug, { batchId, proposalKey: p.key })
        if (cancelled) return
        if (!result.ok) {
          setState({ kind: 'error', message: result.message })
          return
        }
        setState({ kind: 'ok', entries: result.preview })
        onHashRef.current?.(result.hash)
      } catch {
        if (!cancelled) setState({ kind: 'error', message: OFFLINE_TEXT })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug, batchId, p.key])

  if (state.kind === 'loading') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Armando cómo queda en los libros…
      </p>
    )
  }
  if (state.kind === 'error') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.message}
      </p>
    )
  }
  return <EntryPreview entries={state.entries} alwaysOpen label="Ver cómo queda en los libros" />
}

/** «Ver cómo queda en los libros», plegado (lo que antes era «Ver asiento»). */
export function BooksPreview({ p }: { p: ProposalView }) {
  const { editable } = useReview()
  const [show, setShow] = useState(false)
  if (!canPreviewBooks(p, editable)) return null
  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-expanded={show}
        className={QUIET_ANSWER}
        onClick={() => setShow((v) => !v)}
      >
        {show ? 'Ocultar cómo queda en los libros' : 'Ver cómo queda en los libros'}
      </button>
      {show ? <LazyEntry p={p} /> : null}
    </div>
  )
}

// ─── Cargar una sola hoja ────────────────────────────────────────────────────

/** Un solo comprobante (reintentar, o cargar lo nuevo de uno que cambió). */
function usePostOne(p: ProposalView) {
  const { slug, batchId } = useReview()
  const [posting, setPosting] = useState(false)
  const post = async (hash: string) => {
    setPosting(true)
    try {
      const acceptWarnings = (p.summary.warnings ?? []).filter(isBatchAcceptable)
      const result = await postImportProposals(slug, {
        batchId,
        items: [{ key: p.key, previewHash: hash }],
        acceptWarnings,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      const r = result.data.results[0]
      switch (r?.outcome) {
        case 'posted':
        case 'replayed':
        case 'already_posted':
          toast.success('Listo: quedó cargado.')
          return
        case 'stale':
          toast.warning('Volvió a cambiar algo: miralo de nuevo.')
          return
        case 'needs_input':
          toast.warning('Le falta un dato: contestalo y probá otra vez.')
          return
        default:
          toast.error(r?.message ?? 'No se pudo cargar.')
      }
    } catch {
      toast.error(OFFLINE_TEXT)
    } finally {
      setPosting(false)
    }
  }
  return { post, posting }
}

/**
 * Cambió algo desde la revisión (un saldo, un mes que se cerró, el proveedor):
 * se muestra cómo queda AHORA y se carga con su hash (lo que se ve es lo que se
 * guarda).
 */
function StaleQuestion({ p, frame }: { p: ProposalView; frame: QuestionFrame }) {
  const { editable } = useReview()
  const [show, setShow] = useState(false)
  const [hash, setHash] = useState<string | null>(null)
  const { post, posting } = usePostOne(p)
  const { onLater: _later, ...card } = frame
  if (!editable) {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        Cambió algo desde que se revisó: hay que mirarlo de nuevo antes de cargarlo.
      </p>
    )
  }
  return (
    <QuestionCard {...card} question={STALE_QUESTION}>
      {show ? <LazyEntry p={p} onHash={setHash} /> : null}
      <QuestionAnswers>
        {!show ? (
          <Button
            type="button"
            variant="outline"
            className={ANSWER_BUTTON}
            onClick={() => setShow(true)}
          >
            Ver cómo queda ahora
          </Button>
        ) : null}
        {show && hash ? (
          <Button
            type="button"
            className={ANSWER_BUTTON}
            disabled={posting}
            onClick={() => void post(hash)}
          >
            {posting ? 'Cargando…' : 'Está bien: cargalo así'}
          </Button>
        ) : null}
      </QuestionAnswers>
    </QuestionCard>
  )
}

function ErrorQuestion({ p, frame }: { p: ProposalView; frame: QuestionFrame }) {
  const { editable } = useReview()
  const { post, posting } = usePostOne(p)
  const { onLater: _later, ...card } = frame
  const reason = (p.error?.message ?? SKIP_COPY.post_failed).replace(/\.$/, '')
  const text = `No se pudo cargar: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`
  if (!editable) return <p className="text-sm text-destructive text-pretty">{text}</p>
  return (
    <QuestionCard {...card} tone="info" question={text}>
      {p.previewHash ? (
        <QuestionAnswers>
          <Button
            type="button"
            className={`${ANSWER_BUTTON} gap-2`}
            disabled={posting}
            onClick={() => p.previewHash && void post(p.previewHash)}
          >
            <RotateCcw className="size-4" aria-hidden />
            {posting ? 'Cargando…' : 'Reintentar'}
          </Button>
        </QuestionAnswers>
      ) : null}
    </QuestionCard>
  )
}

/** Lo que una hoja abierta pregunta: lo que le falta, que cambió o que no se pudo cargar. */
function AskOf({ p, frame }: { p: ProposalView; frame: QuestionFrame }) {
  if (p.status === 'stale') return <StaleQuestion p={p} frame={frame} />
  if (p.status === 'error') return <ErrorQuestion p={p} frame={frame} />
  const need = p.needs[0]
  if (p.status === 'needs_input' && need) return <NeedQuestion p={p} need={need} frame={frame} />
  return null
}

// ─── Nota de crédito ─────────────────────────────────────────────────────────

/** NC: qué factura corrige (opcional; si no, queda a favor del proveedor). */
function CreditNoteLink({ p, partyId }: { p: ProposalView; partyId: string }) {
  const { slug, resolve, busyKey } = useReview()
  const id = useId()
  const current = p.summary.decisions?.credit_note_document_id ?? null
  const [items, setItems] = useState<OpenItemRef[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [choice, setChoice] = useState<string>(current ?? 'none')
  const supplier = p.summary.counterparty ?? 'el proveedor'

  const load = async () => {
    setLoading(true)
    try {
      const result = await loadPartyItems(slug, { partyId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // Las facturas pendientes del proveedor (lo que le debés).
      setItems(result.data.items.filter((i) => i.side === 'credit' && i.openCents > 0))
    } catch {
      toast.error(OFFLINE_TEXT)
    } finally {
      setLoading(false)
    }
  }

  return (
    <QuestionCard
      inset
      tone="info"
      question={
        current
          ? 'Esta nota de crédito corrige una factura que elegiste.'
          : '¿Qué factura corrige esta nota de crédito?'
      }
      context={
        current ? undefined : `Si no elegís, queda a favor de ${supplier} para el próximo pago.`
      }
    >
      {items === null ? (
        <QuestionAnswers>
          <Button
            type="button"
            variant="outline"
            className={ANSWER_BUTTON}
            disabled={loading}
            onClick={() => void load()}
          >
            {loading
              ? 'Buscando sus facturas…'
              : current
                ? 'Cambiar la factura'
                : 'Elegir la factura'}
          </Button>
        </QuestionAnswers>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-1.5 sm:max-w-md">
            <Label htmlFor={id} className="sr-only">
              Factura que corrige
            </Label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger
                id={id}
                className="w-full data-[size=default]:h-11 md:data-[size=default]:h-10"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ninguna: que quede a favor</SelectItem>
                {items.map((i) => (
                  <SelectItem key={i.lineId} value={i.documentId}>
                    {i.label} · {formatIsoDay(i.entryDate)} · debés {formatCents(i.openCents)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            className={ANSWER_BUTTON}
            disabled={busyKey === p.key}
            onClick={() =>
              void resolve(p.key, [
                {
                  kind: 'link_credit_note',
                  proposalKey: p.key,
                  documentId: choice === 'none' ? null : choice,
                },
              ])
            }
          >
            {ANSWER.save}
          </Button>
        </div>
      )}
    </QuestionCard>
  )
}

function creditNoteOf(p: ProposalView, editable: boolean): string | null {
  return editable &&
    p.summary.kind === 'credit_note' &&
    (p.status === 'ready' || p.status === 'needs_input') &&
    p.partyId
    ? p.partyId
    : null
}

// ─── Lo callado de una hoja abierta ──────────────────────────────────────────

/** «No es nuestro» (con «Deshacer») y «Deshacer lo que contesté». */
function QuietActions({ p }: { p: ProposalView }) {
  const { editable, resolve, busyKey } = useReview()
  const { ignore } = useRowActions()
  const busy = busyKey === p.key
  if (!editable || !isOpenProposal(p)) return null
  return (
    <>
      {p.status !== 'posting' ? (
        <button
          type="button"
          className={QUIET_ANSWER}
          disabled={busy}
          onClick={() => void ignore(p, 'No es nuestro')}
        >
          {ANSWER.notOurs}
        </button>
      ) : null}
      {p.hasDecisions ? (
        <button
          type="button"
          className={QUIET_ANSWER}
          disabled={busy}
          onClick={() =>
            void resolve(p.key, [{ kind: 'reset', proposalKey: p.key }], {
              success: 'Listo: borré lo que habías contestado.',
            })
          }
        >
          Deshacer lo que contesté
        </button>
      ) : null}
    </>
  )
}

// ─── La hoja en la mano ──────────────────────────────────────────────────────

/**
 * La pregunta en la mano: la hoja que toca contestar, abierta, con su pregunta
 * en criollo y sus respuestas grandes. Reemplaza a la fila que venía abierta
 * con su formulario y hasta seis botones iguales.
 *
 * Lo que manda cada respuesta es lo de siempre (`resolveImportNeeds`, un cambio
 * por toque). Abajo, callados, «No es nuestro» y «Deshacer lo que contesté».
 */
export function ProposalInHand({
  p,
  position,
  total,
  onLater,
  focusOnMount = false,
}: {
  p: ProposalView
  /** «Pregunta {position} de {total}». */
  position: number
  total: number
  /** Dejarla para después y pasar a la siguiente. */
  onLater?: () => void
  /** Llevarle el foco al aparecer (después de contestar la anterior). */
  focusOnMount?: boolean
}) {
  const { editable } = useReview()
  const anchor = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!focusOnMount) return
    anchor.current?.querySelector<HTMLElement>('[data-tone]')?.focus({ preventScroll: false })
  }, [focusOnMount])
  const creditParty = creditNoteOf(p, editable)
  const quiet = editable && isOpenProposal(p)
  return (
    <div ref={anchor} className="space-y-3">
      <AskOf
        p={p}
        frame={{
          eyebrow: `Pregunta ${position} de ${total} · ${askLabel(p)}`,
          headingLevel: 'h2',
          tabIndex: -1,
          onLater,
          footer: quiet ? <QuietActions p={p} /> : undefined,
        }}
      />
      {creditParty ? <CreditNoteLink p={p} partyId={creditParty} /> : null}
      <BooksPreview p={p} />
    </div>
  )
}

// ─── Un renglón de la lista ──────────────────────────────────────────────────

/**
 * Una hoja en la lista (listos, cargados, lo que no se carga, todos): un
 * renglón cerrado con margen (el día), quién o qué, el tipo de papel, el estado
 * y el importe. Al tocarlo se abre en el lugar, uno por vez, con su papel y UNA
 * acción según el estado; lo demás, callado.
 *
 * `sameStatus`: la vista ya filtra por ese estado («Cargados», «Listos»), así
 * que la píldora de cada fila no se dibuja (dieciocho «Cargado» iguales no
 * informan). Una que está cargándose la sigue mostrando.
 */
export function ProposalLine({ p, sameStatus = false }: { p: ProposalView; sameStatus?: boolean }) {
  const { openKey, setOpenKey } = useReview()
  const open = openKey === p.key
  const s = p.summary
  const reason = p.error?.reason ?? null
  const day = isRealIsoDay(s.date) ? s.date : null
  const { title, paper } = lineWords(s)
  // Un salteo sin plata (un día cargado a mano, la plata retenida) no muestra «$ 0».
  const showAmount = !(p.status === 'skipped' && s.total_cents === 0)
  const showStatus = !(sameStatus && (p.status === 'posted' || p.status === 'ready'))

  return (
    <LedgerRow
      id={`hoja-${p.key}`}
      rail={
        day ? (
          <LedgerRail
            label={MONTH_NAMES_SHORT[Number(day.slice(5, 7)) - 1]}
            value={day.slice(8, 10)}
          />
        ) : undefined
      }
      title={title}
      onClick={() => setOpenKey(open ? null : p.key)}
      expanded={open}
      muted={p.status === 'skipped' || p.status === 'voided'}
      meta={
        <>
          {paper}
          {s.item_count > 1 ? ` · junta ${s.item_count} movimientos del archivo` : ''}
        </>
      }
      amount={
        showStatus || showAmount ? (
          <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
            {showStatus ? (
              <ProposalStatusPill status={p.status} reason={reason} message={p.error?.message} />
            ) : null}
            {showAmount ? <RowMoney s={s} className="min-w-[9ch]" /> : null}
          </span>
        ) : undefined
      }
    >
      {open ? <ProposalOpened p={p} /> : null}
    </LedgerRow>
  )
}

/**
 * Lo que se ve al abrir un renglón: su papel (el ticket, directo: el renglón
 * de arriba ya dice quién, qué y cuánto, así que no se repite en una tarjeta
 * resumen) y, al lado, lo que le falta o por qué no se carga, con UNA acción
 * según el estado. En una hoja angosta (el celular) el papel va arriba y lo
 * demás debajo.
 *
 * Va aparte de `ProposalLine` para poder dibujarlo solo (los tests comprueban
 * que quien solo lee no recibe ninguna respuesta ni botón de carga acá adentro).
 */
export function ProposalOpened({ p }: { p: ProposalView }) {
  const { editable, slug, batchId, resolve, busyKey } = useReview()
  const { unignore } = useRowActions()
  const s = p.summary
  const reason = p.error?.reason ?? null
  const movedMonth = Boolean(s.month && s.date && s.date.slice(0, 7) < s.month)
  const busy = busyKey === p.key
  const creditParty = creditNoteOf(p, editable)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 pt-1 pb-1 @[40rem]/ledger:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] @[40rem]/ledger:items-start @[40rem]/ledger:gap-6">
      {/* En una hoja angosta el total baja un escalón: nueve cifras entran en 240 px. */}
      <ProposalTicket p={p} className="max-w-md @max-[28rem]/ledger:[&_.text-2xl]:text-lg" />
      <div className="min-w-0 space-y-3">
        {movedMonth ? (
          <p className="text-sm text-muted-foreground">
            Su mes ya está cerrado: queda con fecha del primer día abierto.
          </p>
        ) : null}

        {p.status === 'needs_input' || p.status === 'stale' || p.status === 'error' ? (
          editable ? (
            <AskOf p={p} frame={{ inset: true }} />
          ) : (
            <ReadOnlyAsk p={p} />
          )
        ) : null}

        {p.status === 'skipped' && reason ? (
          <p className="text-sm text-muted-foreground text-pretty">
            {skipText(reason, p.error?.message)}
          </p>
        ) : null}
        {p.status === 'voided' ? (
          <p className="text-sm text-muted-foreground text-pretty">
            {editable ? VOIDED_QUESTION : 'El comprobante se anuló.'}
          </p>
        ) : null}

        {creditParty ? <CreditNoteLink p={p} partyId={creditParty} /> : null}

        <RowActions>
          {p.status === 'posted' && p.documentId ? (
            <Button asChild variant="outline" className="h-11 gap-2 md:pointer-fine:h-9">
              <Link href={`/${slug}/administracion/comprobantes/${p.documentId}`}>
                Ver el comprobante
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          ) : null}
          {p.status === 'skipped' && p.error?.document_id ? (
            <Button asChild variant="outline" className="h-11 gap-2 md:pointer-fine:h-9">
              <Link href={`/${slug}/administracion/comprobantes/${p.error.document_id}`}>
                Ver el comprobante
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          ) : null}
          {p.status === 'skipped' && p.error?.batch_id && p.error.batch_id !== batchId ? (
            <Button asChild variant="outline" className="h-11 gap-2 md:pointer-fine:h-9">
              <Link href={importBatchHref(slug, p.error.batch_id)}>
                Abrir ese archivo
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          ) : null}
          {editable && p.status === 'voided' ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 md:pointer-fine:h-9"
              disabled={busy}
              onClick={() =>
                void resolve(p.key, [{ kind: 'reimport', proposalKey: p.key }], {
                  success: 'Listo: lo armé de nuevo para cargarlo.',
                })
              }
            >
              <RotateCcw className="size-4" aria-hidden />
              Volver a cargar
            </Button>
          ) : null}
          {editable && p.status === 'skipped' && reason === 'ignored' ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 md:pointer-fine:h-9"
              disabled={busy}
              onClick={() => void unignore(p)}
            >
              <Undo2 className="size-4" aria-hidden />
              Volver a incluirlo
            </Button>
          ) : null}
        </RowActions>

        <BooksPreview p={p} />
        <div className="flex flex-wrap gap-x-4 empty:hidden">
          <QuietActions p={p} />
        </div>
      </div>
    </div>
  )
}

/** Los botones de un renglón abierto; si no hay ninguno, no deja un hueco. */
function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 empty:hidden">{children}</div>
}

/** Para quien solo mira: qué le falta a una hoja, sin botones. */
function ReadOnlyAsk({ p }: { p: ProposalView }) {
  if (p.status === 'stale') {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        Cambió algo desde que se revisó: hay que mirarlo de nuevo antes de cargarlo.
      </p>
    )
  }
  if (p.status === 'error') {
    return (
      <p className="text-sm text-destructive text-pretty">
        {p.error?.message ?? SKIP_COPY.post_failed}
      </p>
    )
  }
  return (
    <div className="space-y-1">
      {p.needs.map((need, i) => (
        <NeedLine key={`${need.key}-${i.toString()}`} need={need} />
      ))}
    </div>
  )
}
