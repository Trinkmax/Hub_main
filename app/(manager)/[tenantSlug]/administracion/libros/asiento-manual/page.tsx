import { TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import type { AccountOption } from '@/components/administracion/account-combobox'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import type { PartyOption } from '@/components/administracion/party-combobox'
import { ReadOnlyBadge, ReadOnlyNotice } from '@/components/administracion/read-only'
import { loadPostingCatalog, tryLoadPostingContext } from '@/lib/accounting/context'
import { getDocument, listFiscalYears, settleQuery } from '@/lib/accounting/queries'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { formatIsoDay, formatMonthLabel, monthOf, todayInCordoba } from '@/lib/dates'
import { QueryErrorBlock } from '../_components/report-error'
import { requireBooksAccess } from '../_lib/page-access'
import { firstParam } from '../_lib/periods'
import { type InitialLine, ManualEntryForm, type ManualKind } from './_components/manual-entry-form'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const KIND_PARAMS: Readonly<Record<string, ManualKind>> = {
  ajuste: 'adjustment',
  sueldos: 'payroll',
  otro: 'manual',
  'ajuste-cierre': 'fy_adjustment',
}

type SearchParams = Record<string, string | string[] | undefined>

/** `?tipo=sueldos` es «Sueldos del mes»; lo demás, «Asiento manual». */
export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  return { title: firstParam(sp.tipo) === 'sueldos' ? 'Sueldos del mes' : 'Asiento manual' }
}

/**
 * Asiento manual y «Sueldos del mes» (`?tipo=sueldos`): una sola pantalla de
 * carga con dos caras (las dibuja `ManualEntryForm`, que también pone el
 * encabezado: el título cambia con el tipo sin recargar). La contadora no carga:
 * ve a dónde ir a mirar los asientos.
 */
export default async function AsientoManualPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<SearchParams>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const books = `${base}/libros`
  const path = `${books}/asiento-manual`
  const { access, canWrite } = await requireBooksAccess(tenantSlug, path)
  const rawKind = firstParam(sp.tipo)
  const title = rawKind === 'sueldos' ? 'Sueldos del mes' : 'Asiento manual'

  if (!canWrite) {
    return (
      <AdmPage width="comfortable">
        <AdmHeader
          back={{ href: books, label: 'Libros' }}
          title={title}
          badge={<ReadOnlyBadge className="ml-0" />}
        />
        <ReadOnlyNotice
          description="Esta pantalla es para cargar asientos. Con Contabilidad podés verlos todos en el libro diario."
          href={`${books}/diario`}
          linkLabel="Ir al libro diario"
        />
      </AdmPage>
    )
  }

  const tenantId = access.tenant.id
  const today = todayInCordoba()
  const rawCorrige = firstParam(sp.corrige)
  const corrigeId = rawCorrige && UUID_RE.test(rawCorrige) ? rawCorrige : null

  const [loaded, firstOpenDate, years, corrected] = await Promise.all([
    tryLoadPostingContext(tenantId),
    loadFirstOpenDate(tenantId),
    settleQuery(listFiscalYears(tenantId)),
    corrigeId ? settleQuery(getDocument(tenantId, corrigeId)) : Promise.resolve(null),
  ])

  if (!loaded.ok) {
    return (
      <AdmPage width="comfortable">
        <AdmHeader back={{ href: books, label: 'Libros' }} title={title} />
        <QueryErrorBlock code={loaded.state.code} message={loaded.state.message} />
      </AdmPage>
    )
  }
  // Ya leído por `tryLoadPostingContext` (cacheado por pedido): no es otra llamada.
  const catalog = await loadPostingCatalog(tenantId)

  // El buscador: solo las cuentas que se pueden usar en un asiento manual.
  const accounts: AccountOption[] = catalog.accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    // La madre real: una cuenta movida de grupo conserva su código (#16).
    parentId: a.parentId,
    postable: a.postable && a.manualSelectable,
    active: a.active,
    description: a.description,
  }))
  const parties: PartyOption[] = catalog.parties.map((p) => ({
    id: p.id,
    name: p.name,
    tradeName: p.tradeName,
    taxId: p.taxId,
    active: p.active,
  }))

  // «Ajuste de cierre de ejercicio»: desde el último mes de un ejercicio abierto (va al 31/12).
  const fyYear = years.ok
    ? years.data.find((y) => y.status === 'open' && monthOf(today) >= monthOf(y.endDate))
    : undefined
  const fyAdjustment = fyYear
    ? {
        endDate: fyYear.endDate,
        label: `${formatIsoDay(fyYear.startDate)} al ${formatIsoDay(fyYear.endDate)}`,
      }
    : null

  // «Armar asiento de ajuste» desde un comprobante de un mes cerrado: sus líneas al revés.
  const doc = corrected?.ok ? corrected.data : null
  const canCorrect = Boolean(
    doc && doc.status === 'posted' && doc.period?.status === 'closed' && doc.entry,
  )
  const initialLines: InitialLine[] =
    canCorrect && doc?.entry
      ? doc.entry.lines.map((l) => ({
          accountId: l.accountId,
          debitCents: l.side === 'credit' ? l.amountCents : null,
          creditCents: l.side === 'debit' ? l.amountCents : null,
          partyId: l.partyId,
          dueDate: null,
          memo: l.memo ?? '',
        }))
      : []

  const kindParam = rawKind ? KIND_PARAMS[rawKind] : undefined
  const initialKind: ManualKind =
    kindParam === 'fy_adjustment' && !fyAdjustment ? 'adjustment' : (kindParam ?? 'adjustment')

  return (
    <ManualEntryForm
      tenantSlug={tenantSlug}
      ctx={loaded.ctx}
      accounts={accounts}
      parties={parties}
      firstOpenDate={firstOpenDate}
      today={today}
      fyAdjustment={fyAdjustment}
      initialKind={initialKind}
      initialLines={initialLines}
      backHref={books}
      notice={
        corrigeId && !canCorrect ? (
          <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-pretty text-warning-text">
              {doc
                ? doc.status !== 'posted'
                  ? 'Ese comprobante está anulado: no hace falta ajustarlo.'
                  : 'Ese comprobante es de un mes abierto: anulalo o corregilo desde su detalle.'
                : 'No encontramos ese comprobante.'}{' '}
              {doc ? (
                <Link
                  href={`${base}/comprobantes/${doc.id}`}
                  className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Ver el comprobante
                </Link>
              ) : null}
            </p>
          </div>
        ) : null
      }
      corrects={
        canCorrect && doc
          ? {
              id: doc.id,
              label: `${doc.title} #${doc.seq}`,
              month: doc.period ? formatMonthLabel(doc.period.month) : null,
              description: `Ajuste de ${doc.title}`,
            }
          : null
      }
    />
  )
}
