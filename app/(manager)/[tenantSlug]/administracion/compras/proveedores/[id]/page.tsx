import { notFound, redirect } from 'next/navigation'
import { type ReactNode, Suspense } from 'react'
import { SimplePage } from '@/components/administracion/planilla'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import {
  exportHref,
  getAccountingSettings,
  getParty,
  getPartyPosition,
  listAccounts,
  settleQuery,
} from '@/lib/accounting/queries'
import { getArcaLookupStatus, getPadronVerification } from '@/lib/arca/queries'
import { todayInCordoba } from '@/lib/dates'
import { formatCuit, normalizeCuit } from '@/lib/fiscal'
import { SupplierAccountProvider } from '../../_components/supplier-account-picker'
import { isPurchaseImputation } from '../../_lib/accounts'
import { firstParam, isUuidLike, supplierHref } from '../../_lib/links'
import { requireComprasAccess } from '../../_lib/page-access'
import { creditPairs } from '../../_lib/payment-plan'
import { supplierAccountOptions, supplierCategoryChoices } from '../../_lib/suppliers'
import { PURCHASE_VOUCHER_OPTIONS } from '../../_lib/vouchers'
import { ArcaVerification } from './_components/arca-verification'
import { DataTab } from './_components/data-tab'
import { PendingTab } from './_components/pending-tab'
import { StatementSkeleton, StatementTab } from './_components/statement-tab'
import { SupplierEditProvider } from './_components/supplier-edit'
import { SupplierHead } from './_components/supplier-head'

export const metadata = { title: 'Proveedor' }

/**
 * La cuenta corriente de un proveedor: su nombre, [Ficha] [Compra] [Pagar], el totalizador (Saldo ·
 * Plazo · Va a) y la tabla de siempre (Fecha · Comprobante · Vence · Debe · Haber · Saldo). Debajo, lo
 * que está sin pagar y lo que hay a favor.
 *
 * `?tab=datos` es la ficha (contactos, días de entrega, CUIT), con el botón «Ficha». Los otros dos
 * valores de antes (`estado`, `pendientes`) muestran la cuenta, como cualquier otro.
 *
 * El selector de categoría y «Editar datos» se montan UNA vez para toda la página (se abren desde el
 * totalizador y desde la ficha), solo para quien carga.
 */
export default async function SupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug, id } = await params
  const sp = await searchParams
  const ficha = firstParam(sp.tab) === 'datos'
  const baseHref = supplierHref(tenantSlug, id)
  const { access, canWrite } = await requireComprasAccess(tenantSlug, baseHref)
  if (!isUuidLike(id)) notFound()

  const tenantId = access.tenant.id
  const party = await getParty(tenantId, id)
  if (!party) notFound()
  // Clientes, tarjetas, billeteras y plataformas tienen su ficha en Ventas.
  if (party.group === 'receivables') redirect(`/${tenantSlug}/administracion/ventas/clientes/${id}`)

  const today = todayInCordoba()
  // «Verificado en ARCA el …» (la última consulta guardada de su CUIT). Si no se
  // puede leer (p. ej. la base todavía no tiene la tabla), no se muestra.
  const cuit =
    (party.taxIdType === 'cuit' || party.taxIdType === 'cuil') && party.taxId
      ? normalizeCuit(party.taxId)
      : null
  // El plan y ARCA, para quien carga y en las dos vistas: la categoría y «Editar datos» se abren
  // también desde el totalizador. Si fallan, la página se ve igual, sin esos dos botones.
  const [positionOutcome, verificationOutcome, accounts, arcaLookup, settingsOutcome] =
    await Promise.all([
      settleQuery(getPartyPosition(tenantId, { partyId: id, group: 'payables' })),
      cuit && cuit.length === 11 ? settleQuery(getPadronVerification(tenantId, cuit)) : null,
      canWrite ? settleQuery(listAccounts(tenantId)) : null,
      canWrite ? settleQuery(getArcaLookupStatus(tenantId)) : null,
      settleQuery(getAccountingSettings(tenantId)),
    ])
  // Sin los saldos iniciales, «al día» es por lo cargado: el totalizador lo aclara.
  const openingPending = settingsOutcome.ok && settingsOutcome.data?.openingStatus === 'pending'
  const position = positionOutcome.ok ? positionOutcome.data : null
  const verification = verificationOutcome?.ok ? verificationOutcome.data : null
  const shown = party.tradeName ?? party.name

  const pairs = position
    ? creditPairs(
        position.debtItems.map((i) => ({
          lineId: i.lineId,
          label: i.documentLabel,
          accountId: i.accountId,
          openCents: i.openCents,
          targetCents: i.openCents,
          dueDate: i.dueDate,
          entryDate: i.entryDate,
        })),
        position.creditItems.map((i) => ({
          lineId: i.lineId,
          label: i.documentLabel,
          accountId: i.accountId,
          openCents: i.openCents,
          entryDate: i.entryDate,
        })),
      )
    : []

  const plan = accounts?.ok ? accounts.data : null
  const hasBalance = (position?.debtCents ?? 0) > 0 || (position?.creditCents ?? 0) > 0

  const body = (
    <>
      <SupplierHead
        tenantSlug={tenantSlug}
        party={party}
        position={position}
        positionError={positionOutcome.ok ? null : positionOutcome.message}
        canWrite={canWrite}
        canPickCategory={plan !== null}
        baseHref={baseHref}
        ficha={ficha}
        exportHref={exportHref(tenantSlug, 'estado-de-cuenta', {
          participe: party.id,
          desde: `${today.slice(0, 4)}-01-01`,
          hasta: today,
        })}
        exportFileName={`estado-de-cuenta-${today}.csv`}
        openingPending={openingPending}
      />

      {ficha ? (
        <DataTab
          tenantSlug={tenantSlug}
          party={party}
          canWrite={canWrite}
          hasBalance={hasBalance}
          verification={verification ? <ArcaVerification verification={verification} /> : null}
        />
      ) : (
        <>
          <Suspense
            key={`${firstParam(sp.periodo)}|${firstParam(sp.despues)}`}
            fallback={<StatementSkeleton />}
          >
            <StatementTab
              tenantId={tenantId}
              tenantSlug={tenantSlug}
              partyId={party.id}
              partyName={shown}
              baseHref={baseHref}
              sp={sp}
              today={today}
              canWrite={canWrite}
              unusedCreditCents={position?.creditCents ?? 0}
            />
          </Suspense>
          {position ? (
            <PendingTab
              tenantSlug={tenantSlug}
              partyId={party.id}
              position={position}
              pairs={pairs}
              today={today}
              canWrite={canWrite}
            />
          ) : null}
        </>
      )}
    </>
  )

  return (
    <SimplePage>
      {canWrite ? (
        <EditScope
          tenantSlug={tenantSlug}
          party={party}
          plan={plan}
          arcaLookup={arcaLookup?.ok ? arcaLookup.data : null}
        >
          {body}
        </EditScope>
      ) : (
        body
      )}
      <QuickActionsBar />
    </SimplePage>
  )
}

/**
 * Los dos diálogos de la página, montados una sola vez: «¿En qué le comprás a…?»
 * (si se pudo leer el plan) y «Editar datos». Los botones que los abren viven
 * en el totalizador y en la ficha.
 */
function EditScope({
  tenantSlug,
  party,
  plan,
  arcaLookup,
  children,
}: {
  tenantSlug: string
  party: NonNullable<Awaited<ReturnType<typeof getParty>>>
  plan: Awaited<ReturnType<typeof listAccounts>> | null
  arcaLookup: Awaited<ReturnType<typeof getArcaLookupStatus>> | null
  children: ReactNode
}) {
  const options = plan ?? []
  const imputable = new Set(options.filter(isPurchaseImputation).map((a) => a.id))
  // Las categorías como botones: las mismas de «Elegir categoría» y de «Editar datos».
  const categories = plan === null ? null : supplierCategoryChoices(plan)
  const edit = (
    <SupplierEditProvider
      tenantSlug={tenantSlug}
      categories={categories}
      values={{
        id: party.id,
        updatedAt: party.updatedAt,
        kind: party.kind,
        name: party.name,
        tradeName: party.tradeName,
        taxIdType: party.taxIdType,
        taxId: party.taxId
          ? party.taxIdType === 'cuit' || party.taxIdType === 'cuil'
            ? formatCuit(party.taxId)
            : party.taxId
          : null,
        ivaCondition: party.ivaCondition,
        email: party.email,
        phone: party.phone,
        address: party.address,
        paymentTermDays: party.paymentTermDays,
        defaultAccountId: party.defaultAccountId,
        defaultVoucherType: party.defaultVoucherType,
        notes: party.notes,
        contacts: party.contacts,
        deliveryDays: party.deliveryDays,
        orderLeadDays: party.orderLeadDays,
      }}
      accounts={options
        .filter((a) => imputable.has(a.id) || a.id === party.defaultAccountId || !a.postable)
        .map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          postable: a.postable && imputable.has(a.id),
          active: a.active,
          description: a.description,
        }))}
      voucherOptions={PURCHASE_VOUCHER_OPTIONS}
      arcaLookup={arcaLookup}
    >
      {children}
    </SupplierEditProvider>
  )
  if (plan === null || categories === null) return edit
  return (
    <SupplierAccountProvider
      tenantSlug={tenantSlug}
      accounts={supplierAccountOptions(
        plan,
        new Set(party.defaultAccountId ? [party.defaultAccountId] : []),
      )}
      categories={categories}
      rows={[
        {
          partyId: party.id,
          name: party.name,
          displayName: party.tradeName ?? party.name,
          kind: party.kind,
          updatedAt: party.updatedAt,
          accountId: party.defaultAccountId,
        },
      ]}
    >
      {edit}
    </SupplierAccountProvider>
  )
}
