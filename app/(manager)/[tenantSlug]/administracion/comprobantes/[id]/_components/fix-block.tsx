import { FilePenLine, FileText, Lock } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Panel } from '@/components/administracion/kit/panel'
import { VoucherText } from '@/components/administracion/voucher-text'
import { Button } from '@/components/ui/button'
import type { DocumentDetail, DocumentLink } from '@/lib/accounting/queries/documents'
import { formatMonthLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { creditNoteHref, type DocumentActions } from '../../_lib/document-view'
import { ReverseDocumentButton, VoidDocumentButton } from './document-actions'

/**
 * ④ «¿Hay algo mal?»: cómo se corrige este comprobante, entrando por lo que
 * pasó y no por el nombre del botón. Los comprobantes no se editan: se anulan
 * y se cargan de nuevo, o se corrigen con el papel que corresponde (una nota
 * de crédito). Con el mes cerrado hay tres salidas y cada una dice cuándo
 * conviene, en vez de tres botones iguales en una caja azul.
 *
 * Qué se ofrece lo decide `documentActions` (más lo que ya está en ARCA), sin
 * cambios; acá solo se le pone a cada salida su situación. No se dibuja para
 * un comprobante anulado, para quien solo mira (la contadora) ni cuando no hay
 * nada que ofrecer.
 */

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const OUTLINE_BUTTON = 'h-11 w-full gap-2 sm:w-auto md:h-9'

function FixRow({
  what,
  children,
  action,
}: {
  /** La situación, en palabras de quien la vive: «Lo cargué mal.» */
  what: string
  /** Qué se hace en ese caso, en una línea. */
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border/60 py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <p className="min-w-0 max-w-prose text-sm text-pretty">
        <span className="font-semibold">{what}</span>{' '}
        <span className="text-muted-foreground">{children}</span>
      </p>
      {action ? <div className="shrink-0 [&>*]:w-full sm:[&>*]:w-auto">{action}</div> : null}
    </div>
  )
}

export function FixBlock({
  tenantSlug,
  base,
  doc,
  canWrite,
  actions,
  arcaEmitted,
  arcaCreditNoteHref,
  arcaSibling,
  siblings,
  appliedCents,
  today,
  minDate,
  ivaMode,
  extraNotes,
}: {
  tenantSlug: string
  /** `/<bar>/administracion`. */
  base: string
  doc: DocumentDetail
  canWrite: boolean
  /** Lo que deja `documentActions`, ya sin lo que frena ARCA. */
  actions: DocumentActions
  /** La factura ya está en ARCA (producción, con CAE): no se anula desde los libros. */
  arcaEmitted: boolean
  /** «Anularla con una nota de crédito», emitida también con ARCA. */
  arcaCreditNoteHref: string | null
  /** Se guardó junto con una factura que ya está en ARCA: anularlo la anularía. */
  arcaSibling: DocumentLink | null
  /** Lo que se guardó junto y sigue vigente («Pago #126»). */
  siblings: readonly string[]
  appliedCents: number | null
  today: string
  /** El primer día que admite «Anular con fecha de hoy». */
  minDate: string
  ivaMode: 'adjustment_only' | 'negative_row' | null
  /** Avisos que se suman a los dos diálogos de anulación. */
  extraNotes: readonly string[]
}) {
  if (!canWrite || doc.status !== 'posted') return null

  const sales = doc.kind === 'sales_invoice' || doc.kind === 'sales_debit_note'
  const purchase = doc.kind === 'purchase' || doc.kind === 'purchase_debit_note'
  // Una devolución o un descuento no se anulan: se cargan con la nota de crédito.
  const openCreditNote: 'purchase' | 'sales' | null =
    actions.void && doc.partyId ? (purchase ? 'purchase' : sales ? 'sales' : null) : null
  const closed = actions.reverse || actions.creditNote !== null || actions.adjustment
  const month = doc.period ? formatMonthLabel(doc.period.month) : 'Ese mes'
  const returned = (type: 'purchase' | 'sales') =>
    type === 'sales'
      ? 'Le devolví plata o le hice un descuento.'
      : 'Me devolvieron plata o me hicieron un descuento.'

  const rows: ReactNode[] = []

  if (arcaEmitted) {
    // Una nota de crédito que ya está en ARCA no se corrige con otra nota de crédito (ni hay
    // botón para eso): se dice lo que es y con qué se corrige.
    const creditNote = doc.kind === 'sales_credit_note'
    rows.push(
      <FixRow
        key="arca"
        what={
          creditNote
            ? 'Esta nota de crédito ya está en ARCA.'
            : doc.kind === 'sales_debit_note'
              ? 'Esta nota de débito ya está en ARCA.'
              : 'Esta factura ya está en ARCA.'
        }
        action={
          arcaCreditNoteHref ? (
            <Button asChild variant="outline" className={OUTLINE_BUTTON}>
              <Link href={arcaCreditNoteHref}>
                <FileText className="size-4" aria-hidden />
                Anularla con una nota de crédito
              </Link>
            </Button>
          ) : null
        }
      >
        {creditNote
          ? 'No se anula desde acá: se corrige emitiendo una nota de débito, también con ARCA.'
          : 'No se anula desde acá: se corrige emitiendo una nota de crédito, también con ARCA.'}
      </FixRow>,
    )
  }

  if (actions.void) {
    rows.push(
      <FixRow
        key="void"
        what="Lo cargué mal."
        action={
          <VoidDocumentButton
            tenantSlug={tenantSlug}
            documentId={doc.id}
            title={doc.title}
            siblings={siblings}
            appliedCents={appliedCents}
            extraNotes={extraNotes}
          />
        }
      >
        Anulalo y cargalo de nuevo: no existe «editar». Queda anulado con tu nombre y el motivo; no
        se borra.
      </FixRow>,
    )
  }
  if (openCreditNote) {
    rows.push(
      <FixRow
        key="credit-note"
        what={returned(openCreditNote)}
        action={
          <Button asChild variant="outline" className={OUTLINE_BUTTON}>
            <Link href={creditNoteHref(openCreditNote, base, doc)}>
              <FileText className="size-4" aria-hidden />
              Cargar la nota de crédito
            </Link>
          </Button>
        }
      >
        {openCreditNote === 'sales'
          ? 'Eso no se anula: se carga la nota de crédito que le hiciste.'
          : 'Eso no se anula: se carga la nota de crédito que te dieron.'}
      </FixRow>,
    )
  }

  if (actions.creditNote) {
    rows.push(
      <FixRow
        key="closed-credit-note"
        what={returned(actions.creditNote)}
        action={
          <Button asChild variant="outline" className={OUTLINE_BUTTON}>
            <Link href={creditNoteHref(actions.creditNote, base, doc)}>
              <FileText className="size-4" aria-hidden />
              Cargar una nota de crédito
            </Link>
          </Button>
        }
      >
        {actions.creditNote === 'sales'
          ? `Cargá la nota de crédito que le hiciste: ${month} no cambia.`
          : `Cargá la nota de crédito que te dieron: ${month} no cambia.`}
      </FixRow>,
    )
  }
  if (actions.reverse) {
    rows.push(
      <FixRow
        key="reverse"
        what="Lo cargué mal (estaba dos veces, era de otro proveedor)."
        action={
          <ReverseDocumentButton
            tenantSlug={tenantSlug}
            documentId={doc.id}
            title={doc.title}
            documentMonth={doc.accountingDate}
            today={today}
            minDate={minDate}
            ivaMode={ivaMode}
            hasFiscal={doc.fiscalVouchers.some((v) => !v.voided)}
            appliedCents={appliedCents}
            extraNotes={extraNotes}
          />
        }
      >
        {month} no cambia: se carga la anulación con fecha de hoy.
      </FixRow>,
    )
  }
  if (actions.adjustment) {
    rows.push(
      <FixRow
        key="adjustment"
        what="Es otra cosa."
        action={
          <Button asChild variant="outline" className={OUTLINE_BUTTON}>
            <Link href={`${base}/libros/asiento-manual?corrige=${doc.id}`}>
              <FilePenLine className="size-4" aria-hidden />
              Armar asiento de ajuste
            </Link>
          </Button>
        }
      >
        Lo corrige la contadora con un asiento de ajuste.
      </FixRow>,
    )
  }

  if (arcaSibling) {
    rows.push(
      <FixRow key="arca-sibling" what="Se cargó junto con una factura emitida con ARCA.">
        Anularlo anularía también esa factura, que ya está en ARCA. Si hubo un error, corregí la
        factura con una nota de crédito desde{' '}
        <Link
          href={`${base}/comprobantes/${arcaSibling.id}`}
          className={cn(
            'rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground pointer-coarse:py-2.5',
            FOCUS,
          )}
        >
          <VoucherText text={`${arcaSibling.title} #${arcaSibling.seq}`} />
        </Link>
        .
      </FixRow>,
    )
  }

  if (rows.length === 0) return null

  return (
    <Panel title="¿Hay algo mal?">
      {closed ? (
        <p className="mb-4 flex items-start gap-2 text-sm text-pretty">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            <span className="font-medium">{month} está cerrado:</span> este comprobante ya no se
            puede cambiar. ¿Qué pasó?
          </span>
        </p>
      ) : null}
      <div>{rows}</div>
    </Panel>
  )
}
