import { CalendarCheck, CircleHelp, Coins, Link2Off, UserRound, Users, Wallet } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  COMMISSION_STATUS_MANAGER,
  commissionStatusOf,
} from '@/components/commissions/commission-status'
import { CommissionPeriodFilter } from '@/components/commissions/period-filter'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { DataTable } from '@/components/ui/data-table'
import { Disclosure } from '@/components/ui/disclosure'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterChip } from '@/components/ui/filter-chip'
import { KPI, KPIGroup } from '@/components/ui/kpi'
import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Section } from '@/components/ui/section'
import { StatusBadge } from '@/components/ui/status-badge'
import { resolveCommissionPeriod } from '@/lib/commissions/period'
import { formatDayMonth } from '@/lib/dates/format'
import { formatNumber } from '@/lib/format/number-kind'
import { formatCents } from '@/lib/money/format'
import { todayInCordoba } from '@/lib/salon/date-presets'
import {
  type CommissionBreakdownEntry,
  getManagerForUser,
  listManagers,
  listMyCommissionEntries,
} from '@/lib/salon/queries'
import type { ReservationManagerRow } from '@/lib/salon/types'
import {
  getCurrentUser,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
} from '@/lib/tenant'

export const metadata = { title: 'Mis números' }
export const dynamic = 'force-dynamic'

/**
 * Links internos de la pantalla (cambiar de gestor). Antes escribían
 * `?month=YYYY-MM` y pisaban el rango elegido: ahora arrastran el mismo
 * `?from=&to=` que se está mirando, así el dueño puede comparar dos gestores
 * sobre el MISMO período sin volver a tipear las fechas.
 */
function periodHref(slug: string, period: { from: string; to: string }, as?: string): string {
  const params = new URLSearchParams({ from: period.from, to: period.to })
  if (as) params.set('as', as)
  return `/${slug}/mis-numeros?${params.toString()}`
}

/** Sin centavos, como el resto de las comisiones. */
function money(cents: number): string {
  return formatCents(cents, { decimals: 0 })
}

function personas(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? 'persona' : 'personas'}`
}

function splitLabel(entry: CommissionBreakdownEntry): string {
  return entry.split_factor_denominator > 1
    ? `${entry.split_factor_numerator}/${entry.split_factor_denominator}`
    : '100 %'
}

export default async function MisNumerosPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams

  // Mismo período que la liquidación del dueño (rango libre `?from=&to=`), y el
  // mismo resolvedor: si Luz mira "del 1 al 15" tiene que ver exactamente las
  // reservas que el dueño le está por pagar. Los `?month=` viejos siguen
  // abriendo — el resolvedor los traduce a mes completo.
  const period = resolveCommissionPeriod(
    {
      from: typeof sp.from === 'string' ? sp.from : undefined,
      to: typeof sp.to === 'string' ? sp.to : undefined,
      month: typeof sp.month === 'string' ? sp.month : undefined,
    },
    todayInCordoba(),
  )

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
    requireRole(access.role, ['owner', 'host'])
  } catch (e) {
    if (e instanceof TenantNotFoundError) notFound()
    if (e instanceof RoleRequiredError) notFound()
    throw e
  }

  const user = await getCurrentUser()
  if (!user) notFound()

  // ── Identidad: ¿a qué gestor corresponde esta cuenta? ──
  // El listado de gestores (solo owner) no depende del gestor propio: van en
  // paralelo en vez de dos hops secuenciales.
  const [ownManager, activeManagers] = await Promise.all([
    getManagerForUser({ tenantId: access.tenant.id, userId: user.id }),
    access.role === 'owner'
      ? listManagers({ tenantId: access.tenant.id, onlyActive: true })
      : Promise.resolve<ReservationManagerRow[]>([]),
  ])

  // El owner puede espiar cualquier gestor activo con ?as=<managerId>.
  const asParam = typeof sp.as === 'string' ? sp.as : undefined
  let manager: ReservationManagerRow | null = ownManager
  let spying = false
  if (access.role === 'owner') {
    if (asParam) {
      const spied = activeManagers.find((m) => m.id === asParam)
      if (spied) {
        manager = spied
        spying = spied.id !== ownManager?.id
      }
    }
  }

  // ── Sin vínculo: empty state amable (y picker de gestores si sos owner) ──
  if (!manager) {
    return (
      <PageShell width="compact">
        <PageHeader
          title="Mis números"
          description="Lo que vas ganando con las reservas que gestionás."
        />
        {access.role === 'owner' ? (
          <EmptyState
            size="lg"
            icon={UserRound}
            title="Tu cuenta no está vinculada a ningún gestor"
            description="Podés ver los números de cualquier gestor activo, o vincular cuentas desde Configuración → Comisiones → Gestores."
            secondaryAction={
              activeManagers.length > 0 ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {activeManagers.map((m) => (
                    <Button key={m.id} asChild variant="secondary" size="sm">
                      <Link href={periodHref(tenantSlug, period, m.id)}>
                        Ver como {m.display_name}
                      </Link>
                    </Button>
                  ))}
                </div>
              ) : undefined
            }
            action={
              <Button asChild size="sm">
                <Link href={`/${tenantSlug}/configuracion/comisiones`}>Ir a Configuración</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            size="lg"
            icon={Link2Off}
            title="Tu cuenta todavía no está vinculada a un gestor de reservas"
            description="Pedile al dueño que vincule tu cuenta desde Configuración → Comisiones → Gestores. Apenas lo haga, acá vas a ver lo que vas ganando con cada reserva."
          />
        )}
      </PageShell>
    )
  }

  const { entries, truncated } = await listMyCommissionEntries({
    tenantId: access.tenant.id,
    managerId: manager.id,
    from: period.from,
    to: period.to,
  })

  let pendingCents = 0
  let paidCents = 0
  let guestsTotal = 0
  for (const e of entries) {
    if (e.paid_at) paidCents += e.payable_cents
    else pendingCents += e.payable_cents
    guestsTotal += e.guests_billed
  }

  return (
    <PageShell width="compact">
      <PageHeader
        title="Mis números"
        description={
          <>
            {manager.display_name} · {period.label}
            {spying ? ' — vista del dueño' : null}
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {/* Cambiar de gestor (solo dueño). Desde que el equipo se
            auto-provisiona, TODO dueño tiene gestor propio: sin esto se
            quedaba sin manera de mirar los números de Luz. Un chip por
            gestor, el que se está mirando marcado. */}
        {access.role === 'owner' && activeManagers.length > 1 ? (
          <nav
            aria-label="Ver los números de otro gestor"
            className="flex flex-wrap items-center gap-2"
          >
            <span className="type-small text-muted-foreground">Ver los números de</span>
            {activeManagers.map((m) => (
              <FilterChip key={m.id} asChild pressed={m.id === manager.id}>
                <Link href={periodHref(tenantSlug, period, m.id)}>
                  {m.display_name}
                  {m.id === ownManager?.id ? ' (vos)' : ''}
                </Link>
              </FilterChip>
            ))}
          </nav>
        ) : null}

        {/* Período. El mismo filtro que la liquidación del dueño: la gestora
            cobra "del 15 al 15", no por mes calendario, y necesita ver el mismo
            corte que le van a pagar. El `?as=` de la vista del dueño se conserva
            solo (el filtro mergea los parámetros que ya están en la URL). */}
        <CommissionPeriodFilter period={period} />

        {/* Si la lectura tocó el techo de filas, "A cobrar" está contando de
            menos. Acá importa tanto como en la liquidación: es el número con el
            que la gestora controla lo que le pagan. */}
        {truncated ? (
          <Callout tone="warning" title="Los números pueden estar incompletos">
            Hay más reservas de las que entran en una sola lectura. Elegí un rango más corto.
          </Callout>
        ) : null}
      </div>

      {/* KPIs del período */}
      <KPIGroup data-tour="mis-numeros-kpis" columns={4}>
        <KPI label="A cobrar" icon={Wallet} value={<Amount cents={pendingCents} decimals={0} />} />
        <KPI label="Cobrado" icon={Coins} value={<Amount cents={paidCents} decimals={0} />} />
        <KPI label="Reservas" icon={CalendarCheck} value={formatNumber(entries.length)} />
        <KPI
          label="Cubiertos"
          icon={Users}
          value={formatNumber(guestsTotal)}
          hint="Personas por las que cobrás"
        />
      </KPIGroup>

      <Section title="Reserva por reserva">
        {/* ¿Cómo se calcula? Ayuda que se abre cuando hace falta. */}
        <Disclosure title="¿Cómo se calcula?" icon={<CircleHelp />}>
          <ul className="list-disc space-y-1.5 ps-5 type-body text-muted-foreground">
            <li>
              Cobrás una tarifa por persona, que depende de la franja (almuerzo o cena) y de cuánta
              gente trae la reserva.
            </li>
            <li>
              Si la reserva es de un evento y el evento se llena, se suma un bonus por persona.
            </li>
            <li>
              El dueño marca cada pago cuando te lo liquida: ahí pasa de «Pendiente» a «Pagado».
            </li>
          </ul>
        </Disclosure>

        <DataTable
          data-tour="mis-numeros-lista"
          caption={`Comisiones de ${period.label}`}
          rows={entries}
          getRowId={(e) => e.id}
          columns={[
            {
              id: 'fecha',
              header: 'Fecha',
              mobile: 'hidden',
              cell: (e) => (
                <span className="type-amount text-muted-foreground">
                  {formatDayMonth(e.reservation.reservation_date)}
                </span>
              ),
            },
            {
              id: 'reserva',
              header: 'Reserva',
              mobile: 'primary',
              cell: (e) => (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-foreground">
                    {e.reservation.guest_name}
                  </span>
                  {/* En el celular (tarjetas) las columnas de detalle no se
                      ven: van acá, con sus palabras. */}
                  <span className="type-small font-normal text-muted-foreground md:hidden">
                    <span className="type-amount">
                      {formatDayMonth(e.reservation.reservation_date)}
                    </span>{' '}
                    · {personas(e.guests_billed)} · base {money(e.base_total_cents)}
                    {e.bonus_total_cents > 0 ? (
                      <span className="text-warning-text">
                        {' '}
                        + bonus {money(e.bonus_total_cents)}
                      </span>
                    ) : null}
                    {e.split_factor_denominator > 1 ? ` · te toca ${splitLabel(e)}` : null}
                  </span>
                </span>
              ),
            },
            {
              id: 'personas',
              header: 'Personas',
              numeric: true,
              mobile: 'hidden',
              cell: (e) => formatNumber(e.guests_billed),
            },
            {
              id: 'base',
              header: 'Base',
              numeric: true,
              mobile: 'hidden',
              cell: (e) => <Amount cents={e.base_total_cents} decimals={0} tone="muted" />,
            },
            {
              id: 'bonus',
              header: 'Bonus',
              numeric: true,
              mobile: 'hidden',
              cell: (e) =>
                e.bonus_total_cents > 0 ? (
                  <span className="text-warning-text">
                    +<Amount cents={e.bonus_total_cents} decimals={0} />
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
            {
              id: 'parte',
              header: 'Te toca',
              numeric: true,
              mobile: 'hidden',
              hideBelow: 'lg',
              cell: (e) => <span className="text-muted-foreground">{splitLabel(e)}</span>,
            },
            {
              id: 'cobras',
              header: 'Cobrás',
              numeric: true,
              cell: (e) => (
                <Amount cents={e.payable_cents} decimals={0} className="font-semibold" />
              ),
            },
            {
              id: 'estado',
              header: 'Estado',
              align: 'end',
              mobile: 'value',
              cell: (e) => (
                <StatusBadge
                  status={commissionStatusOf(e.paid_at)}
                  map={COMMISSION_STATUS_MANAGER}
                />
              ),
            },
          ]}
          empty={
            <EmptyState
              size="sm"
              icon={Coins}
              title="Sin reservas liquidadas en este período"
              description="Cuando tus reservas se cierren con la cantidad real de personas, van a aparecer acá con lo que te corresponde."
            />
          }
        />
      </Section>
    </PageShell>
  )
}
