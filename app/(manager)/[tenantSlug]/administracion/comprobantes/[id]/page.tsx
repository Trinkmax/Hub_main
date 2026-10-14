import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Fragment } from 'react'
import { EntryPreview, type EntryPreviewData } from '@/components/administracion/entry-preview'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { StatusPill } from '@/components/administracion/kit/status-pill'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { VoucherText } from '@/components/administracion/voucher-text'
import {
  type DocumentDetail,
  type DocumentLink,
  getAccountingSettings,
  getDocument,
  getRecurringExpense,
  listRecurringExpenses,
  listTreasuryAccounts,
  settleQuery,
} from '@/lib/accounting/queries'
import { listDocumentAttachments } from '@/lib/accounting/queries/attachments'
import { getDocumentOrigin } from '@/lib/accounting/queries/document-origin'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { getArcaVoucherCard } from '@/lib/arca/emit-queries'
import { maxIsoDay, todayInCordoba } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { supplierHref } from '../../compras/_lib/links'
import { QueryErrorBlock } from '../../libros/_components/report-error'
import { requireBooksAccess } from '../../libros/_lib/page-access'
import {
  documentBadge,
  documentHeading,
  documentHero,
  documentLinks,
  type HeadingPart,
  linksTitle,
  recurringCandidates,
  type StoryContext,
  voidNotes,
} from '../_lib/document-story'
import {
  appliedByOthers,
  backLinkFor,
  creditNoteHref,
  documentActions,
} from '../_lib/document-view'
import { DocumentHero } from './_components/document-hero'
import { DocumentLinks } from './_components/document-links'
import { DocumentTicket } from './_components/document-ticket'
import { FixBlock } from './_components/fix-block'

/**
 * La ficha de un comprobante: el mismo papel que se vio antes de guardar, ya
 * archivado. A la derecha el ticket con su sello; a la izquierda, un número
 * con lo que pasó con la plata y el botón del momento, y debajo lo que el
 * papel tiene unido (o le falta), cómo se corrige y cómo queda en los libros.
 *
 * En el celular va en ese mismo orden, en una columna: qué pasó con la plata →
 * el papel → con qué está unido → ¿hay algo mal? → los libros.
 *
 * Los textos salen de `_lib/document-story.ts` (puro, con tests); acá se leen
 * los datos y se arma la pantalla. Solo la lectura del comprobante puede tirar
 * la pantalla: las demás (fotos, ARCA, gasto fijo, cajas, archivo de origen)
 * fallan de a una y su bloque lo dice.
 */

export const metadata = { title: 'Comprobante' }

/** Los que pueden haberse emitido con ARCA desde la plataforma (diseño §3.2). */
const ARCA_KINDS = new Set(['sales_invoice', 'sales_debit_note', 'sales_credit_note'])

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function linkText(doc: DocumentLink): string {
  return `${doc.title} #${doc.seq}`
}

/**
 * La factura del mismo envío que ya está en ARCA (producción, con CAE), si hay. Si no se
 * puede leer, se sigue como siempre (igual que con la factura misma).
 */
async function arcaEmittedSibling(
  tenantId: string,
  siblings: readonly DocumentLink[],
): Promise<DocumentLink | null> {
  for (const sibling of siblings) {
    if (sibling.status !== 'posted' || !ARCA_KINDS.has(sibling.kind)) continue
    const card = await settleQuery(getArcaVoucherCard(tenantId, sibling.id))
    if (
      card.ok &&
      card.data?.environment === 'produccion' &&
      (card.data.status === 'posted' || card.data.status === 'authorized')
    ) {
      return sibling
    }
  }
  return null
}

/** Un dato de la línea de abajo del título; el partícipe es un link a su ficha. */
function HeadingItem({
  part,
  tenantSlug,
  base,
}: {
  part: HeadingPart
  tenantSlug: string
  base: string
}) {
  if (part.key !== 'party') {
    return (
      <span className={part.key === 'paper' ? 'font-medium text-foreground' : undefined}>
        {part.text}
      </span>
    )
  }
  const href = !part.partyId
    ? null
    : part.side === 'supplier'
      ? supplierHref(tenantSlug, part.partyId)
      : part.side === 'customer'
        ? `${base}/ventas/clientes/${part.partyId}`
        : null
  if (!href) return <span className="font-medium text-foreground">{part.text}</span>
  return (
    <Link
      href={href}
      className={cn(
        'rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground pointer-coarse:py-2.5',
        FOCUS,
      )}
    >
      {part.text}
    </Link>
  )
}

/**
 * La línea de abajo del título: lo que el título no dijo. Qué es y de quién van juntos;
 * el día y la referencia, también: en el celular son dos renglones (nunca un «·» colgando).
 */
function HeadingLine({
  parts,
  tenantSlug,
  base,
}: {
  parts: readonly HeadingPart[]
  tenantSlug: string
  base: string
}) {
  const what = parts.filter((p) => p.key === 'kind' || p.key === 'paper' || p.key === 'party')
  const when = parts.filter((p) => p.key === 'day' || p.key === 'seq')
  const cluster = (items: readonly HeadingPart[]) =>
    items.map((part, index) => (
      <Fragment key={part.key}>
        {index > 0 ? <span aria-hidden> · </span> : null}
        <HeadingItem part={part} tenantSlug={tenantSlug} base={base} />
      </Fragment>
    ))
  return (
    <p className="text-pretty">
      {what.length > 0 ? <span className="max-sm:block">{cluster(what)}</span> : null}
      {what.length > 0 && when.length > 0 ? (
        <span aria-hidden className="max-sm:hidden">
          {' · '}
        </span>
      ) : null}
      {when.length > 0 ? (
        <span className="tabular-nums max-sm:mt-0.5 max-sm:block">{cluster(when)}</span>
      ) : null}
    </p>
  )
}

function entryData(entry: NonNullable<DocumentDetail['entry']>): EntryPreviewData {
  return {
    documentRef: entry.id,
    description: entry.description,
    date: entry.entryDate,
    lines: entry.lines.map((l) => ({
      id: l.id,
      accountCode: l.accountCode,
      accountName: l.accountName,
      partyName: l.partyName,
      debitCents: l.side === 'debit' ? l.amountCents : null,
      creditCents: l.side === 'credit' ? l.amountCents : null,
      note: l.memo,
    })),
  }
}

export default async function ComprobantePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
}) {
  const { tenantSlug, id } = await params
  const base = `/${tenantSlug}/administracion`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, `${base}/comprobantes/${id}`)
  const tenantId = access.tenant.id
  const today = todayInCordoba()

  const result = await settleQuery(getDocument(tenantId, id))
  if (result.ok && !result.data) notFound()
  if (!result.ok || !result.data) {
    return (
      <AdmPage width="comfortable">
        <AdmHeader
          title="Comprobante"
          back={{ href: `${base}/compras?tab=comprobantes`, label: 'Volver a comprobantes' }}
        />
        <QueryErrorBlock
          code={result.ok ? 'error' : result.code}
          message={result.ok ? 'No pudimos cargar el comprobante.' : result.message}
        />
      </AdmPage>
    )
  }

  const doc = result.data
  // «¿Era un gasto fijo?»: solo vale preguntarlo a quien puede corregirlo, de una compra o un
  // gasto vigente de este mes que no está unido a ninguno.
  const askRecurring =
    canWrite &&
    doc.status === 'posted' &&
    (doc.kind === 'purchase' || doc.kind === 'expense') &&
    !doc.recurringExpenseId &&
    doc.accountingDate.slice(0, 7) === today.slice(0, 7)
  const hasTreasury = doc.lines.some((line) => line.treasuryAccountId !== null)

  // Todo lo demás se pide junto y ninguna lectura tira la pantalla.
  const [attachments, arcaOutcome, recurringOutcome, candidatesOutcome, treasuries, origin] =
    await Promise.all([
      // La foto o el PDF del comprobante.
      settleQuery(listDocumentAttachments(tenantId, doc.id)),
      // ¿Se emitió con ARCA desde la plataforma? Una factura que ya está en ARCA (producción)
      // no se anula desde los libros: se corrige con una nota de crédito emitida con ARCA.
      ARCA_KINDS.has(doc.kind) ? settleQuery(getArcaVoucherCard(tenantId, doc.id)) : null,
      doc.recurringExpenseId
        ? settleQuery(getRecurringExpense(tenantId, doc.recurringExpenseId))
        : null,
      askRecurring ? settleQuery(listRecurringExpenses(tenantId, { today })) : null,
      // Para saber si una caja es la tarjeta de la empresa.
      hasTreasury ? settleQuery(listTreasuryAccounts(tenantId, { includeInactive: true })) : null,
      // ¿Vino de un archivo importado?
      settleQuery(getDocumentOrigin(tenantId, doc.id)),
    ])

  const arcaCard = arcaOutcome?.ok ? arcaOutcome.data : null
  const arcaEmitted =
    arcaCard !== null &&
    arcaCard.environment === 'produccion' &&
    (arcaCard.status === 'posted' || arcaCard.status === 'authorized')
  const baseActions = documentActions(doc, canWrite)
  // Un cobro cargado en el mismo envío que una factura emitida con ARCA: «Anular» anula todo
  // el envío (`withBundle`) y con él esa factura, que ya está en ARCA. Tampoco se ofrece.
  const arcaSibling =
    !arcaEmitted && baseActions.void && !ARCA_KINDS.has(doc.kind)
      ? await arcaEmittedSibling(tenantId, doc.bundleSiblings)
      : null
  const actions = arcaEmitted
    ? { ...baseActions, void: false, reverse: false, creditNote: null, adjustment: false }
    : arcaSibling
      ? { ...baseActions, void: false }
      : baseActions
  const arcaCreditNoteHref =
    arcaEmitted &&
    canWrite &&
    doc.status === 'posted' &&
    (doc.kind === 'sales_invoice' || doc.kind === 'sales_debit_note')
      ? creditNoteHref('sales', base, doc)
      : null
  const [settings, firstOpenDate] = actions.reverse
    ? await Promise.all([settleQuery(getAccountingSettings(tenantId)), loadFirstOpenDate(tenantId)])
    : [null, null]

  const appliedCents = appliedByOthers(doc.kind)
    ? doc.allocations.reduce((sum, a) => (a.voidedOn ? sum : sum + a.amountCents), 0)
    : null
  const siblings = doc.bundleSiblings.filter((s) => s.status === 'posted').map(linkText)

  const ctx: StoryContext = {
    today,
    canWrite,
    treasuryKinds: treasuries?.ok ? new Map(treasuries.data.map((t) => [t.id, t.kind])) : null,
    recurring: !doc.recurringExpenseId
      ? undefined
      : recurringOutcome?.ok
        ? recurringOutcome.data
        : 'error',
    candidates: candidatesOutcome?.ok
      ? recurringCandidates(doc, candidatesOutcome.data, today)
      : [],
    origin: origin.ok ? origin.data : null,
    attachments: attachments.ok ? attachments.data.length : null,
    arca:
      arcaOutcome === null
        ? null
        : !arcaOutcome.ok
          ? 'off'
          : arcaOutcome.data === null
            ? null
            : arcaOutcome.data.cae !== null
              ? 'linked'
              : 'ask',
  }

  const heading = documentHeading(doc)
  const badge = documentBadge(doc, today)
  const hero = documentHero(doc, ctx)
  const nodes = documentLinks(doc, ctx)

  return (
    <AdmPage width="comfortable">
      <AdmHeader
        back={backLinkFor(doc.kind, base, doc.accountingDate)}
        title={<VoucherText text={heading.title} />}
        description={<HeadingLine parts={heading.parts} tenantSlug={tenantSlug} base={base} />}
        badge={
          <>
            {badge ? <StatusPill tone={badge.tone}>{badge.text}</StatusPill> : null}
            <ReadOnlyBadge show={!canWrite} />
          </>
        }
      />

      {/* La grilla del cierre del día: el papel siempre a la derecha, pegado. En el celular,
          una columna en el orden del DOM. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <DocumentHero
            hero={hero}
            base={base}
            arcaPending={
              canWrite && Boolean(arcaCard && (arcaCard.canReconcile || arcaCard.canPost))
            }
          />
        </div>

        <aside className="min-w-0 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {/* Si la pantalla es baja, el papel se desliza adentro de su columna. El margen
              negativo deja lugar a su sombra, que el recorte del scroll se comería. */}
          <div className="lg:-mx-3 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:px-3 lg:pb-4 lg:[scrollbar-width:thin]">
            <DocumentTicket doc={doc} ctx={ctx} />
          </div>
        </aside>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-2">
          <DocumentLinks
            tenantSlug={tenantSlug}
            base={base}
            documentId={doc.id}
            title={linksTitle(nodes, doc, today)}
            nodes={nodes}
            canWrite={canWrite}
            attachments={attachments}
            arcaOutcome={arcaOutcome}
          />

          <FixBlock
            tenantSlug={tenantSlug}
            base={base}
            doc={doc}
            canWrite={canWrite}
            actions={actions}
            arcaEmitted={arcaEmitted}
            arcaCreditNoteHref={arcaCreditNoteHref}
            arcaSibling={canWrite ? arcaSibling : null}
            siblings={siblings}
            appliedCents={appliedCents}
            today={today}
            minDate={maxIsoDay(firstOpenDate ?? today, doc.accountingDate)}
            ivaMode={settings?.ok && settings.data ? settings.data.closedPeriodVoidIvaMode : null}
            extraNotes={voidNotes(doc, ctx)}
          />

          {doc.entry ? (
            // Plegado para quien carga; abierto para la contadora, que viene a esto.
            <div id="libros" className="scroll-mt-28">
              <EntryPreview
                entries={[entryData(doc.entry)]}
                label="Ver cómo queda en los libros"
                defaultOpen={!canWrite}
              />
            </div>
          ) : null}
        </div>
      </div>
    </AdmPage>
  )
}
