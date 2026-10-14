import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { AccountingProvider } from '@/components/administracion/accounting-provider'
import { AdmNav } from '@/components/administracion/nav/adm-nav'
import { AdmFab } from '@/components/administracion/nav/launcher-fab'
import { ReadOnlyBanner } from '@/components/administracion/read-only'
import { resolveSection } from '@/components/shell/section-tabs-config'
import { loadSectionViewer } from '@/components/shell/section-tabs-server'
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
 * Las acciones de ARCA corren dentro de la función de la página que las llama: «Probar
 * conexión» y «Completar con ARCA» pueden tardar cerca de un minuto con sus topes (fase 2,
 * §6.1). Vale para todas las páginas de Administración (las server actions usan el límite de su
 * página); cada llamada a ARCA se corta antes, en ~50 s.
 */
export const maxDuration = 60

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
 *
 * La navegación de la sección (`AdmNav`: Resumen, Ventas, Compras y pagos, Gastos fijos y Cajas
 * como píldoras; Importar, Libros y Plan de cuentas más callados; Guía, Ajustes y «Cargar») va
 * arriba de todo SOLO en la última fila: nunca en las pantallas de la puerta ni en el asistente.
 * Qué pestañas ve cada uno lo sigue resolviendo `resolveSection` (la misma regla del menú);
 * `AdmNav` solo las ordena y las dibuja.
 *
 * `AdmFab` es el «＋ Cargar» flotante del celular: lo pone este marco en las pantallas de primer
 * nivel (menos Ajustes y la Guía: ver `admFabFromFrame`), para que esté siempre en el mismo
 * lugar. No se dibuja para la contadora ni en las pantallas de tarea, que tienen su propio pie.
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

  // La misma resolución cacheada que ya usó `getAccountingState`: sin otro viaje a la base.
  const section = resolveSection('administracion', tenantSlug, await loadSectionViewer(tenantSlug))

  return (
    <AccountingProvider
      tenantSlug={tenantSlug}
      today={todayInCordoba()}
      access={{ read: state.read, write: state.write, admin: state.admin }}
    >
      <AdmNav
        label={section.label}
        tabs={section.tabs}
        audience={state.isAccountant ? 'accountant' : 'owner'}
      />
      {state.isAccountant ? (
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
          <ReadOnlyBanner />
        </div>
      ) : null}
      {children}
      <AdmFab />
    </AccountingProvider>
  )
}
