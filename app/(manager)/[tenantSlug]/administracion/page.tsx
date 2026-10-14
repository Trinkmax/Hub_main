import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { firstParam } from '@/components/administracion/cajas-ventas/periods'
import { AdmPage } from '@/components/administracion/kit/adm-page'
import { QuickActionsBar } from '@/components/administracion/quick-actions'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { serviceDayInCordoba, todayInCordoba } from '@/lib/dates'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { BooksBlock } from './_resumen/books-block'
import { firstStepsCookieName, SETUP_OPEN_VALUE } from './_resumen/first-steps-cookie'
import { HeroBlock, type HeroTone } from './_resumen/hero-block'
import { type HomeData, loadHome } from './_resumen/home-data'
import { InOutBlock } from './_resumen/in-out-block'
import { IvaBlock } from './_resumen/iva-block'
import { MonthBlock } from './_resumen/month-block'
import { NoticesBlock } from './_resumen/notices-block'
import { NARROW_COLUMN, PANEL_GRID, PANEL_ORDER, WIDE_COLUMN } from './_resumen/panel-columns'
import { PayablesBlock } from './_resumen/payables-block'
import {
  BooksSkeleton,
  HeroSkeleton,
  InOutSkeleton,
  MonthSkeleton,
  PayablesSkeleton,
  SpendingSkeleton,
  TodaySkeleton,
} from './_resumen/skeletons'
import { SpendingBlock } from './_resumen/spending-block'
import { headerDateLine } from './_resumen/summary-copy'
import { TodayBlock } from './_resumen/today-block'

/**
 * Resumen de Administración: «la plata hoy». Contesta, en este orden: ¿cuánta
 * plata hay? → ¿qué me toca hoy? → ¿cómo viene el mes? → ¿qué tengo que pagar?
 * → ¿por dónde entra y por dónde se va?
 *
 * La página pide todas las lecturas juntas y no espera ninguna (`loadHome`):
 * cada bloque va en su `Suspense`, con un esqueleto de su forma, y espera solo
 * lo que usa. Así la fecha sale al instante, los gráficos que no dependen de
 * `acc_report_summary` (la lenta) no la esperan, y un bloque que falla muestra
 * su error con «Reintentar» sin tirar el resto.
 *
 * El dueño ve las acciones; la contadora, los mismos números sin ningún botón
 * de carga y, arriba de todo, el estado de los libros. La base vuelve a decidir
 * qué ve cada uno en cada lectura (RLS de lectores).
 *
 * `?hero=crema` muestra la variante clara del héroe: es un parámetro temporal,
 * para que los socios elijan entre las dos mirándolas con sus datos.
 */
export default async function AdministracionResumenPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const base = `/${tenantSlug}/administracion`

  let access: TenantAccess
  try {
    access = await requireAccountingAccess(tenantSlug, 'read')
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(base)}`)
    }
    if (
      error instanceof AccountingDisabledError ||
      error instanceof AccountingForbiddenError ||
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError
    ) {
      notFound()
    }
    throw error
  }

  const canWrite = access.accounting.write
  const today = todayInCordoba()
  const data = loadHome({
    tenantId: access.tenant.id,
    tenantSlug,
    today,
    serviceDay: serviceDayInCordoba(),
    canWrite,
  })

  const [sp, cookieStore] = await Promise.all([searchParams, cookies()])
  const heroTone: HeroTone = firstParam(sp.hero) === 'crema' ? 'crema' : 'bosque'
  // La cookie de «Ocultar» de Primeros pasos, que ahora recuerda si la franja de la puesta
  // en marcha quedó desplegada. Por defecto (y con el valor viejo) va en un renglón.
  const setupCookie = firstStepsCookieName(tenantSlug)
  const setupCollapsed = cookieStore.get(setupCookie)?.value !== SETUP_OPEN_VALUE

  return (
    <AdmPage>
      {/* El título de la pantalla es la fecha: «Resumen» ya lo dice la barra de la sección.
          En el celular va más pegado al héroe: cada renglón cuenta para que la primera acción
          entre en la primera pantalla. */}
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 sm:mb-6">
        <h1 className="font-serif text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
          <span className="sr-only">Resumen: </span>
          {headerDateLine(today) || 'Hoy'}
          <ReadOnlyBadge />
        </h1>
        <Suspense fallback={null}>
          <LegalName data={data} />
        </Suspense>
      </header>

      {canWrite ? null : (
        <Suspense fallback={<BooksSkeleton />}>
          <BooksBlock data={data} />
        </Suspense>
      )}

      <Suspense fallback={<HeroSkeleton tone={heroTone} />}>
        <HeroBlock data={data} tone={heroTone} />
      </Suspense>

      <Suspense fallback={<TodaySkeleton />}>
        <TodayBlock data={data} setupCookie={setupCookie} setupCollapsed={setupCollapsed} />
      </Suspense>

      {/* Dos columnas fijas, 7 + 5, según el ancho que de verdad tienen (`@container`), no el
          de la ventana: con el menú abierto en una notebook, «Lo que tenés que pagar» quedaba en
          277 px. Cada columna apila sus paneles por su cuenta: en filas, cada panel esperaba al
          alto del vecino y quedaban huecos, y las filas 7/5 y 6/6 no alineaban sus bordes.
          A la izquierda lo que entra (las ventas y la plata de las cajas, con su dibujo ancho);
          a la derecha lo que sale (lo que tenés que pagar y en qué se gastó). En una sola
          columna las cajas de las columnas no existen (`contents`) y `order` deja el orden de
          siempre: ventas, pagos, entró y salió, en qué se gastó. */}
      <div className="@container">
        <div className={PANEL_GRID}>
          <div className={WIDE_COLUMN}>
            <Suspense fallback={<MonthSkeleton className={PANEL_ORDER[0]} />}>
              <MonthBlock data={data} className={PANEL_ORDER[0]} />
            </Suspense>
            <Suspense fallback={<InOutSkeleton className={PANEL_ORDER[2]} />}>
              <InOutBlock data={data} className={PANEL_ORDER[2]} />
            </Suspense>
          </div>
          <div className={NARROW_COLUMN}>
            <Suspense fallback={<PayablesSkeleton className={PANEL_ORDER[1]} />}>
              <PayablesBlock data={data} className={PANEL_ORDER[1]} />
            </Suspense>
            <Suspense fallback={<SpendingSkeleton className={PANEL_ORDER[3]} />}>
              <SpendingBlock data={data} className={PANEL_ORDER[3]} />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Estos dos pueden no dibujar nada: sin esqueleto, para no reservar un lugar vacío. */}
      <Suspense fallback={null}>
        <NoticesBlock data={data} />
      </Suspense>
      <Suspense fallback={null}>
        <IvaBlock data={data} />
      </Suspense>

      <QuickActionsBar />
    </AdmPage>
  )
}

/** La razón social, chica al lado de la fecha: llega con los ajustes, sin frenar el título. */
async function LegalName({ data }: { data: HomeData }) {
  const settings = await data.settings
  const legalName = settings.ok ? settings.data?.legalName : null
  if (!legalName) return null
  return <p className="text-sm text-muted-foreground">{legalName}</p>
}
