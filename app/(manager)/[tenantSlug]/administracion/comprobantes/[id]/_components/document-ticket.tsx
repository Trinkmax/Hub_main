import type { ReactNode } from 'react'
import {
  Ticket,
  TicketHeader,
  TicketLabel,
  TicketNote,
  TicketRow,
  TicketRule,
  TicketStamp,
  TicketTotal,
} from '@/components/administracion/kit/ticket'
import { VoucherText } from '@/components/administracion/voucher-text'
import type { DocumentDetail } from '@/lib/accounting/queries/documents'
import { formatCents } from '@/lib/money'
import { CloseTicket } from '../../../ventas/cierre/_components/close-ticket'
import { closeTicketProps } from '../../../ventas/cierre/_lib/close-ticket-props'
import {
  type DocumentPaper,
  documentPaper,
  paperDetail,
  paperFooter,
  type StoryContext,
} from '../../_lib/document-story'
import { VoidedBand, VoidedMark } from './voided-band'

/**
 * El papel de la ficha: el mismo ticket que se vio antes de guardar, ya
 * archivado. Membrete con quién lo emitió, su sello (el mismo de la carga),
 * los renglones en palabras de dueño, el total, lo que escribió la persona y,
 * al pie, quién lo cargó.
 *
 * Un cierre del día usa SU ticket (`CloseTicket` con `closeTicketProps`, el
 * mismo de la pantalla del cierre), quieto y sin «Cuándo entra»: lo que llegó
 * de verdad lo cuenta el mapa de al lado, con sus botones.
 *
 * El sello nunca entra animado: nadie selló recién. Un comprobante anulado
 * lleva la banda «ANULADO» encima.
 */

// Su columna mide lo mismo (360 px): en una sola columna queda centrado, con forma de ticket.
const TICKET_WIDTH = 'mx-auto w-full max-w-[22.5rem]'
const FOOT = 'font-mono text-[10px] tracking-[0.12em] uppercase'

/**
 * Un importe de ocho cifras o más («$ 12.345.678,90») le deja al concepto una
 * columna de una palabra por renglón. Ahí el importe baja entero a su propio
 * renglón, a la derecha, como hace el total. Es una clase sobre el renglón del
 * kit (`TicketRow`), que no se toca.
 */
const LONG_VALUE = 14
const LONG_ROW =
  '[&>div]:flex-wrap [&>div>span:first-child]:max-w-full [&>div>span:last-child]:ml-auto'
/**
 * Los puntitos del renglón ceden su ancho mínimo antes que el concepto: con un
 * importe de seis cifras, «Compras: bebidas sin alcohol» se partía en dos por
 * unos px de puntitos (el renglón ya separa concepto e importe con su hueco).
 */
const ROW = '[&>div>span:nth-child(2)]:min-w-0'

/** Lo que escribió la persona al cargar: el detalle y, debajo, la nota tal cual. */
function Detail({ detail }: { detail: NonNullable<DocumentPaper['detail']> }) {
  return (
    <div>
      <TicketLabel className="pb-1">Detalle</TicketLabel>
      {detail.extra ? <p className="text-sm text-pretty">{detail.extra}</p> : null}
      {detail.notes ? (
        <p className="text-sm break-words whitespace-pre-line text-muted-foreground text-pretty">
          {detail.notes}
        </p>
      ) : null}
    </div>
  )
}

/** `null` vigente · `now` anulado · `later` anulado con fecha posterior. */
function voidedAs(doc: Pick<DocumentDetail, 'status' | 'reversedBy'>): 'now' | 'later' | null {
  if (doc.status === 'voided') return 'now'
  if (doc.reversedBy?.status === 'posted') return 'later'
  return null
}

function Voided({
  doc,
  placed = false,
  children,
}: {
  doc: Pick<DocumentDetail, 'status' | 'reversedBy'>
  /** El papel ya puso la banda sobre sus renglones. */
  placed?: boolean
  children: ReactNode
}) {
  const voided = voidedAs(doc)
  if (voided === null) return children
  return (
    <VoidedBand later={voided === 'later'} placed={placed}>
      {children}
    </VoidedBand>
  )
}

export function DocumentTicket({
  doc,
  ctx,
}: {
  doc: DocumentDetail
  ctx: Pick<StoryContext, 'today' | 'treasuryKinds'>
}) {
  if (doc.kind === 'sales_close') {
    const detail = paperDetail(doc)
    return (
      <Voided doc={doc}>
        <CloseTicket
          {...closeTicketProps([doc], { today: ctx.today, arrivals: false })}
          className={TICKET_WIDTH}
          footer={
            <>
              {detail ? (
                <>
                  <TicketRule />
                  <Detail detail={detail} />
                </>
              ) : null}
              <TicketNote className={FOOT}>{paperFooter(doc)}</TicketNote>
            </>
          }
        />
      </Voided>
    )
  }

  const paper = documentPaper(doc, ctx)
  const voided = voidedAs(doc)
  // Anulado, la banda cae en el medio de los renglones: ni sobre el sello (qué papel era) ni
  // sobre el total.
  const placed = voided !== null && paper.rows.length > 0
  return (
    <Voided doc={doc} placed={placed}>
      <Ticket aria-label="El comprobante, como quedó guardado" className={TICKET_WIDTH}>
        <TicketHeader
          title={paper.title}
          // Qué papel es en un renglón; el día y el CUIT en otro (nunca un «·» colgando).
          subtitle={
            <>
              {paper.word ? (
                <span className="block text-balance">
                  <VoucherText text={paper.word} />
                </span>
              ) : null}
              <span className="block">
                <VoucherText text={[paper.day, paper.taxId].filter(Boolean).join(' · ')} />
              </span>
            </>
          }
        >
          {paper.stamp ? (
            <TicketStamp tone={paper.stamp.tone}>{paper.stamp.text}</TicketStamp>
          ) : null}
        </TicketHeader>

        {paper.rows.length > 0 ? <TicketRule /> : null}
        {paper.rows.length > 0 ? (
          <div
            data-voided-rows={placed ? '' : undefined}
            className={placed ? 'relative' : undefined}
          >
            {paper.rows.map((row) => {
              const value = formatCents(row.minus ? -row.cents : row.cents)
              return (
                <div key={row.key} className={value.length > LONG_VALUE ? LONG_ROW : ROW}>
                  <TicketRow label={row.label} hint={row.hint} value={value} />
                </div>
              )
            })}
            {paper.more > 0 ? (
              <p className="py-1 text-xs text-muted-foreground">
                y {paper.more} {paper.more === 1 ? 'renglón más' : 'renglones más'}
              </p>
            ) : null}
            {placed ? <VoidedMark later={voided === 'later'} /> : null}
          </div>
        ) : null}

        <TicketRule double />
        <TicketTotal
          label={paper.total.label}
          value={formatCents(paper.total.cents)}
          hint={paper.total.hint}
        />

        {paper.detail ? (
          <>
            <TicketRule />
            <Detail detail={paper.detail} />
          </>
        ) : null}

        {paper.note ? <TicketNote>{paper.note}</TicketNote> : null}
        <TicketNote className={FOOT}>{paper.footer}</TicketNote>
      </Ticket>
    </Voided>
  )
}
