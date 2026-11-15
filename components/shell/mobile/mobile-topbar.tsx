'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { BrandWordmark } from '../brand-mark'
import { AccountAvatar, AccountPanel } from './account-panel'
import { AppSheet } from './app-sheet'

/** Lo que mide la barra de arriba (h-14): debajo de esto, el título grande ya no se ve. */
const TOPBAR_PX = 56

/**
 * La parte del celular de la barra de arriba (debajo de 1024 px), a la manera de iOS:
 *
 * - Arriba de todo la barra es transparente y no tiene borde; apenas la página se corre, pasa a vidrio
 *   con un borde que se desvanece (lo dibuja `[data-app-topbar]::before` en mobile.css).
 * - A la izquierda va la marca del bar. Cuando el título grande de la página (su `h1`) se va por debajo de
 *   la barra, la marca se funde con ese mismo título, chico y centrado, como los títulos grandes de iOS.
 */
export function MobileTopbarTitle({
  homeHref,
  tenantName,
  logoUrl,
}: {
  homeHref: string
  tenantName: string
  logoUrl: string | null
}) {
  const pathname = usePathname()
  const ref = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  // Vidrio al correr la página: se marca en el <header> (lo pinta el CSS, sin re-render por scroll).
  useEffect(() => {
    const header = ref.current?.closest('header')
    if (!header) return
    let frame = 0
    const update = () => {
      frame = 0
      if (window.scrollY > 2) header.setAttribute('data-scrolled', '')
      else header.removeAttribute('data-scrolled')
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // El título grande de la página: cuando pasa por debajo de la barra, aparece chico en la barra. El h1
  // puede llegar tarde (la página se transmite en partes), así que se lo busca de nuevo cuando cambia el
  // contenido de <main>.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hay que volver a buscar el título en cada pantalla nueva
  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    let observed: Element | null = null
    let io: IntersectionObserver | null = null
    const watch = () => {
      const h1 = main.querySelector('h1')
      if (h1 === observed) return
      io?.disconnect()
      observed = h1
      if (!h1) {
        setTitle(null)
        setCollapsed(false)
        return
      }
      setTitle(h1.textContent?.replace(/\s+/g, ' ').trim() || null)
      io = new IntersectionObserver(
        ([entry]) => {
          if (!entry) return
          setCollapsed(!entry.isIntersecting && entry.boundingClientRect.top < TOPBAR_PX)
        },
        { rootMargin: `-${TOPBAR_PX}px 0px 0px 0px` },
      )
      io.observe(h1)
    }
    watch()
    // Una vez por cuadro alcanza (una lista en vivo puede cambiar muchas veces seguidas).
    let pending = 0
    const mutations = new MutationObserver(() => {
      if (!pending)
        pending = requestAnimationFrame(() => {
          pending = 0
          watch()
        })
    })
    mutations.observe(main, { childList: true, subtree: true })
    return () => {
      mutations.disconnect()
      if (pending) cancelAnimationFrame(pending)
      io?.disconnect()
    }
  }, [pathname])

  const showTitle = collapsed && title !== null

  return (
    <div ref={ref} className="app-topbar-lead lg:hidden">
      <Link
        href={homeHref}
        aria-label={`Ir al inicio de ${tenantName}`}
        className={cn('app-topbar-brand', showTitle && 'is-away')}
        tabIndex={showTitle ? -1 : undefined}
      >
        {logoUrl ? (
          // biome-ignore lint/performance/noImgElement: logo del bar desde Storage (igual que el menú lateral)
          <img src={logoUrl} alt="" className="h-7 w-auto max-w-[120px] object-contain" />
        ) : (
          <BrandWordmark className="text-[19px]" />
        )}
      </Link>
      <p aria-hidden className={cn('app-topbar-title', showTitle && 'is-shown')}>
        {title}
      </p>
    </div>
  )
}

/** El avatar de la barra de arriba en el celular: abre tu cuenta en una hoja. */
export function MobileAccountButton({
  email,
  roleLabel,
  tenantName,
}: {
  email: string
  roleLabel: string
  tenantName: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="app-topbar-avatar lg:hidden"
        aria-label="Tu cuenta"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <AccountAvatar email={email} />
      </button>
      <AppSheet
        open={open}
        onOpenChange={setOpen}
        title="Tu cuenta"
        description="Apariencia, ver como otro rol, contraseña y cerrar sesión."
      >
        <AccountPanel
          email={email}
          roleLabel={roleLabel}
          tenantName={tenantName}
          onDone={() => setOpen(false)}
        />
      </AppSheet>
    </>
  )
}
