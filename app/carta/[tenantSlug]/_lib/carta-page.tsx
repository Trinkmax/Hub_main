import 'server-only'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { cache } from 'react'
import { preconnect } from 'react-dom'
import { WalletShell } from '@/app/c/[token]/_components/wallet-shell'
import { BrandAccent } from '@/components/theme/brand-accent-provider'
import { getAppUrl } from '@/lib/app-url'
import type { BranchRef } from '@/lib/branches/types'
import { getCanonicalCaptureLink } from '@/lib/capture/canonical'
import { walletCookieName } from '@/lib/capture/cookie'
import { serviceDayInCordoba } from '@/lib/dates/zone'
import { getSupabaseClientEnv } from '@/lib/env'
import { localClock, visibleNow } from '@/lib/menu/availability'
import { type Daypart, daypartOf } from '@/lib/menu/carta'
import {
  applyBranchOverrides,
  type CartaBranchView,
  type CartaPickerBranch,
  cartaBranchHref,
  cartaPickerHref,
  celebrationOf,
  findBranchBySlug,
} from '@/lib/menu/carta-branch'
import {
  listActiveMenuPublic,
  listCartaBranches,
  listItemBranchOverrides,
} from '@/lib/menu/queries'
import { getMenuRev } from '@/lib/menu/revision'
import type { CartaSponsor } from '@/lib/menu/sponsors'
import { parseCartaSponsors } from '@/lib/menu/sponsors-schema'
import { buildCategoryTree, type MenuTreeNode } from '@/lib/menu/tree'
import { isFeatureEnabled } from '@/lib/platform/features'
import { createServiceClient } from '@/lib/supabase/service'
import { getWalletByToken, type WalletData } from '@/lib/wallet/queries'
import { CartaFreshness } from '../_components/carta-freshness'
import type { WalletSummary } from '../_components/wallet-drawer'
import '../carta.css'

/**
 * La carta pública de un bar, del lado del servidor. Hay **dos cartas** sobre los mismos datos:
 *
 * - la **clásica** (`../_components/`), que es la que ven los clientes en `/carta/<bar>`;
 * - la **nueva** (`../nueva/_components/`, `docs/features/carta-rediseno.md`), el rediseño de noviembre
 *   de 2026. Vive en `/carta/<bar>/nueva` para seguir viéndola y trabajándola, y pasa a ser la de todos
 *   cuando al bar se le prende el interruptor «Carta nueva» (`carta_nueva`, en `/admin`).
 *
 * Las dos rutas leen por acá (`loadCarta`): una sola forma de traer el bar, su menú a esta hora, la
 * billetera de quien mira y los sponsors. Qué pantalla dibuja cada una lo decide su `page.tsx`, y cada
 * página importa solo la suya: así el celular no baja el código de la carta que no está viendo.
 *
 * **Sucursales** (`docs/features/carta-por-sucursal.md`): si el bar tiene dos o más, la dirección del QR
 * abre primero el selector (`resolveCarta`) y cada sucursal tiene su carta en `?sucursal=<slug>`: la del
 * bar menos lo que ahí no se vende y con su precio propio (`menu_item_branches`).
 */
export type CartaData = {
  tenant: { id: string; name: string; logoUrl: string | null; brandAccent: string | null }
  /** La sucursal de esta carta, si el bar tiene para elegir (la pastilla de arriba y la fiesta). */
  branch: CartaBranchView | null
  tree: MenuTreeNode[]
  sponsors: CartaSponsor[]
  /** La parte del día en el reloj del bar (para el saludo de la carta nueva). */
  daypart: Daypart
  menuRev: number
  renderedAt: number
  changeInMs: number | null
  walletContent: React.ReactNode | null
  walletSummary: WalletSummary | null
  initialSheet: 'none' | 'club' | 'wallet'
  captureLinkSlug: string | null
  /** El bar tiene prendido «Carta nueva»: la dirección del QR muestra la nueva. */
  nuevaParaTodos: boolean
}

type TenantRow = {
  id: string
  name: string
  logo_url: string | null
  brand_accent: string | null
  timezone: string | null
  /** La bolsa de configuración del bar; de acá salen los sponsors de la carta (`carta_sponsors`). */
  settings: unknown
  feature_flags: Record<string, boolean> | null
}

export type CartaPickerData = {
  tenant: { name: string; logoUrl: string | null; brandAccent: string | null }
  branches: CartaPickerBranch[]
}

/**
 * Qué muestra la dirección de la carta:
 * - `picker`: el bar tiene dos o más sucursales y el link no dice cuál → el selector.
 * - `carta`: la carta de `branch` (con lo suyo), o la del bar entera si no tiene sucursales cargadas.
 *   `choosable` = hay otras sucursales a las que cambiar.
 */
export type CartaEntry =
  | { kind: 'picker'; data: CartaPickerData }
  | { kind: 'carta'; branch: BranchRef | null; choosable: boolean }

export type CartaSearchParams = { club?: string; wallet?: string; sucursal?: string }

/** La hora del bar si la fila viniera sin zona. */
const DEFAULT_TIME_ZONE = 'America/Argentina/Cordoba'

// `cache` de React: generateMetadata y la page piden el mismo tenant en el
// mismo request; sin esto son dos hops idénticos a Supabase por render.
const resolveTenant = cache(async (slug: string): Promise<TenantRow | null> => {
  const service = createServiceClient()
  const { data } = await service
    .from('tenants')
    .select('id, name, logo_url, brand_accent, timezone, settings, feature_flags')
    .eq('slug', slug)
    .maybeSingle()
  return (data as TenantRow | null) ?? null
})

const resolveBranches = cache(async (tenantId: string) => listCartaBranches(tenantId))

/** Selector o carta, según las sucursales del bar y lo que pide el link. Si el bar no existe, 404. */
export async function resolveCarta(tenantSlug: string, sp: CartaSearchParams): Promise<CartaEntry> {
  const tenant = await resolveTenant(tenantSlug)
  if (!tenant) notFound()
  const branches = await resolveBranches(tenant.id)
  if (branches.length < 2) return { kind: 'carta', branch: branches[0] ?? null, choosable: false }

  const chosen = findBranchBySlug(branches, sp.sucursal)
  if (chosen) return { kind: 'carta', branch: chosen, choosable: true }

  const serviceDay = serviceDayInCordoba(Date.now())
  const extra = { club: sp.club != null, wallet: sp.wallet != null }
  return {
    kind: 'picker',
    data: {
      tenant: { name: tenant.name, logoUrl: tenant.logo_url, brandAccent: tenant.brand_accent },
      branches: branches.map((branch) => ({
        id: branch.id,
        name: branch.name,
        slug: branch.slug,
        address: branch.address,
        color: branch.color,
        href: cartaBranchHref(tenantSlug, branch.slug, extra),
        celebration: celebrationOf(branch.openedOn, serviceDay),
      })),
    },
  }
}

export async function cartaMetadata(
  tenantSlug: string,
  options: { preview?: boolean; sucursal?: string } = {},
): Promise<Metadata> {
  const tenant = await resolveTenant(tenantSlug)
  if (!tenant) return { title: 'Carta' }
  const branches = options.sucursal ? await resolveBranches(tenant.id) : []
  const branch = branches.length > 1 ? findBranchBySlug(branches, options.sucursal) : null
  const where = branch ? `${tenant.name} ${branch.name}` : tenant.name
  return {
    title: `Carta · ${where}`,
    description: `La carta de ${where}.`,
    // La dirección para verla antes de tiempo no es para que la encuentre un buscador.
    ...(options.preview ? { robots: { index: false, follow: false } } : {}),
  }
}

/** Lee la cookie de identidad y devuelve la wallet sólo si es del mismo tenant. */
async function resolveWallet(tenantId: string): Promise<WalletData | null> {
  const store = await cookies()
  const token = store.get(walletCookieName(tenantId))?.value
  if (!token) return null
  const wallet = await getWalletByToken(token)
  if (!wallet || wallet.tenant.id !== tenantId) return null
  return wallet
}

/**
 * Todo lo que una carta necesita para dibujarse. Si el bar no existe, 404.
 *
 * `place` es la sucursal que dio `resolveCarta`: su carta saca lo que ahí no se vende y lleva su precio propio.
 * Sin sucursal (las rutas que no pasan por el selector, como la vista previa de la carta nueva sin `?sucursal=`)
 * se ve la carta del bar entera.
 */
export async function loadCarta(
  tenantSlug: string,
  sp: CartaSearchParams,
  place: { branch: BranchRef | null; choosable: boolean } = { branch: null, choosable: false },
): Promise<CartaData> {
  // Todas las fotos vienen de Supabase Storage: abrir DNS + TLS contra ese host
  // desde el <head> ahorra ~100–300 ms en la primera imagen en 4G.
  preconnect(new URL(getSupabaseClientEnv().url).origin)

  const tenant = await resolveTenant(tenantSlug)
  if (!tenant) notFound()
  const { branch } = place

  // La versión de la carta (docs/features/carta-al-dia.md) va en el mismo viaje y primera: si un
  // cambio cae justo mientras se arma la página, lo probable es número viejo con carta nueva (un
  // refresh de más en el celular) y no al revés.
  const [menuRev, menu, overrides, wallet, captureLinkSlug] = await Promise.all([
    getMenuRev(tenant.id),
    listActiveMenuPublic({ tenantId: tenant.id }),
    branch ? listItemBranchOverrides(tenant.id, branch.id) : Promise.resolve([]),
    resolveWallet(tenant.id),
    getCanonicalCaptureLink(tenant.id),
  ])
  const categories = menu.categories
  // Lo que en esta sucursal no se vende no llega al celular (tampoco al buscador ni a los destacados), y lo que
  // tiene precio propio llega con ese precio.
  const items = applyBranchOverrides(menu.items, overrides)
  // Los rubros con horario (el menú del mediodía, el del fin de semana) se sacan acá, con la hora del
  // bar: ni sus subcategorías ni sus productos llegan al celular, así tampoco salen en el buscador ni
  // en los destacados. La página no se guarda en el servidor (`force-dynamic`), así que cada pedido
  // se arma con la hora de ese momento; `changeInMs` le dice a la carta abierta cuándo volver a pedirse.
  const renderedAt = Date.now()
  const timeZone = tenant.timezone || DEFAULT_TIME_ZONE
  const visible = visibleNow({ categories, items }, renderedAt, timeZone)

  let walletContent: React.ReactNode = null
  if (wallet) {
    const appUrl = await getAppUrl()
    const qrDataUrl = await QRCode.toDataURL(`${appUrl}/c/${wallet.customer.qrToken}`, {
      width: 360,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
    walletContent = <WalletShell data={wallet} qrDataUrl={qrDataUrl} embedded />
  }

  const wantsClub = sp.club != null
  const wantsWallet = sp.wallet != null

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      logoUrl: tenant.logo_url,
      brandAccent: tenant.brand_accent,
    },
    branch:
      branch && place.choosable
        ? {
            name: branch.name,
            slug: branch.slug,
            color: branch.color,
            celebration: celebrationOf(branch.openedOn, serviceDayInCordoba(renderedAt)),
            pickerHref: cartaPickerHref(tenantSlug),
          }
        : null,
    tree: buildCategoryTree(visible.categories, visible.items),
    sponsors: parseCartaSponsors(tenant.settings),
    // El saludo sigue el reloj del bar, igual que los horarios de los rubros: sale ya escrito del
    // servidor (el teléfono de quien mira puede estar en otra hora).
    daypart: daypartOf(localClock(renderedAt, timeZone).minutes),
    menuRev,
    renderedAt,
    changeInMs: visible.changeInMs,
    walletContent,
    // Resumen serializable para el header del sheet (logo, saludo, nivel).
    walletSummary: wallet
      ? {
          tenantName: wallet.tenant.name,
          logoUrl: wallet.tenant.logoUrl,
          firstName: wallet.customer.firstName,
          tierName: wallet.tier.current?.name ?? null,
          tierColor: wallet.tier.current?.color ?? null,
        }
      : null,
    initialSheet:
      wantsWallet && wallet ? 'wallet' : wantsClub ? (wallet ? 'wallet' : 'club') : 'none',
    captureLinkSlug,
    nuevaParaTodos: isFeatureEnabled({ feature_flags: tenant.feature_flags ?? {} }, 'carta_nueva'),
  }
}

/** El marco del selector de sucursal: el acento del bar y el fondo de la carta (no hay carta que mantener al día). */
export function CartaPickerFrame({
  brandAccent,
  children,
}: {
  brandAccent: string | null
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <BrandAccent accent={brandAccent} className="force-light min-h-[100dvh] bg-background">
      {children}
    </BrandAccent>
  )
}

/** Lo que envuelve a cualquiera de las dos cartas: el acento del bar, la conexión anticipada a las fotos y el vigía que la mantiene al día. */
export function CartaFrame({
  data,
  children,
}: {
  data: CartaData
  children: React.ReactNode
}): React.JSX.Element {
  // Las fotos/videos vienen de Supabase Storage: preconnect para ahorrar el
  // handshake TLS en la primera imagen. React 19 hoistea los <link> al <head>.
  let storageOrigin: string | null = null
  try {
    storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin
  } catch {
    storageOrigin = null
  }

  return (
    <BrandAccent
      accent={data.tenant.brandAccent}
      className="force-light min-h-[100dvh] bg-background"
    >
      {storageOrigin ? (
        <>
          <link rel="preconnect" href={storageOrigin} />
          <link rel="dns-prefetch" href={storageOrigin} />
        </>
      ) : null}
      {/* La carta abierta en el celular pregunta si cambió al volver a mirarla y se refresca sola. */}
      <CartaFreshness
        tenantId={data.tenant.id}
        rev={data.menuRev}
        renderedAt={data.renderedAt}
        changeInMs={data.changeInMs}
      />
      {children}
    </BrandAccent>
  )
}
