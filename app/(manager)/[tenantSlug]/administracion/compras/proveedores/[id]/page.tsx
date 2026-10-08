import { ArrowLeft, CalendarClock, CircleAlert, HandCoins, Info, Wallet } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import { SectionNav } from '@/components/administracion/section-nav'
import { Badge } from '@/components/ui/badge'
import { PageShell } from '@/components/ui/page-shell'
import { StatCard } from '@/components/ui/stat-card'
import {
  exportHref,
  getParty,
  getPartyPosition,
  PARTY_KIND_LABELS,
  settleQuery,
} from '@/lib/accounting/queries'
import { ivaConditionLabel } from '@/lib/accounting/queries/csv'
import { getPadronVerification } from '@/lib/arca/queries'
import { daysBetween, formatIsoDay, todayInCordoba } from '@/lib/dates'
import { formatCuit, normalizeCuit } from '@/lib/fiscal'
import { formatCents, formatCentsShort } from '@/lib/money'
import { BlockError } from '../../_components/block-error'
import { PartyStatus } from '../../_components/party-status'
import {
  comprasHref,
  firstParam,
  isUuidLike,
  newPurchaseHref,
  supplierHref,
} from '../../_lib/links'
import { requireComprasAccess } from '../../_lib/page-access'
import { creditPairs } from '../../_lib/payment-plan'
import { ApplyCreditButton } from './_components/apply-credit-button'
import { ArcaVerification } from './_components/arca-verification'
import { DataTab } from './_components/data-tab'
import { PendingTab } from './_components/pending-tab'
import { StatementTab } from './_components/statement-tab'
import { SupplierActions } from './_components/supplier-actions'

export const metadata = { title: 'Proveedor' }

const TABS = ['estado', 'pendientes', 'datos'] as const
type SupplierTab = (typeof TABS)[number]

function isSupplierTab(value: string): value is SupplierTab {
  return (TABS as readonly string[]).includes(value)
}

/**
 * Ficha de un proveedor (H.7): cabecera con sus datos y acciones, sus números
 * (saldo, vencido, lo que vence, a favor), el aviso de saldo a favor y las
 * pestañas Estado de cuenta · Pendientes · Datos (por URL).
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
  const [positionOutcome, verificationOutcome] = await Promise.all([
    settleQuery(getPartyPosition(tenantId, { partyId: id, group: 'payables' })),
    cuit && cuit.length === 11 ? settleQuery(getPadronVerification(tenantId, cuit)) : null,
  ])
  const position = positionOutcome.ok ? positionOutcome.data : null
  const verification = verificationOutcome?.ok ? verificationOutcome.data : null

  const displayName =
    party.tradeName && party.tradeName !== party.name
      ? `${party.tradeName} (${party.name})`
      : party.name
  const meta = [
    party.taxId
      ? `${party.taxIdType === 'dni' ? 'DNI' : party.taxIdType === 'cuil' ? 'CUIL' : 'CUIT'} ${
          party.taxIdType === 'dni' ? party.taxId : formatCuit(party.taxId)
        }`
      : 'Sin CUIT cargado',
    ivaConditionLabel(party.ivaCondition),
    party.paymentTermDays > 0 ? `Paga a ${party.paymentTermDays} días` : 'De contado',
  ]

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

  const overdueCents = position?.aging.overdueCents ?? 0
  const oldestOverdueDays = position?.aging.oldestDueDate
    ? daysBetween(position.aging.oldestDueDate, position.asOf)
    : null
  const dueSoonCents = position ? position.aging.totals.due_soon : 0
  const pendingCount = position ? position.debtItems.length + position.creditItems.length : 0

  return (
    <PageShell width="comfortable">
      <Link
        href={comprasHref(tenantSlug)}
        className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground md:min-h-0"
      >
        <ArrowLeft className="size-3" aria-hidden />
        Volver a proveedores
      </Link>

      <div className="card-hairline relative overflow-hidden rounded-xl border bg-card p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl"
        />
        {/* En el celular las acciones van abajo: al lado dejaban el nombre y el CUIT en una columna de 60 px. */}
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Administración · Proveedor
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-balance">
                {displayName}
              </h1>
              {party.kind !== 'supplier' ? (
                <Badge variant="outline">{PARTY_KIND_LABELS[party.kind] ?? 'Otro'}</Badge>
              ) : null}
              {!party.active ? <Badge variant="muted">Desactivado</Badge> : null}
              <ReadOnlyBadge className="ml-0" />
            </div>
            <p className="text-sm text-muted-foreground">
              {meta.map((part, index) => (
                <span key={part}>
                  {/* Corta solo entre datos (nunca «CUIT 30-» arriba y «70111222-5» abajo) y el «·» cierra el dato. */}
                  <span className="inline-block">
                    {part}
                    {index < meta.length - 1 ? ' ·' : null}
                  </span>
                  {index < meta.length - 1 ? ' ' : null}
                </span>
              ))}
            </p>
            <ArcaVerification verification={verification} />
            {position ? (
              <PartyStatus light={position.traffic.light} text={position.traffic.text} />
            ) : null}
          </div>
          <SupplierActions
            partyId={party.id}
            partyName={party.name}
            newInvoiceHref={newPurchaseHref(tenantSlug, { proveedor: party.id, volver: baseHref })}
            newCreditNoteHref={newPurchaseHref(tenantSlug, {
              tipo: 'nc',
              proveedor: party.id,
              volver: baseHref,
            })}
            exportHref={exportHref(tenantSlug, 'estado-de-cuenta', {
              participe: party.id,
              desde: `${today.slice(0, 4)}-01-01`,
              hasta: today,
            })}
            exportFileName={`estado-de-cuenta-${today}.csv`}
            canPay={party.active || (position?.debtCents ?? 0) > 0}
          />
        </div>
      </div>

      {position ? (
        <section
          aria-label="Saldo con el proveedor"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          <StatCard
            icon={Wallet}
            iconClassName="text-primary"
            label="Saldo"
            value={
              position.netCents === 0 ? 'Sin deuda' : formatCentsShort(Math.abs(position.netCents))
            }
            hint={
              position.netCents > 0
                ? 'Le debés, a hoy'
                : position.netCents < 0
                  ? 'A tu favor'
                  : 'Está todo pago'
            }
          />
          <StatCard
            icon={CircleAlert}
            iconClassName={overdueCents > 0 ? 'text-destructive' : 'text-muted-foreground'}
            label="Vencido"
            value={formatCentsShort(overdueCents)}
            hint={
              oldestOverdueDays !== null
                ? `La más vieja venció hace ${oldestOverdueDays} ${oldestOverdueDays === 1 ? 'día' : 'días'}`
                : 'Nada vencido'
            }
          />
          <StatCard
            icon={CalendarClock}
            iconClassName="text-warning"
            label="Vence en 7 días"
            value={formatCentsShort(dueSoonCents)}
            hint="De hoy a una semana"
          />
          <StatCard
            icon={HandCoins}
            iconClassName="text-success"
            label="A favor sin aplicar"
            value={formatCentsShort(position.creditCents)}
            hint={
              position.creditCents > 0 ? 'Notas de crédito y pagos a cuenta' : 'Sin saldos a favor'
            }
          />
        </section>
      ) : (
        <BlockError message={positionOutcome.ok ? '' : positionOutcome.message} />
      )}

      {position && position.creditCents > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm sm:flex-row sm:items-center">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info sm:mt-0" />
          <p className="flex-1 text-pretty">
            Tenés {formatCents(position.creditCents)} a favor con {party.tradeName ?? party.name}
            {pairs.length > 0
              ? ': se usa solo en el próximo pago, o aplicalo ahora contra lo que le debés.'
              : ': se usa solo en el próximo pago.'}
          </p>
          <ApplyCreditButton pairs={pairs} />
        </div>
      ) : null}

      <SectionNav
        label={`Secciones de ${party.name}`}
        active={tab}
        items={[
          { value: 'estado', label: 'Estado de cuenta', shortLabel: 'Movimientos', href: baseHref },
          {
            value: 'pendientes',
            label: 'Pendientes',
            href: supplierHref(tenantSlug, id, 'pendientes'),
            count: pendingCount,
          },
          { value: 'datos', label: 'Datos', href: supplierHref(tenantSlug, id, 'datos') },
        ]}
      />

      {tab === 'estado' ? (
        <StatementTab
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          partyId={party.id}
          partyName={party.name}
          baseHref={baseHref}
          sp={sp}
          today={today}
        />
      ) : tab === 'pendientes' ? (
        position ? (
          <PendingTab
            tenantSlug={tenantSlug}
            partyId={party.id}
            partyName={party.tradeName ?? party.name}
            position={position}
            today={today}
          />
        ) : (
          <BlockError message={positionOutcome.ok ? '' : positionOutcome.message} />
        )
      ) : (
        <DataTab
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          party={party}
          canWrite={canWrite}
          hasBalance={(position?.debtCents ?? 0) > 0 || (position?.creditCents ?? 0) > 0}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Saldos al {formatIsoDay(today)}. Los importes incluyen IVA.
      </p>
    </PageShell>
  )
}
