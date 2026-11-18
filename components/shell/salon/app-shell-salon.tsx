import { BranchScopeProvider } from '@/components/branches/branch-scope-provider'
import { PosPrintStation } from '@/components/pos/print/print-station'
import { signOutAction } from '@/components/shell/sign-out-action'
import type { BranchScopeClient } from '@/lib/branches/types'
import { getEffectiveFeatures } from '@/lib/platform/features'
import type { Tenant, TenantRole } from '@/lib/tenant/types'
import { ViewAsProvider, type ViewAsState } from '../view-as'
import { AccountSheet } from './account-sheet'
import { BottomTabBar } from './bottom-tab-bar'
import { PwaInstallPrompt } from './install-prompt'
import { SalonMain } from './salon-main'
import { SalonTopbar } from './salon-topbar'
import { ServiceWorkerRegistration } from './service-worker-registration'

/**
 * Shell del salón. Define el CONTRATO DE SCROLL del workspace:
 *
 *   → scrollea el documento, y nada más.
 *
 * Ninguna página del salón puede abrir su propio `h-[100dvh]` ni su propio
 * `overflow-auto`: eso era exactamente lo que producía el doble scroll (el
 * operativo de reservas metía un `100dvh` DENTRO de un main que ya tenía topbar
 * + padding, así que el documento medía 100dvh + 160px y adentro había otra
 * región scrolleable). Con el documento como único scroller, además, funciona
 * el pull-to-refresh, que escucha `window.scrollY`.
 *
 * Los altos del chrome son tokens (`--salon-topbar-h`, `--salon-tabbar-h`), no
 * números sueltos: la tab bar declara el suyo y el contenido lo consume.
 *
 * NO hace I/O: `isPlatformAdmin` y `email` vienen del `requireTenantAccess` del
 * layout (un solo round-trip). Antes el shell pagaba 2 hops más por navegación.
 */
export function AppShellSalon({
  tenant,
  role,
  isPlatformAdmin,
  email,
  viewAs = null,
  printStation = null,
  branchScope,
  children,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'feature_flags'>
  role: TenantRole
  isPlatformAdmin: boolean
  email: string
  /** «Ver como» para la hoja «Tu cuenta»; null si esta persona no puede usarlo. */
  viewAs?: ViewAsState | null
  /**
   * Con el punto de venta: las sucursales del bar, para que la compu que tiene la comandera imprima
   * sola las comandas desde cualquier pantalla del salón. No dibuja nada, y no hace nada en un
   * dispositivo que no prendió «Imprimir las comandas acá» (se guarda por sucursal en cada uno).
   */
  printStation?: { branchIds: string[]; timeZone: string } | null
  /** La sucursal en la que trabaja este dispositivo (`getBranchScope(slug, 'device')`). */
  branchScope: BranchScopeClient
  children: React.ReactNode
}) {
  const features = getEffectiveFeatures(tenant)

  return (
    <BranchScopeProvider slug={tenant.slug} scope={branchScope} surface="device">
      <ViewAsProvider value={viewAs}>
        <div className="bg-app-gradient relative flex min-h-[100dvh] flex-col">
          <SalonTopbar
            tenant={tenant}
            account={
              <AccountSheet
                email={email}
                role={role}
                tenantName={tenant.name}
                tenantSlug={tenant.slug}
                signOut={signOutAction}
              />
            }
          />

          <SalonMain>{children}</SalonMain>

          <BottomTabBar
            tenantSlug={tenant.slug}
            role={role}
            features={features}
            isPlatformAdmin={isPlatformAdmin}
          />

          {printStation?.branchIds.map((branchId) => (
            <PosPrintStation
              key={branchId}
              slug={tenant.slug}
              branchId={branchId}
              timeZone={printStation.timeZone}
            />
          ))}
          <ServiceWorkerRegistration />
          <PwaInstallPrompt />
        </div>
      </ViewAsProvider>
    </BranchScopeProvider>
  )
}
