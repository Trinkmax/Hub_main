import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { type ReactNode, Suspense } from 'react'
import { AdmHeader, AdmPage } from '@/components/administracion/kit/adm-page'
import { ReadOnlyBadge } from '@/components/administracion/read-only'
import {
  AccountingDisabledError,
  AccountingForbiddenError,
  requireAccountingAccess,
} from '@/lib/accounting/access'
import { todayInCordoba } from '@/lib/dates'
import {
  RoleRequiredError,
  type TenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { RoomFrame } from './_components/room-frame'
import { PortadaSkeleton, RoomSkeleton } from './_components/room-skeleton'
import {
  AccesosRoom,
  ArcaRoom,
  CajasRoom,
  EjercicioRoom,
  IntegridadRoom,
  MediosRoom,
  Portada,
  PuntosRoom,
  type RoomContext,
  SasRoom,
} from './_components/rooms'
import { type RoomKey, readTab, roomOfTab } from './_lib/rooms'

export const metadata = { title: 'Ajustes · Administración' }

/**
 * Ajustes de Administración: la trastienda del bar. Sin `?tab=` se ve la
 * portada —lo próximo de la puesta en marcha, seis objetos que el dueño
 * reconoce y, aparte, el cajón de la contadora—; con `?tab=`, la habitación
 * que se pide (las nueve claves de siempre siguen valiendo: todos los links de
 * la app que mandan a «Ajustes › …» caen en lo que nombran).
 *
 * La página solo revisa el acceso y pone el marco: cada habitación carga lo
 * suyo y llega detrás de su esqueleto. La contadora ve todo en modo lectura:
 * sin campos ni botones.
 */
export default async function AjustesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
  const base = `/${tenantSlug}/administracion`

  let access: TenantAccess
  try {
    access = await requireAccountingAccess(tenantSlug, 'read')
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=${encodeURIComponent(`${base}/ajustes`)}`)
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
  const ctx: RoomContext = {
    tenantSlug,
    tenantId: access.tenant.id,
    base,
    userId: access.user.id,
    canWrite,
    isOwner: access.role === 'owner',
    isAdmin: canWrite && access.accounting.admin,
    today: todayInCordoba(),
  }

  const room = roomOfTab(sp.tab)

  if (room === null) {
    return (
      <AdmPage width="comfortable">
        <AdmHeader
          title="Ajustes"
          badge={<ReadOnlyBadge />}
          description="Lo que se arma una vez y después casi no se toca."
        />
        <Suspense fallback={<PortadaSkeleton />}>
          <Portada ctx={ctx} />
        </Suspense>
      </AdmPage>
    )
  }

  const content: Record<RoomKey, () => ReactNode> = {
    accesos: () => <AccesosRoom ctx={ctx} />,
    cajas: () => <CajasRoom ctx={ctx} />,
    // `participes` abre la misma habitación con la lista de CUIT desplegada.
    medios: () => <MediosRoom ctx={ctx} cuitOpen={readTab(sp.tab) === 'participes'} />,
    sas: () => <SasRoom ctx={ctx} />,
    'puntos-de-venta': () => <PuntosRoom ctx={ctx} />,
    arca: () => <ArcaRoom ctx={ctx} />,
    ejercicio: () => <EjercicioRoom ctx={ctx} />,
    integridad: () => <IntegridadRoom ctx={ctx} ran={sp.verificar === '1'} />,
  }

  return (
    <RoomFrame
      base={base}
      room={room}
      description={
        room === 'cajas' ? (
          <>
            Las cajas, los bancos y las billeteras del bar. Acá se agregan y se les cargan los
            datos; la plata y los movimientos se miran en{' '}
            <Link
              href={`${base}/cajas`}
              className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cajas
            </Link>
            .
          </>
        ) : undefined
      }
    >
      <Suspense key={`${room}-${sp.verificar ?? ''}`} fallback={<RoomSkeleton room={room} />}>
        {content[room]()}
      </Suspense>
    </RoomFrame>
  )
}
