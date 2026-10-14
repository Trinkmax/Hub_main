import { ArrowRight, Landmark } from 'lucide-react'
import Link from 'next/link'
import { requireAdminPage } from '@/components/administracion/cajas-ventas/page-access'
import { firstLoadableDay, firstParam } from '@/components/administracion/cajas-ventas/periods'
import { AdmHeader, AdmPage, EmptyTeach } from '@/components/administracion/kit'
import { ReadOnlyBadge, ReadOnlyNotice } from '@/components/administracion/read-only'
import { Button } from '@/components/ui/button'
import { loadPostingCatalog, loadPostingContext } from '@/lib/accounting/context'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { isRealIsoDay } from '@/lib/dates'
import { BankExpenseForm, type BankTreasury } from './_components/bank-expense-form'

export const metadata = { title: 'Gastos del banco' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Gastos del banco: las comisiones, los impuestos y los cargos que el banco, la
 * billetera o la tarjeta se cobraron solos. Se copian del resumen. Es una
 * pantalla de carga: la contadora ve el aviso de solo lectura y a dónde ir a
 * mirarlos.
 */
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

  const header = (
    <AdmHeader
      back={{ href: `${base}/cajas`, label: 'Cajas y bancos' }}
      title="Gastos del banco"
      badge={<ReadOnlyBadge />}
      // En el celular cada renglón de arriba es un campo menos a la vista, y el primer paso
      // ya dice de qué se trata: la bajada queda para pantallas con lugar (como en el cierre).
      description={
        <span className="hidden sm:inline">
          Comisiones, impuestos y cargos que el banco, la billetera o la tarjeta se cobraron solos.
          Se copian del resumen.
        </span>
      }
    />
  )

  if (!canWrite) {
    return (
      <AdmPage width="comfortable">
        {header}
        <ReadOnlyNotice
          description="Acá se cargan las comisiones y los impuestos que debita el banco. Vos los ves en los movimientos de cada cuenta."
          href={`${base}/cajas`}
          linkLabel="Ir a Cajas y bancos"
        />
      </AdmPage>
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
      <AdmPage width="comfortable">
        {header}
        <EmptyTeach
          icon={Landmark}
          title="No hay bancos ni billeteras cargados"
          action={
            <Button asChild className="h-11 gap-2">
              <Link href={`${base}/ajustes?tab=cajas`}>
                Agregar una cuenta
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          }
        >
          Para cargar gastos del banco, primero agregá la cuenta.
        </EmptyTeach>
      </AdmPage>
    )
  }

  const today = catalog.today
  const minDate = firstLoadableDay({
    booksStartDate: catalog.settings.booksStartDate,
    firstOpenDate,
  })
  // Lo que viene de contar la caja («Son gastos del banco»): la cuenta, el día y la diferencia.
  const caja = firstParam(sp.caja)
  const fecha = firstParam(sp.fecha)
  const total = firstParam(sp.total)
  const prefill = {
    treasuryId: caja && UUID_RE.test(caja) && treasuries.some((t) => t.id === caja) ? caja : null,
    date: fecha && isRealIsoDay(fecha) && fecha >= minDate && fecha <= today ? fecha : null,
    totalCents: total && /^\d{1,15}$/.test(total) && Number(total) > 0 ? Number(total) : null,
  }
  const hasBank = treasuries.some((t) => t.kind === 'bank')

  return (
    <AdmPage width="comfortable">
      {header}
      {hasBank ? (
        <p className="text-sm text-muted-foreground text-pretty">
          ¿Tenés el archivo del banco? Se carga solo:{' '}
          <Link
            href={`${base}/importar/banco`}
            className="rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:py-3"
          >
            subí los movimientos del banco
          </Link>
          .
        </p>
      ) : null}
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
    </AdmPage>
  )
}
