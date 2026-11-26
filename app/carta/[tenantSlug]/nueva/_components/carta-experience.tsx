'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { hapticTick } from '@/components/shell/dock/haptics'
import {
  buildCartaRoots,
  type CartaPlace,
  cartaGreeting,
  cartaHash,
  type Daypart,
  parseCartaHash,
  resolveCartaPlace,
} from '@/lib/menu/carta'
import type { MenuItem } from '@/lib/menu/queries'
import type { CartaSponsor } from '@/lib/menu/sponsors'
import type { MenuTreeNode } from '@/lib/menu/tree'
import { CartaCategory, sectionDomId } from './carta-category'
import { CartaDock } from './carta-dock'
import { CartaHome } from './carta-home'
import { CartaSearch, type CartaSearchHandle } from './carta-search'
import type { StageRequest } from './item-stage'
import { WalletDrawer, type WalletDrawerHandle, type WalletSummary } from './wallet-drawer'

/** Estado de apertura pasado por deep-link (?club / ?wallet). */
type InitialSheet = 'none' | 'club' | 'wallet'

// La ficha (con su motor de gestos) y el alta del club (con el campo de teléfono y sus datos de todos
// los países) pesan y no hacen falta para ver la carta: se bajan aparte. Apenas la página queda quieta
// se traen de fondo, así cuando alguien toca un plato ya están.
const loadStage = () => import('./item-stage')
const loadClub = () => import('../../_components/club-sheet')
const ItemStage = dynamic(() => loadStage().then((module) => module.ItemStage), { ssr: false })
const ClubSheet = dynamic(() => loadClub().then((module) => module.ClubSheet), { ssr: false })

const HOME: CartaPlace = { root: null, section: null }

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** El `#` no se manda al servidor: la carta entera es una sola página y el lugar va ahí. */
const urlFor = (place: CartaPlace) =>
  `${window.location.pathname}${window.location.search}${cartaHash({ root: place.root, section: null })}`

/**
 * La carta pública, del lado del celular. Arma los rubros (`lib/menu/carta.ts`), sabe en qué lugar está
 * parado quien mira y coordina lo que se abre por encima: la ficha de un producto, el buscador, el club
 * y la billetera.
 *
 * **El lugar** (inicio o un rubro) va en el `#` de la URL. Entrar a un rubro suma un paso al historial,
 * así el «atrás» del teléfono vuelve al inicio en vez de sacar de la carta; pasar de un rubro a otro lo
 * reemplaza (para volver alcanza un «atrás»). Donde el navegador lo permite, el cambio de lugar es una
 * transición: el nombre del rubro viaja entre la portada y el título.
 */
export function CartaExperience(props: {
  tenantName: string
  logoUrl: string | null
  tree: MenuTreeNode[]
  tenantSlug: string
  captureLinkSlug: string | null
  walletContent: React.ReactNode | null
  walletSummary: WalletSummary | null
  initialSheet: InitialSheet
  sponsors: CartaSponsor[]
  /** La parte del día en el reloj del bar, para el saludo. */
  daypart: Daypart
}): React.JSX.Element {
  const { tenantName, logoUrl, tree, tenantSlug, captureLinkSlug, walletContent } = props
  const { walletSummary, sponsors, daypart } = props
  const member = Boolean(walletContent && walletSummary)

  const roots = useMemo(() => buildCartaRoots(tree), [tree])
  const itemsById = useMemo(() => {
    const map = new Map<string, MenuItem>()
    for (const root of roots) {
      for (const section of root.sections) for (const item of section.items) map.set(item.id, item)
    }
    return map
  }, [roots])
  const featured = useMemo(
    () => [...itemsById.values()].filter((item) => item.featured),
    [itemsById],
  )
  // Si la carta se actualiza con una ficha abierta (carta-freshness), la ficha muestra el producto de
  // la carta nueva: el precio de adentro también queda al día.
  const resolveItem = useCallback((id: string) => itemsById.get(id) ?? null, [itemsById])

  // ── El lugar ────────────────────────────────────────────────────────────────
  const [place, setPlace] = useState<CartaPlace>(HOME)
  /** El rubro cuyo nombre viaja en la transición (el que se abre, o del que se vuelve). */
  const [travelRoot, setTravelRoot] = useState<string | null>(null)
  /** La entrada animada del inicio corre una sola vez: la primera vez que se lo dibuja. */
  const [introDone, setIntroDone] = useState(false)
  const placeRef = useRef(place)
  placeRef.current = place
  /** ¿El rubro abierto se sumó al historial desde el inicio? Entonces «volver» es un paso atrás. */
  const pushedRef = useRef(false)
  /** Dónde estaba el inicio al salir de él, para dejarlo igual al volver. */
  const homeScrollRef = useRef(0)
  /** La sección de la dirección con la que se entró: se baja hasta ella cuando su rubro ya está dibujado. */
  const landingSectionRef = useRef<string | null>(null)

  const resolved = useMemo(() => resolveCartaPlace(roots, place), [roots, place])

  /** Cambia de lugar y, recién con la pantalla nueva ya armada, acomoda el scroll. */
  const move = useCallback((next: CartaPlace, afterRender: () => void) => {
    const from = placeRef.current
    const run = () => {
      flushSync(() => {
        setPlace(next)
        setIntroDone(true)
        setTravelRoot(next.root ?? from.root)
      })
      afterRender()
    }
    const doc = document as Document & { startViewTransition?: (update: () => void) => unknown }
    if (typeof doc.startViewTransition === 'function' && !reducedMotion()) {
      doc.startViewTransition(run)
    } else {
      run()
    }
  }, [])

  const scrollToSection = useCallback((sectionSlug: string | null, smooth: boolean) => {
    const element = sectionSlug
      ? document.getElementById(sectionDomId({ slug: sectionSlug }))
      : null
    if (!element) {
      window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' })
      return
    }
    const rail = document.querySelector<HTMLElement>('[data-carta-rail]')?.offsetHeight ?? 0
    const top = element.getBoundingClientRect().top + window.scrollY - rail - 6
    window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  const openRoot = useCallback(
    (rootSlug: string, sectionSlug: string | null = null) => {
      const current = placeRef.current
      if (current.root === rootSlug) {
        scrollToSection(sectionSlug, !reducedMotion())
        return
      }
      const next: CartaPlace = { root: rootSlug, section: sectionSlug }
      if (current.root === null) {
        homeScrollRef.current = window.scrollY
        window.history.pushState(null, '', urlFor(next))
        pushedRef.current = true
        // La portada tiene que llevar el nombre que viaja ANTES de la foto de la pantalla vieja.
        flushSync(() => setTravelRoot(rootSlug))
      } else {
        window.history.replaceState(null, '', urlFor(next))
      }
      move(next, () => scrollToSection(sectionSlug, false))
    },
    [move, scrollToSection],
  )

  const goHome = useCallback(() => {
    const current = placeRef.current
    if (current.root === null) {
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
      return
    }
    if (pushedRef.current) {
      // El inicio está un paso atrás en el historial: `popstate` hace el resto.
      window.history.back()
      return
    }
    // Se entró directo a un rubro (un QR, un link): no hay inicio detrás, se lo pone en su lugar.
    window.history.replaceState(null, '', urlFor(HOME))
    move(HOME, () => window.scrollTo(0, 0))
  }, [move])

  useEffect(() => {
    // La carta acomoda su propio scroll al cambiar de lugar (el navegador restauraría el del rubro
    // sobre el inicio, que mide otra cosa).
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'

    // La dirección con la que se entró (`#bebidas/tragos-hub`).
    const initial = parseCartaHash(window.location.hash)
    if (initial.root) {
      landingSectionRef.current = initial.section
      setIntroDone(true)
      setPlace(initial)
    }

    const onPop = () => {
      const next = parseCartaHash(window.location.hash)
      // El «atrás» que cierra una hoja (la ficha, el buscador) no cambia de lugar.
      if (next.root === placeRef.current.root) return
      if (next.root === null) pushedRef.current = false
      move(next, () => {
        if (next.root === null) window.scrollTo(0, homeScrollRef.current)
        else scrollToSection(next.section, false)
      })
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.history.scrollRestoration = previous
    }
  }, [move, scrollToSection])

  useEffect(() => {
    if (!resolved.root || !landingSectionRef.current) return
    scrollToSection(landingSectionRef.current, false)
    landingSectionRef.current = null
  }, [resolved.root, scrollToSection])

  // La carta se puede actualizar con alguien adentro de un rubro que ya no está (terminó su horario,
  // lo pausaron): vuelve al inicio en vez de quedar mirando una pantalla que no existe.
  useEffect(() => {
    if (place.root === null || resolved.root !== null) return
    pushedRef.current = false
    window.history.replaceState(null, '', urlFor(HOME))
    setPlace(HOME)
    window.scrollTo(0, 0)
  }, [place.root, resolved.root])

  // ── Lo que se abre por encima ───────────────────────────────────────────────
  const [stage, setStage] = useState<StageRequest | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [clubOpen, setClubOpen] = useState(props.initialSheet === 'club')
  // Se montan apenas llega su código (cerradas) o, si alguien las pide antes, en ese momento; y quedan
  // (la ficha sigue dibujada mientras se va). Montarlas cerradas importa: una hoja que nace abierta
  // suma su paso de «atrás» al nacer, y React en desarrollo monta dos veces lo que nace.
  const [stageUsed, setStageUsed] = useState(false)
  const [clubUsed, setClubUsed] = useState(props.initialSheet === 'club')

  useEffect(() => {
    let alive = true
    const warm = () => {
      loadStage().then(
        () => alive && setStageUsed(true),
        () => {},
      )
      loadClub().then(
        () => alive && setClubUsed(true),
        () => {},
      )
    }
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(warm, { timeout: 2500 })
      return () => {
        alive = false
        window.cancelIdleCallback(idle)
      }
    }
    // Safari no tiene `requestIdleCallback`: un momento después de dibujar alcanza.
    const timer = window.setTimeout(warm, 1200)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])
  const [walletOpen, setWalletOpen] = useState(props.initialSheet === 'wallet' && member)
  const searchRef = useRef<CartaSearchHandle>(null)
  const walletRef = useRef<WalletDrawerHandle>(null)

  // El sheet inicial ya se sembró desde ?club/?wallet; limpiamos el query de la
  // URL para que al cerrar y recargar/compartir no se vuelva a abrir solo.
  useEffect(() => {
    if (props.initialSheet === 'none') return
    const url = new URL(window.location.href)
    url.searchParams.delete('club')
    url.searchParams.delete('wallet')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [props.initialSheet])

  const openItem = useCallback((item: MenuItem, from: HTMLElement | null, list: MenuItem[]) => {
    hapticTick()
    setStageUsed(true)
    setStage({ item, from, list })
  }, [])
  const openFeatured = useCallback(
    (item: MenuItem, from: HTMLElement | null) => openItem(item, from, featured),
    [featured, openItem],
  )
  const closeStage = useCallback(() => setStage(null), [])
  const openSearch = useCallback(() => searchRef.current?.open(), [])
  const openClub = useCallback(() => {
    if (member) {
      walletRef.current?.open()
      return
    }
    setClubUsed(true)
    setClubOpen(true)
  }, [member])

  const overlay = stage !== null || searchOpen

  return (
    <div className="carta">
      {/* Con la ficha o el buscador encima, la página de atrás no recibe foco ni la lee el lector de pantalla. */}
      <div data-art-scope inert={overlay}>
        {resolved.root ? (
          <CartaCategory
            key={resolved.root.id}
            tenantName={tenantName}
            roots={roots}
            root={resolved.root}
            startSection={resolved.section}
            sponsors={sponsors}
            onHome={goHome}
            onOpenRoot={openRoot}
            onOpenItem={openItem}
          />
        ) : (
          <CartaHome
            tenantName={tenantName}
            logoUrl={logoUrl}
            greeting={cartaGreeting(daypart, walletSummary?.firstName)}
            roots={roots}
            featured={featured}
            sponsors={sponsors}
            member={member}
            intro={!introDone}
            titleFor={travelRoot}
            onOpenRoot={openRoot}
            onOpenItem={openFeatured}
            onSearch={openSearch}
            onClub={openClub}
          />
        )}
      </div>

      <CartaDock
        member={member}
        hidden={overlay || clubOpen || walletOpen}
        onCarta={goHome}
        onClub={openClub}
        onSearch={openSearch}
      />

      <CartaSearch
        ref={searchRef}
        roots={roots}
        onOpenItem={openItem}
        onGo={openRoot}
        onOpenChange={setSearchOpen}
      />

      {stageUsed ? (
        <ItemStage request={stage} resolve={resolveItem} sponsors={sponsors} onClose={closeStage} />
      ) : null}

      {walletContent && walletSummary ? (
        <WalletDrawer
          ref={walletRef}
          summary={walletSummary}
          tenantSlug={tenantSlug}
          initialOpen={props.initialSheet === 'wallet'}
          onOpenChange={setWalletOpen}
        >
          {walletContent}
        </WalletDrawer>
      ) : null}

      {clubUsed ? (
        <ClubSheet
          open={clubOpen}
          onClose={() => setClubOpen(false)}
          tenantName={tenantName}
          logoUrl={logoUrl}
          linkSlug={captureLinkSlug}
        />
      ) : null}
    </div>
  )
}
