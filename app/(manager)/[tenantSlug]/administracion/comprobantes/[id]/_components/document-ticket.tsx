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
import { VoidedBand } from './voided-band'

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

const TICKET_WIDTH = 'mx-auto w-full max-w-[22.5rem] lg:max-w-none'
const FOOT = 'font-mono text-[10px] tracking-[0.12em] uppercase'

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

function Voided({
  doc,
  children,
}: {
  doc: Pick<DocumentDetail, 'status' | 'reversedBy'>
  children: ReactNode
}) {
  if (doc.status === 'voided') return <VoidedBand>{children}</VoidedBand>
  if (doc.reversedBy?.status === 'posted') return <VoidedBand later>{children}</VoidedBand>
  return children
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
  return (
    <Voided doc={doc}>
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

        {paper.rows.length > 0 ? (
          <>
            <TicketRule />
            {paper.rows.map((row) => (
              <TicketRow
                key={row.key}
                label={row.label}
                hint={row.hint}
                value={formatCents(row.minus ? -row.cents : row.cents)}
              />
            ))}
            {paper.more > 0 ? (
              <p className="py-1 text-xs text-muted-foreground">
                y {paper.more} {paper.more === 1 ? 'renglón más' : 'renglones más'}
              </p>
            ) : null}
          </>
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
