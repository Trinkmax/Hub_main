'use client'

import { ArrowRight, Eye, Info, RotateCcw, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { loadPartyItems } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-actions'
import { Amount } from '@/components/administracion/amount'
import { EntryPreview, type EntryPreviewData } from '@/components/administracion/entry-preview'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WARNING_COPY } from '@/lib/accounting/errors'
import type { OpenItemRef, WarningKey } from '@/lib/accounting/types'
import { formatIsoDay, formatMonthYear } from '@/lib/dates'
import { postImportProposals } from '@/lib/imports/actions'
import { previewImportProposal } from '@/lib/imports/review-actions'
import {
  isBatchAcceptable,
  NOTE_TEXT,
  PROPOSAL_VOIDED_TEXT,
  SKIP_REASON_TEXT,
  type SkipReason,
} from '@/lib/imports/server/types'
import {
  BATCH_WARNING_TEXT,
  importBatchHref,
  SUMMARY_DETAIL_TEXT,
  SUMMARY_KIND_TEXT,
} from '@/lib/imports/ui/labels'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ProposalStatusBadge } from '../status-badge'
import { NeedBlock } from './need-block'
import { OFFLINE_TEXT, useReview } from './review-context'
import type { ProposalView } from './types'
import { useRowActions } from './use-row-actions'

const SMALL = 'h-11 gap-2 md:h-9'

function warningText(w: WarningKey): string {
  return isBatchAcceptable(w) ? BATCH_WARNING_TEXT[w] : WARNING_COPY[w].fallback
}

/** Los números del detalle que vale la pena mostrar (comisión, neto, cierre del día…). */
function detailRows(p: ProposalView): Array<{ label: string; cents: number }> {
  const detail = p.summary.detail ?? {}
  return Object.entries(SUMMARY_DETAIL_TEXT).flatMap(([key, label]) => {
    const v = detail[key]
    return typeof v === 'number' && Number.isFinite(v) && v !== 0 ? [{ label, cents: v }] : []
  })
}

/**
 * Una propuesta de la revisión (diseño §4.1 paso 2 y §4.2.2): qué es, cuánto,
 * su estado en palabras, lo que le falta con su arreglo, y lo que se puede
 * hacer con ella («Ver asiento», «No es nuestro», «Volver a cargar»…).
 */
export function ProposalRow({ p }: { p: ProposalView }) {
  const { editable, slug, batchId, resolve, busyKey } = useReview()
  const { ignore, unignore } = useRowActions()
  const titleId = useId()
  const [showEntry, setShowEntry] = useState(false)
  const busy = busyKey === p.key
  const s = p.summary
  const details = detailRows(p)
  const moved = s.month && s.date && s.date.slice(0, 7) < s.month
  const meta = [
    s.counterparty,
    formatIsoDay(s.date),
    s.month
      ? `va al libro de ${formatMonthYear(s.month)}${moved ? ' (su mes está cerrado)' : ''}`
      : null,
    s.item_count > 1 ? `${s.item_count} filas del archivo` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const open = p.status !== 'posted' && p.status !== 'skipped' && p.status !== 'voided'
  const canPreview =
    editable &&
    p.hasValues &&
    (p.status === 'ready' ||
      p.status === 'error' ||
      p.status === 'posting' ||
      p.status === 'needs_input')
  const skipReason = p.error?.reason

  return (
    <li aria-labelledby={titleId} className="space-y-3 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <ProposalStatusBadge status={p.status} />
            <span className="text-xs text-muted-foreground">{SUMMARY_KIND_TEXT[s.kind]}</span>
          </div>
          <p id={titleId} className="font-medium break-words">
            {s.label}
          </p>
          {meta ? <p className="text-sm text-muted-foreground text-pretty">{meta}</p> : null}
        </div>
        <Amount cents={s.total_cents} className="text-base font-semibold" />
      </div>

      {details.length > 0 ? (
        <details className="group text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground hover:text-foreground md:min-h-0">
            Ver el detalle
          </summary>
          <dl className="mt-2 grid gap-x-6 gap-y-1 rounded-lg border border-border/60 p-3 sm:grid-cols-2">
            {details.map((d) => (
              <div key={d.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">{d.label}</dt>
                <dd>
                  <Amount cents={d.cents} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      {(s.notes ?? []).length > 0 || (open && (s.warnings ?? []).length > 0) ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {(s.notes ?? []).map((n) => (
            <li key={n} className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {NOTE_TEXT[n]}
            </li>
          ))}
          {open
            ? (s.warnings ?? []).map((w) => (
                <li key={w} className="flex items-start gap-1.5 text-warning-text">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  Aviso: {warningText(w)}
                </li>
              ))
            : null}
        </ul>
      ) : null}

      {p.status === 'needs_input' && p.needs.length > 0 ? (
        <div className="space-y-2">
          {p.needs.map((need, i) => (
            <NeedBlock key={`${need.key}-${i.toString()}`} p={p} need={need} />
          ))}
        </div>
      ) : null}

      {p.status === 'stale' ? <StaleBlock p={p} /> : null}

      {p.status === 'error' ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {p.error?.message ?? SKIP_REASON_TEXT.post_failed}
        </p>
      ) : null}

      {p.status === 'skipped' && skipReason ? (
        <p className="text-sm text-muted-foreground text-pretty">
          {skipReason in SKIP_REASON_TEXT ? SKIP_REASON_TEXT[skipReason as SkipReason] : ''}
          {p.error?.document_id ? (
            <>
              {' '}
              <Link
                href={`/${slug}/administracion/comprobantes/${p.error.document_id}`}
                className="font-medium text-foreground underline underline-offset-2"
              >
                {p.error.label ?? 'Ver el comprobante'}
              </Link>
            </>
          ) : null}
          {p.error?.batch_id && p.error.batch_id !== batchId ? (
            <>
              {' '}
              <Link
                href={importBatchHref(slug, p.error.batch_id)}
                className="font-medium text-foreground underline underline-offset-2"
              >
                Abrir esa importación
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {p.status === 'voided' ? (
        <p className="text-sm text-muted-foreground">{PROPOSAL_VOIDED_TEXT}</p>
      ) : null}

      {editable &&
      s.kind === 'credit_note' &&
      (p.status === 'ready' || p.status === 'needs_input') &&
      p.partyId ? (
        <CreditNoteLink p={p} partyId={p.partyId} />
      ) : null}

      {showEntry ? <LazyEntry p={p} /> : null}

      <div className="flex flex-wrap gap-2">
        {p.status === 'posted' && p.documentId ? (
          <Button asChild variant="outline" className={SMALL}>
            <Link href={`/${slug}/administracion/comprobantes/${p.documentId}`}>
              Ver el comprobante
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        ) : null}
        {canPreview ? (
          <Button
            type="button"
            variant="outline"
            className={SMALL}
            aria-expanded={showEntry}
            onClick={() => setShowEntry((v) => !v)}
          >
            <Eye className="size-4" aria-hidden />
            {showEntry ? 'Ocultar el asiento' : 'Ver asiento'}
          </Button>
        ) : null}
        {editable && p.status === 'error' && p.previewHash ? (
          <RetryButton p={p} hash={p.previewHash} />
        ) : null}
        {editable && p.status === 'voided' ? (
          <Button
            type="button"
            className={SMALL}
            disabled={busy}
            onClick={() =>
              void resolve(p.key, [{ kind: 'reimport', proposalKey: p.key }], {
                success: 'Listo: lo armamos de nuevo para cargarlo.',
              })
            }
          >
            <RotateCcw className="size-4" aria-hidden />
            Volver a cargar
          </Button>
        ) : null}
        {editable && p.status === 'skipped' && skipReason === 'ignored' ? (
          <Button
            type="button"
            variant="outline"
            className={SMALL}
            disabled={busy}
            onClick={() => void unignore(p)}
          >
            <Undo2 className="size-4" aria-hidden />
            Volver a incluirlo
          </Button>
        ) : null}
        {editable && open && p.status !== 'posting' ? (
          <Button
            type="button"
            variant="outline"
            className={SMALL}
            disabled={busy}
            onClick={() => void ignore(p, 'No es nuestro')}
          >
            No es nuestro
          </Button>
        ) : null}
        {editable && open && p.hasDecisions ? (
          <Button
            type="button"
            variant="ghost"
            className={SMALL}
            disabled={busy}
            onClick={() =>
              void resolve(p.key, [{ kind: 'reset', proposalKey: p.key }], {
                success: 'Listo: borramos lo que habías elegido.',
              })
            }
          >
            Borrar lo que elegí
          </Button>
        ) : null}
      </div>
    </li>
  )
}

/** «Ver asiento», armado en el servidor con el contexto de hoy (solo cuando se pide). */
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
        Armando el asiento…
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
  return <EntryPreview entries={state.entries} alwaysOpen />
}

/** Un solo comprobante (reintentar o cargar el asiento nuevo de uno que cambió). */
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
          toast.warning('Volvió a cambiar algo: mirá el asiento de nuevo.')
          return
        case 'needs_input':
          toast.warning('Le falta un dato: completalo y probá otra vez.')
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

function RetryButton({ p, hash }: { p: ProposalView; hash: string }) {
  const { post, posting } = usePostOne(p)
  return (
    <Button type="button" className={SMALL} disabled={posting} onClick={() => void post(hash)}>
      <RotateCcw className="size-4" aria-hidden />
      {posting ? 'Cargando…' : 'Reintentar'}
    </Button>
  )
}

/**
 * Cambió algo desde la revisión (un saldo, un mes que se cerró, el proveedor):
 * se muestra el asiento NUEVO y se carga con su hash (lo que se ve es lo que
 * se guarda).
 */
function StaleBlock({ p }: { p: ProposalView }) {
  const { editable } = useReview()
  const [show, setShow] = useState(false)
  const [hash, setHash] = useState<string | null>(null)
  const { post, posting } = usePostOne(p)
  return (
    <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
      <p className="text-pretty">
        Algo cambió desde que lo revisaste (un saldo, un mes que se cerró o los datos del
        proveedor). Mirá cómo queda el asiento ahora y, si está bien, cargalo.
      </p>
      {show ? <LazyEntry p={p} onHash={setHash} /> : null}
      {editable ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {!show ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full gap-2 sm:w-auto md:h-9"
              onClick={() => setShow(true)}
            >
              <Eye className="size-4" aria-hidden />
              Ver el asiento nuevo
            </Button>
          ) : null}
          {show && hash ? (
            <Button
              type="button"
              className="h-11 w-full sm:w-auto md:h-9"
              disabled={posting}
              onClick={() => void post(hash)}
            >
              {posting ? 'Cargando…' : 'Está bien: cargalo así'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** NC: qué factura corrige (opcional; si no, queda a favor del proveedor). */
function CreditNoteLink({ p, partyId }: { p: ProposalView; partyId: string }) {
  const { slug, resolve, busyKey } = useReview()
  const id = useId()
  const current = p.summary.decisions?.credit_note_document_id ?? null
  const [items, setItems] = useState<OpenItemRef[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [choice, setChoice] = useState<string>(current ?? 'none')

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
    <div className="space-y-2 rounded-lg border border-border/70 p-3 text-sm">
      <p className="text-pretty">
        {current
          ? 'Esta nota de crédito corrige una factura que elegiste.'
          : '¿Qué factura corrige esta nota de crédito? Es opcional: si no elegís, queda a favor del proveedor para el próximo pago.'}
      </p>
      {items === null ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto md:h-9"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading
            ? 'Buscando sus facturas…'
            : current
              ? 'Cambiar la factura'
              : 'Elegir la factura'}
        </Button>
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
            className={cn('h-11 w-full sm:w-auto md:h-9')}
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
            Guardar
          </Button>
        </div>
      )}
    </div>
  )
}
