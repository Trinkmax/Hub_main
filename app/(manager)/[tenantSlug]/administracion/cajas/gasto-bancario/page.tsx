import { ArrowLeft, Landmark } from 'lucide-react'
import Link from 'next/link'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { firstLoadableDay, firstParam } from '@/components/administracion/cajas-ventas/periods'
import { ReadOnlyBadge, ReadOnlyNotice } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { loadPostingCatalog, loadPostingContext } from '@/lib/accounting/context'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { isRealIsoDay } from '@/lib/dates'
import { BankExpenseForm, type BankTreasury } from './_components/bank-expense-form'

export const metadata = { title: 'Gasto bancario' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function GastoBancarioPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`
  const { access, canWrite } = await requireAdminPage(tenantSlug, `${base}/cajas/gasto-bancario`)

  const back = (
    <Link
      href={`${base}/cajas`}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3" />
      Volver a cajas y bancos
    </Link>
  )
  const header = (
    <PageHeader
      eyebrow="Administración"
      title={
        <>
          Gasto bancario <ReadOnlyBadge />
        </>
      }
      description="Comisiones, impuestos y cargos que debitaron el banco, la billetera o la tarjeta. Copialos del resumen."
    />
  )

  if (!canWrite) {
    return (
      <PageShell width="comfortable">
        {back}
        {header}
        <ReadOnlyNotice
          description="Acá se cargan los gastos e impuestos que debita el banco. Con Contabilidad los ves en los movimientos de cada cuenta."
          href={`${base}/cajas`}
          linkLabel="Ir a Cajas y bancos"
        />
      </PageShell>
    )
  }

  const tenantId = access.tenant.id
  const [catalog, ctx, firstOpenDate] = await Promise.all([
    loadPostingCatalog(tenantId),
    loadPostingContext(tenantId),
    loadFirstOpenDate(tenantId),
  ])
  const partyTaxIds = new Map(catalog.parties.map((p) => [p.id, p.taxId]))
  // El efectivo no tiene débitos del banco: bancos, billeteras, tarjetas y otras cuentas.
  const treasuries: BankTreasury[] = catalog.treasuries
    .filter((t) => t.active && t.kind !== 'cash')
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es'))
    .map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      balanceCents: t.balanceCents,
      active: t.active,
      bankHasCuit: t.bankPartyId !== null && Boolean(partyTaxIds.get(t.bankPartyId)),
    }))

  if (treasuries.length === 0) {
    return (
      <PageShell width="comfortable">
        {back}
        {header}
        <EmptyState
          icon={Landmark}
          title="No hay bancos ni billeteras cargados"
          description="Para cargar un gasto bancario, primero agregá la cuenta del banco en Ajustes."
          action={
            <Button asChild>
              <Link href={`${base}/ajustes?tab=cajas`}>Ir a Ajustes</Link>
            </Button>
          }
        />
      </PageShell>
    )
  }

  const today = catalog.today
  const minDate = firstLoadableDay({
    booksStartDate: catalog.settings.booksStartDate,
    firstOpenDate,
  })
  // Lo que viene de «Ajustar saldo» (Es por gastos del banco): la cuenta, el día y la diferencia.
  const caja = firstParam(sp.caja)
  const fecha = firstParam(sp.fecha)
  const total = firstParam(sp.total)
  const prefill = {
    treasuryId: caja && UUID_RE.test(caja) && treasuries.some((t) => t.id === caja) ? caja : null,
    date: fecha && isRealIsoDay(fecha) && fecha >= minDate && fecha <= today ? fecha : null,
    totalCents: total && /^\d{1,15}$/.test(total) && Number(total) > 0 ? Number(total) : null,
  }

  return (
    <PageShell width="comfortable">
      {back}
      {header}
      <BankExpenseForm
        tenantSlug={tenantSlug}
        ctx={ctx}
        firstOpenDate={firstOpenDate}
        minDate={minDate}
        today={today}
        treasuries={treasuries}
        accounts={catalog.accounts.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          postable: a.postable,
          active: a.active,
          description: a.description,
        }))}
        prefill={prefill}
      />
    </PageShell>
  )
}
