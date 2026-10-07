import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { AccountingProvider } from '@/components/administracion/accounting-provider'
import { ReadOnlyBanner } from '@/components/administracion/read-only'
import { type AccountingState, getAccountingState } from '@/lib/accounting/access'
import { todayInCordoba } from '@/lib/dates'
import { TenantNotFoundError, UnauthenticatedError } from '@/lib/tenant'
import {
  AdministracionApagada,
  AdministracionPendiente,
  AdministracionSinAcceso,
} from './_components/gate-screens'
import { SetupGate } from './_components/setup-gate'

export const metadata = { title: 'Administración' }

/**
 * La puerta de Administración (G.1 · H.18). Decide qué ve cada uno; la base
 * vuelve a decidir todo en cada RLS y RPC, y cada `page.tsx` vuelve a llamar a
 * `requireAccountingAccess` (ninguna página confía solo en este layout).
 *
 * | Situación                              | Quién          | Ve                         |
 * |----------------------------------------|----------------|----------------------------|
 * | Rol que no es dueño ni contadora       | —              | 404                        |
 * | Flag apagado                           | dueño          | 404                        |
 * | Flag apagado                           | contadora      | «Está apagada»             |
 * | Sin configurar, puede configurar       | dueño          | el asistente (/configurar) |
 * | Sin configurar                         | dueño          | «La va a configurar X»     |
 * | Sin configurar                         | contadora      | «Todavía no está lista»    |
 * | Configurada, sin acceso                | dueño          | «Administración es privada»|
 * | Configurada, con acceso                | dueño/contadora| la sección (+ hojas rápidas)|
 */
export default async function AdministracionLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let state: AccountingState
  try {
    state = await getAccountingState(tenantSlug)
  } catch (error) {
    // Igual que el layout del panel (los dos corren en paralelo).
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=session&redirectTo=/${tenantSlug}/administracion`)
    }
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  if (!state.eligible) notFound()

  if (!state.enabled) {
    if (state.isAccountant) return <AdministracionApagada />
    notFound()
  }

  if (!state.setUp) {
    if (state.canSetUp) {
      return (
        <SetupGate configurarHref={`/${tenantSlug}/administracion/configurar`}>
          {children}
        </SetupGate>
      )
    }
    return (
      <AdministracionPendiente
        who={state.isAccountant ? 'accountant' : 'owner'}
        adminNames={state.adminNames}
      />
    )
  }

  if (!state.read) return <AdministracionSinAcceso adminNames={state.adminNames} />

  return (
    <AccountingProvider
      tenantSlug={tenantSlug}
      today={todayInCordoba()}
      access={{ read: state.read, write: state.write, admin: state.admin }}
    >
      {state.isAccountant ? (
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
          <ReadOnlyBanner />
        </div>
      ) : null}
      {children}
    </AccountingProvider>
  )
}
