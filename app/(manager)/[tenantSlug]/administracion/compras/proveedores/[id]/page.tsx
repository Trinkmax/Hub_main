import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { type ReactNode, Suspense } from 'react'
import { AdmPage, PanelError, type ViewPillItem, ViewPills } from '@/components/administracion/kit'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import {
  exportHref,
  getParty,
  getPartyPosition,
  listAccounts,
  settleQuery,
} from '@/lib/accounting/queries'
import { getArcaLookupStatus, getPadronVerification } from '@/lib/arca/queries'
import { formatIsoDay, todayInCordoba } from '@/lib/dates'
import { formatCuit, normalizeCuit } from '@/lib/fiscal'
import { SupplierAccountProvider } from '../../_components/supplier-account-picker'
import { isPurchaseImputation } from '../../_lib/accounts'
import {
  comprasHref,
  firstParam,
  isUuidLike,
  newPurchaseHref,
  supplierHref,
} from '../../_lib/links'
import { requireComprasAccess } from '../../_lib/page-access'
import { creditPairs } from '../../_lib/payment-plan'
import { supplierAccountOptions, supplierCategoryChoices } from '../../_lib/suppliers'
import { PURCHASE_VOUCHER_OPTIONS } from '../../_lib/vouchers'
import { ArcaVerification } from './_components/arca-verification'
import { DataTab } from './_components/data-tab'
import { PendingTab } from './_components/pending-tab'
import { StatementSkeleton, StatementTab } from './_components/statement-tab'
import { SupplierCover } from './_components/supplier-cover'
import { SupplierEditProvider } from './_components/supplier-edit'

export const metadata = { title: 'Proveedor' }

/**
 * Las vistas de la hoja (`?tab=`). Los tres valores de antes siguen valiendo:
 * `estado` (por defecto) y `pendientes` muestran LA MISMA vista, «Su libreta»
 * (primero lo que se le debe, después los movimientos); `datos` es «Sus datos».
 */
const TABS = ['estado', 'pendientes', 'datos'] as const
type SupplierTab = (typeof TABS)[number]

function isSupplierTab(value: string): value is SupplierTab {
  return (TABS as readonly string[]).includes(value)
}

/**
 * La hoja de un proveedor: su libreta, con su tapa.
 *
 * - **La tapa**: «Le debés $ X», la acción del momento ([Pagarle]) y sus tres
 *   datos de carga. Verde por defecto; `?tapa=crema` muestra la variante clara
 *   (parámetro temporal de revisión, como `?hero=crema` del Resumen).
 * - **Su libreta**: «Lo que le debés» (una compra sin pagar por renglón) y
 *   debajo sus movimientos (te dejó · le pagaste · le debés).
 * - **Sus datos**: para pedirle, para cargarle y los fiscales.
 *
 * El selector de categoría y «Editar datos» se montan UNA vez para toda la
 * página (se abren desde la tapa y desde «Sus datos»), solo para quien carga.
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
  const rawTab = firstParam(sp.tab)
  const tab: SupplierTab = isSupplierTab(rawTab) ? rawTab : 'estado'
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
  // El plan y ARCA, para quien carga y en las dos vistas: la categoría y «Editar datos» se
  // abren también desde la tapa. Si fallan, la hoja se ve igual, sin esos dos botones.
  const [positionOutcome, verificationOutcome, accounts, arcaLookup] = await Promise.all([
    settleQuery(getPartyPosition(tenantId, { partyId: id, group: 'payables' })),
    cuit && cuit.length === 11 ? settleQuery(getPadronVerification(tenantId, cuit)) : null,
    canWrite ? settleQuery(listAccounts(tenantId)) : null,
    canWrite ? settleQuery(getArcaLookupStatus(tenantId)) : null,
  ])
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

  const views: ViewPillItem[] = [
    { key: 'libreta', label: 'Su libreta', href: baseHref, active: tab !== 'datos' },
    {
      key: 'datos',
      label: 'Sus datos',
      href: supplierHref(tenantSlug, id, 'datos'),
      active: tab === 'datos',
    },
  ]
  const plan = accounts?.ok ? accounts.data : null
  const hasBalance = (position?.debtCents ?? 0) > 0 || (position?.creditCents ?? 0) > 0
  const tone = firstParam(sp.tapa) === 'crema' ? 'crema' : 'bosque'

  const body = (
    <>
      <SupplierCover
        tenantSlug={tenantSlug}
        party={party}
        position={position}
        positionError={positionOutcome.ok ? null : positionOutcome.message}
        verification={verification}
        canWrite={canWrite}
        canPickCategory={plan !== null}
        tone={tone}
        today={today}
        baseHref={baseHref}
        exportHref={exportHref(tenantSlug, 'estado-de-cuenta', {
          participe: party.id,
          desde: `${today.slice(0, 4)}-01-01`,
          hasta: today,
        })}
        exportFileName={`estado-de-cuenta-${today}.csv`}
      />

      <ViewPills label={`Vistas de ${shown}`} items={views} />

      {tab === 'datos' ? (
        <DataTab
          tenantSlug={tenantSlug}
          party={party}
          canWrite={canWrite}
          hasBalance={hasBalance}
          verification={verification ? <ArcaVerification verification={verification} /> : null}
        />
      ) : (
        <>
          {position ? (
            <PendingTab
              tenantSlug={tenantSlug}
              partyId={party.id}
              partyName={shown}
              position={position}
              pairs={pairs}
              today={today}
              canWrite={canWrite}
              canBuy={party.active}
              newPurchaseHref={newPurchaseHref(tenantSlug, {
                proveedor: party.id,
                volver: baseHref,
              })}
            />
          ) : (
            <PanelError
              title="Lo que le debés"
              message={positionOutcome.ok ? '' : positionOutcome.message}
            />
          )}
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
        </>
      )}
    </>
  )

  return (
    <AdmPage width="comfortable">
      <Link
        href={comprasHref(tenantSlug)}
        className="-ml-1.5 inline-flex min-h-9 items-center gap-1 self-start rounded-md px-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Compras y pagos
      </Link>

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

      <p className="text-xs text-muted-foreground">
        Saldos al {formatIsoDay(today)}. Los importes incluyen IVA.
      </p>
      <QuickActionsBar />
    </AdmPage>
  )
}

/**
 * Los dos diálogos de la hoja, montados una sola vez: «¿En qué le comprás a…?»
 * (si se pudo leer el plan) y «Editar datos». Los botones que los abren viven
 * en la tapa y en «Sus datos».
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
  const edit = (
    <SupplierEditProvider
      tenantSlug={tenantSlug}
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
  if (plan === null) return edit
  return (
    <SupplierAccountProvider
      tenantSlug={tenantSlug}
      accounts={supplierAccountOptions(
        plan,
        new Set(party.defaultAccountId ? [party.defaultAccountId] : []),
      )}
      categories={supplierCategoryChoices(plan)}
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
