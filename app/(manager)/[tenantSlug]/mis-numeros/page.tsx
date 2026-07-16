import { formatInTimeZone } from 'date-fns-tz'
import {
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Coins,
  Link2Off,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { formatARS } from '@/lib/commissions/calculate'
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

const TZ = 'America/Argentina/Cordoba'

function monthRange(ym: string): { from: string; to: string; label: string } {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) throw new Error(`mes inválido: ${ym}`)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const label = new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
  return { from, to, label }
}

function shiftYM(ym: string, months: number): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** `yyyy-MM-dd` → `dd/MM` sin pasar por Date (evita corrimientos de TZ). */
function formatDayMonth(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`
}

function monthHref(slug: string, ym: string, as?: string): string {
  const params = new URLSearchParams({ month: ym })
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
  const ownManager = await getManagerForUser({ tenantId: access.tenant.id, userId: user.id })

  // El owner puede espiar cualquier gestor activo con ?as=<managerId>.
  const asParam = typeof sp.as === 'string' ? sp.as : undefined
  let manager: ReservationManagerRow | null = ownManager
  let spying = false
  let activeManagers: ReservationManagerRow[] = []
  if (access.role === 'owner') {
    activeManagers = await listManagers({ tenantId: access.tenant.id, onlyActive: true })
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
                    <Link
                      href={monthHref(
                        tenantSlug,
                        formatInTimeZone(new Date(), TZ, 'yyyy-MM'),
                        m.id,
                      )}
                    >
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

  // ── Mes seleccionado (?month=YYYY-MM, reloj del bar) ──
  // Además del formato validamos el rango 01-12: "2026-00"/"2026-13" pasan la
  // regex pero romperían monthRange/el filtro de fechas — caen al mes actual.
  const monthParam = typeof sp.month === 'string' ? sp.month : undefined
  const monthOk =
    monthParam !== undefined &&
    /^\d{4}-\d{2}$/.test(monthParam) &&
    Number(monthParam.slice(5)) >= 1 &&
    Number(monthParam.slice(5)) <= 12
  const ym = monthOk && monthParam ? monthParam : formatInTimeZone(new Date(), TZ, 'yyyy-MM')
  const { from, to, label } = monthRange(ym)

  const entries = await listMyCommissionEntries({
    tenantId: access.tenant.id,
    managerId: manager.id,
    monthStart: from,
    monthEnd: to,
  })

  let pendingCents = 0
  let paidCents = 0
  let guestsTotal = 0
  for (const e of entries) {
    if (e.paid_at) paidCents += e.payable_cents
    else pendingCents += e.payable_cents
    guestsTotal += e.guests_billed
  }

  const spyQuery = spying ? manager.id : undefined

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Negocio"
        title="Mis números"
        description={
          <>
            {manager.display_name} · <span className="capitalize">{label}</span>
            {spying ? ' — vista del dueño' : null}
          </>
        }
      />

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

      {/* Navegación mensual */}
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={monthHref(tenantSlug, shiftYM(ym, -1), spyQuery)}>
            <ChevronLeft className="size-4" /> Mes anterior
          </Link>
        </Button>
        <h2 className="font-serif text-lg font-semibold capitalize">{label}</h2>
        <Button asChild variant="outline" size="sm">
          <Link href={monthHref(tenantSlug, shiftYM(ym, 1), spyQuery)}>
            Mes siguiente <ChevronRight className="size-4" />
          </Link>
        </Button>
      </div>

      {/* KPIs del mes */}
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

      {/* Detalle del mes */}
      {entries.length === 0 ? (
        <div data-tour="mis-numeros-lista">
          <EmptyState
            icon={Coins}
            title="Sin reservas liquidadas este mes"
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
