import {
  CalendarCheck,
  Check,
  ChevronDown,
  CircleHelp,
  Coins,
  Link2Off,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CommissionPeriodFilter } from '@/components/commissions/period-filter'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { formatARS } from '@/lib/commissions/calculate'
import { resolveCommissionPeriod } from '@/lib/commissions/period'
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

/** `yyyy-MM-dd` → `dd/MM` sin pasar por Date (evita corrimientos de TZ). */
function formatDayMonth(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`
}

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
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          eyebrow="Negocio"
          title="Mis números"
          description="Lo que vas ganando con las reservas que gestionás."
        />
        {access.role === 'owner' ? (
          <EmptyState
            icon={UserRound}
            title="Tu cuenta no está vinculada a ningún gestor"
            description="Podés ver los números de cualquier gestor activo, o vincular cuentas desde Configuración → Comisiones → Gestores."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {activeManagers.map((m) => (
                  <Button key={m.id} asChild variant="outline" size="sm">
                    <Link href={periodHref(tenantSlug, period, m.id)}>
                      Ver como {m.display_name}
                    </Link>
                  </Button>
                ))}
                <Button asChild size="sm">
                  <Link href={`/${tenantSlug}/configuracion/comisiones`}>Ir a Configuración</Link>
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState
            icon={Link2Off}
            title="Tu cuenta todavía no está vinculada a un gestor de reservas"
            description="Pedile al dueño que vincule tu cuenta desde Configuración → Comisiones → Gestores. Apenas lo haga, acá vas a ver lo que vas ganando con cada reserva."
          />
        )}
      </div>
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
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Negocio"
        title="Mis números"
        description={
          <>
            {manager.display_name} · {period.label}
            {spying ? ' — vista del dueño' : null}
          </>
        }
      />

      {/* Cambiar de gestor (solo dueño).
          Antes este picker sólo aparecía cuando la cuenta del dueño no estaba
          vinculada a ningún gestor. Desde que el equipo se auto-provisiona,
          TODO dueño tiene gestor propio y ese empty state ya no se ve nunca:
          sin esto se quedaba sin manera de mirar los números de Luz. */}
      {access.role === 'owner' && activeManagers.length > 1 ? (
        <details className="card-hairline group rounded-xl border bg-card/60 px-4 py-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
            <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Ver los números de otro gestor
            <ChevronDown
              className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {activeManagers.map((m) => (
              <Button
                key={m.id}
                asChild
                size="sm"
                variant={m.id === manager.id ? 'default' : 'outline'}
              >
                <Link href={periodHref(tenantSlug, period, m.id)}>
                  {m.display_name}
                  {m.id === ownManager?.id ? ' (vos)' : ''}
                </Link>
              </Button>
            ))}
          </div>
        </details>
      ) : null}

      {/* ¿Cómo se calcula? */}
      <details className="card-hairline group rounded-xl border bg-card/60 px-4 py-3 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
          <CircleHelp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          ¿Cómo se calcula?
          <ChevronDown
            className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-6 text-muted-foreground">
          <li>
            Cobrás una tarifa por persona, que depende de la franja (almuerzo o cena) y de cuánta
            gente trae la reserva.
          </li>
          <li>Si la reserva es de un evento y el evento se llena, se suma un bonus por persona.</li>
          <li>
            El dueño marca cada pago cuando te lo liquida: ahí pasa de «Pendiente» a «Pagado».
          </li>
        </ul>
      </details>

      {/* Período. El mismo filtro que la liquidación del dueño: la gestora
          cobra "del 15 al 15", no por mes calendario, y necesita ver el mismo
          corte que le van a pagar. El `?as=` de la vista del dueño se conserva
          solo (el filtro mergea los parámetros que ya están en la URL). */}
      <CommissionPeriodFilter period={period} />

      {/* Si la lectura tocó el techo de filas, "A cobrar" está contando de
          menos. Acá importa tanto como en la liquidación: es el número con el
          que la gestora controla lo que le pagan. */}
      {truncated ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-text">
          Hay más reservas de las que entran en una sola lectura: los números de este período pueden
          estar incompletos. Elegí un rango más corto.
        </p>
      ) : null}

      {/* KPIs del período */}
      <div data-tour="mis-numeros-kpis" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="A cobrar"
          value={formatARS(pendingCents)}
          icon={Wallet}
          iconClassName="text-primary"
          className="border-primary/60 bg-primary/5"
        />
        <StatCard label="Cobrado" value={formatARS(paidCents)} icon={Coins} />
        <StatCard label="Reservas" value={entries.length} icon={CalendarCheck} />
        <StatCard label="Cubiertos" value={guestsTotal} icon={Users} />
      </div>

      {/* Detalle del período */}
      {entries.length === 0 ? (
        <div data-tour="mis-numeros-lista">
          <EmptyState
            icon={Coins}
            title="Sin reservas liquidadas en este período"
            description="Cuando tus reservas se cierren con la cantidad real de personas, van a aparecer acá con lo que te corresponde."
          />
        </div>
      ) : (
        <ol
          data-tour="mis-numeros-lista"
          className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card"
        >
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} />
          ))}
        </ol>
      )}
    </div>
  )
}

function EntryRow({ entry }: { entry: CommissionBreakdownEntry }) {
  const isPaid = !!entry.paid_at
  const isSplit = entry.split_factor_denominator > 1
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          <span className="mr-2 font-mono text-xs tabular-nums text-muted-foreground">
            {formatDayMonth(entry.reservation.reservation_date)}
          </span>
          {entry.reservation.guest_name}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {entry.guests_billed} {entry.guests_billed === 1 ? 'persona' : 'personas'} · base{' '}
          {formatARS(entry.base_total_cents)}
          {entry.bonus_total_cents > 0 ? (
            <span className="text-amber-700 dark:text-amber-300">
              {' '}
              + bonus {formatARS(entry.bonus_total_cents)}
            </span>
          ) : null}
          {isSplit
            ? ` · te toca ${entry.split_factor_numerator}/${entry.split_factor_denominator}`
            : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-mono text-sm font-semibold tabular-nums">
          {formatARS(entry.payable_cents)}
        </span>
        {isPaid ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            <Check className="size-3" aria-hidden />
            Pagado
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            Pendiente
          </span>
        )}
      </div>
    </li>
  )
}
