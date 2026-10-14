'use client'

import Link from 'next/link'
import { Amount } from '@/components/administracion/amount'
import {
  Ticket,
  TicketHeader,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from '@/components/administracion/kit'
import { WARNING_COPY } from '@/lib/accounting/errors'
import type { WarningKey } from '@/lib/accounting/types'
import { formatIsoDay } from '@/lib/dates'
import { isBatchAcceptable } from '@/lib/imports/server/types'
import { BATCH_WARNING_TEXT, importSourceHref, SUMMARY_KIND_TEXT } from '@/lib/imports/ui/labels'
import { NOTE_COPY, paperLines } from '@/lib/imports/ui/review-copy'
import { useReview } from './review-context'
import type { ProposalView } from './types'

function warningText(w: WarningKey): string {
  return isBatchAcceptable(w) ? BATCH_WARNING_TEXT[w] : WARNING_COPY[w].fallback
}

/** «0002-00000061» no se parte en el guion (con un separador de palabras invisible a cada lado). */
export function unbreakableNumbers(label: string): string {
  return label.replace(/(\d)-(\d)/g, '$1⁠-⁠$2')
}

/** ¿La hoja sigue abierta (se puede contestar o cargar)? */
export function isOpenProposal(p: Pick<ProposalView, 'status'>): boolean {
  return p.status !== 'posted' && p.status !== 'skipped' && p.status !== 'voided'
}

/**
 * El papel que tenés en la mano: lo que el archivo dice de una hoja, como un
 * ticket (qué es, de quién, de cuándo y cuánto). Las compras de ARCA llevan el
 * sello «CON FACTURA»: todo lo que trae ARCA la tiene.
 *
 * Solo muestra lo que el resumen trae (`paperLines`): una compra de ARCA no
 * guarda neto ni IVA, así que no se inventan. Un cobro de Mercado Pago se lee
 * como una cuenta. Las notas de la hoja van como letra chica.
 */
export function ProposalTicket({ p, className }: { p: ProposalView; className?: string }) {
  const { slug, source } = useReview()
  const s = p.summary
  const paper = paperLines(s)
  const open = isOpenProposal(p)
  // Quién y cuándo, cada uno en su renglón: en una línea, un nombre largo dejaba el «·» colgando.
  const subtitle =
    s.counterparty || s.date ? (
      <>
        {s.counterparty ? <span className="block">{s.counterparty}</span> : null}
        {s.date ? <span className="block">{formatIsoDay(s.date)}</span> : null}
      </>
    ) : undefined
  const arcaPaper =
    source === 'arca_recibidos' && (s.kind === 'purchase' || s.kind === 'credit_note')
  return (
    <Ticket className={className} aria-label={`${SUMMARY_KIND_TEXT[s.kind]}: ${s.label}`}>
      <TicketHeader title={unbreakableNumbers(s.label)} subtitle={subtitle}>
        {arcaPaper ? <TicketStamp tone="factura">Con factura</TicketStamp> : null}
      </TicketHeader>
      <TicketRule />
      {paper.lines.map((line) => (
        <TicketRow
          key={line.label}
          label={line.label}
          value={line.value}
          hint={line.hint}
          strong={line.strong}
        />
      ))}
      {s.item_count > 1 ? (
        <TicketRow label="Junta" value={`${s.item_count} renglones`} muted />
      ) : null}
      {paper.total ? (
        <>
          {paper.lines.length > 0 || s.item_count > 1 ? <TicketRule double /> : null}
          <TicketTotal label={paper.total.label} value={paper.total.value} />
        </>
      ) : null}
      {paper.aside.length > 0 ? (
        <>
          <TicketRule />
          {paper.aside.map((line) => (
            <TicketRow key={line.label} label={line.label} value={line.value} hint={line.hint} />
          ))}
        </>
      ) : null}
      {(s.notes ?? []).map((note) => (
        <TicketNote key={note}>
          {NOTE_COPY[note]}
          {note === 'rule_applied' ? (
            <>
              {' '}
              <Link
                href={`${importSourceHref(slug, source)}#aprendido`}
                className="rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Ver
              </Link>
            </>
          ) : null}
        </TicketNote>
      ))}
      {open
        ? (s.warnings ?? []).map((w) => (
            <TicketNote key={w} className="font-medium">
              Aviso: {warningText(w)}
            </TicketNote>
          ))
        : null}
    </Ticket>
  )
}

/**
 * El papel en tres líneas, con el papel entero plegado en «Ver el papel». Es
 * para la pregunta en la mano en el celular, donde el papel va arriba de la
 * pregunta y entero la empujaría fuera de la pantalla. Un renglón abierto de
 * una lista muestra el ticket directo (`ProposalOpened`).
 */
export function PaperFold({ p, className }: { p: ProposalView; className?: string }) {
  const s = p.summary
  return (
    <details className={className}>
      <summary className="force-light flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl border border-adm-paper-rule/60 bg-adm-paper px-3.5 py-2.5 text-adm-paper-ink shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block font-medium leading-snug [overflow-wrap:anywhere]">
            {unbreakableNumbers(s.label)}
          </span>
          {/* Hasta dos renglones: un nombre cortado con «…» no dice de quién es el papel. */}
          <span className="line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {[s.counterparty, formatIsoDay(s.date)].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <Amount cents={s.total_cents} className="block font-mono text-sm font-semibold" />
          <span className="block text-xs text-muted-foreground underline underline-offset-2">
            Ver el papel
          </span>
        </span>
      </summary>
      {/* Un ticket mide lo que un ticket: en una tablet no se estira a todo el ancho. */}
      <ProposalTicket p={p} className="mt-3 max-w-md" />
    </details>
  )
}
