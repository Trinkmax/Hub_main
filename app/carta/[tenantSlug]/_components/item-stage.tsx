'use client'

import { ArrowLeft, ArrowRight, Sparkles, Volume2, VolumeX, X } from 'lucide-react'
import {
  AnimatePresence,
  motion,
  type PanInfo,
  useReducedMotion,
  type Variants,
} from 'motion/react'
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { StorageImage } from '@/components/media/storage-image'
import { hapticTick } from '@/components/shell/dock/haptics'
import { posterUrlFor } from '@/lib/menu/media-urls'
import type { MenuItem } from '@/lib/menu/queries'
import { type CartaSponsor, sponsorsForItem } from '@/lib/menu/sponsors'
import { cn } from '@/lib/utils'
import { DishTags, photoOf } from './dish'
import { formatARS } from './format'
import { SponsorSeal } from './sponsors'
import { useDismissOnBack } from './use-dismiss-on-back'

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/** Lo que pide quien abre un producto. */
export type StageRequest = {
  item: MenuItem
  /** La lista en la que estaba (su sección, o los resultados de la búsqueda): para pasar al siguiente. */
  list: MenuItem[]
  /** El recuadro de su foto en la lista: la ficha la hace crecer desde ahí. `null` si no tiene foto. */
  from: HTMLElement | null
}

type Session = {
  /** Cambia en cada apertura: una ficha nueva, una entrada nueva. */
  key: number
  list: MenuItem[]
  index: number
  from: HTMLElement | null
  /** La imagen que el recuadro de origen ya tenía cargada: se ve al instante mientras llega la grande. */
  placeholder: string | null
}

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const OPEN_MS = 520
const CLOSE_MS = 380
/** Cuánto hay que correr (o con qué envión) para pasar al de al lado. */
const SWIPE_PX = 64
const SWIPE_VELOCITY = 520

let sessions = 0

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** ¿Algo de este recuadro está a la vista? */
function onScreen(rect: DOMRect): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  )
}

/** El recuadro de la foto de un producto en la lista de la que salió la ficha. */
function artOf(itemId: string, near: HTMLElement | null): HTMLElement | null {
  const scope: ParentNode = near?.closest('[data-art-scope]') ?? document
  return scope.querySelector<HTMLElement>(`[data-art-of="${CSS.escape(itemId)}"]`)
}

/**
 * Los dos extremos del vuelo de la foto entre un recuadro de la lista (`small`) y su lugar en la ficha
 * (`big`), dichos como estilos de la foto grande. La escala es una sola (la foto no se deforma) y lo que
 * cambia de forma es el recorte: así sirve igual para una miniatura cuadrada que para una apaisada.
 */
function flightFrames(small: HTMLElement, big: HTMLElement): [Keyframe, Keyframe] {
  const first = small.getBoundingClientRect()
  const last = big.getBoundingClientRect()
  const scale = Math.max(first.width / last.width, first.height / last.height)
  const dx = first.left + first.width / 2 - (last.left + last.width / 2)
  const dy = first.top + first.height / 2 - (last.top + last.height / 2)
  const insetX = Math.max(0, (last.width - first.width / scale) / 2)
  const insetY = Math.max(0, (last.height - first.height / scale) / 2)
  const smallRadius = Number.parseFloat(getComputedStyle(small).borderTopLeftRadius) || 0
  const r = smallRadius / scale
  const style = getComputedStyle(big)
  const corners = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].join(' ')
  return [
    {
      transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
      clipPath: `inset(${insetY}px ${insetX}px round ${r}px ${r}px ${r}px ${r}px)`,
    },
    { transform: 'translate(0px, 0px) scale(1)', clipPath: `inset(0px 0px round ${corners})` },
  ]
}

/** Pasar de un producto al de al lado: el que se va sigue de largo y el que llega entra por el otro lado. */
const slide: Variants = {
  enter: (direction: number) => ({ x: direction * 72, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.36, ease: [0.16, 1, 0.3, 1] } },
  exit: (direction: number) => ({
    x: direction * -160,
    opacity: 0,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
  }),
}

/** Con «reducir movimiento»: se funden en su lugar, sin correrse. */
const slideReduced: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.16 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
}

/**
 * La ficha de un producto: la barra de noche. Al tocar un plato la foto sale de su recuadro y crece
 * hasta ocupar la pantalla mientras todo lo demás se vuelve verde, como cuando se apagan las luces; al
 * cerrar, vuelve a su lugar en la lista.
 *
 * Adentro se pasa de un producto al siguiente de su sección deslizando hacia los costados (o con las
 * flechas del teclado, o con los botones de abajo): se recorre una sección mirando las fotos grandes,
 * sin salir y volver a entrar.
 *
 * Es de solo lectura, como toda la carta: no hay cantidades ni «agregar».
 */
export function ItemStage({
  request,
  resolve,
  sponsors,
  onClose,
}: {
  request: StageRequest | null
  /** El producto como está ahora en la carta (si se actualizó con la ficha abierta, muestra el precio nuevo). */
  resolve: (id: string) => MenuItem | null
  sponsors: CartaSponsor[]
  onClose: () => void
}): React.JSX.Element | null {
  const [session, setSession] = useState<Session | null>(null)
  const [direction, setDirection] = useState(0)
  /** La entrada del texto (por renglones) es de la apertura, no de cada pase al costado. */
  const [fresh, setFresh] = useState(true)

  const rootRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const chromeRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  /** El recuadro de la lista que quedó vacío mientras su foto está en la ficha. */
  const lifted = useRef<HTMLElement | null>(null)
  const closing = useRef(false)
  /** Las animaciones que arrancó esta ficha (las de entrada y las de salida), para poder soltarlas. */
  const running = useRef<Animation[]>([])
  /** Lo que se mueve al tirar la ficha hacia abajo para cerrarla. */
  const pullRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const titleId = useId()
  const reduceMotion = useReducedMotion()

  const open = request !== null
  useDismissOnBack(open, onClose)

  // Llegó un pedido: ficha nueva.
  useEffect(() => {
    if (!request) return
    closing.current = false
    setDirection(0)
    setFresh(true)
    setSession({
      key: ++sessions,
      list: request.list,
      index: Math.max(
        0,
        request.list.findIndex((each) => each.id === request.item.id),
      ),
      from: request.from,
      placeholder: request.from?.querySelector('img')?.currentSrc || null,
    })
  }, [request])

  const sessionKey = session?.key ?? 0

  // La entrada: la sala se oscurece y la foto vuela desde su recuadro.
  // Corre una vez por ficha abierta (`sessionKey`), no cada vez que se pasa de producto.
  useIsoLayoutEffect(() => {
    if (!session) return
    const backdrop = backdropRef.current
    const scroller = scrollerRef.current
    const chrome = chromeRef.current
    // Si se abre un producto mientras la ficha anterior todavía se estaba yendo, son los mismos
    // elementos: se les saca lo que les dejó esa salida (quedarían invisibles).
    for (const animation of running.current) animation.cancel()
    running.current = []
    for (const element of [backdrop, chrome, pullRef.current]) {
      if (!element) continue
      element.style.transition = ''
      element.style.opacity = ''
      element.style.transform = ''
    }
    if (lifted.current && lifted.current !== session.from) {
      lifted.current.style.visibility = ''
      lifted.current = null
    }
    const photo = rootRef.current?.querySelector<HTMLElement>('[data-stage-photo]') ?? null
    const reduce = reducedMotion()
    const fade = { duration: reduce ? 140 : 320, easing: 'ease-out', fill: 'backwards' as const }

    const play = (element: Element | null | undefined, frames: Keyframe[], options: object) => {
      if (element) running.current.push(element.animate(frames, options))
    }
    play(backdrop, [{ opacity: 0 }, { opacity: 1 }], fade)
    play(chrome, [{ opacity: 0 }, { opacity: 1 }], { ...fade, delay: reduce ? 0 : 160 })

    const from = session.from
    if (!reduce && from && photo && from.isConnected && onScreen(from.getBoundingClientRect())) {
      const [start, end] = flightFrames(from, photo)
      from.style.visibility = 'hidden'
      lifted.current = from
      play(photo, [start, end], { duration: OPEN_MS, easing: EASE, fill: 'backwards' })
    } else if (!reduce) {
      play(
        scroller,
        [
          { opacity: 0, transform: 'translateY(32px)' },
          { opacity: 1, transform: 'translateY(0px)' },
        ],
        { duration: 420, easing: EASE, fill: 'backwards' },
      )
    }
    const focus = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 60)
    return () => window.clearTimeout(focus)
  }, [sessionKey])

  // Pidieron cerrar (el botón, «atrás», Escape): la foto vuelve a su recuadro y la sala se aclara.
  useEffect(() => {
    if (request || !session || closing.current) return
    closing.current = true
    const current = session.list[session.index]
    const reduce = reducedMotion()
    const backdrop = backdropRef.current
    const scroller = scrollerRef.current
    const chrome = chromeRef.current
    const root = rootRef.current
    const photo = root?.querySelector<HTMLElement>('[data-stage-photo]') ?? null
    const text = root?.querySelector<HTMLElement>('[data-stage-text]') ?? null
    const duration = reduce ? 120 : CLOSE_MS
    const animations: Animation[] = []
    const out = (element: Element | null | undefined, ms = duration) => {
      if (!element) return
      // Sin punto de partida: sale desde como esté (si la bajaron con el dedo, ya viene a medio apagar).
      animations.push(
        element.animate([{ opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' }),
      )
    }

    // Adónde vuelve: el recuadro del producto que quedó a la vista (puede no ser el que se abrió).
    let target: HTMLElement | null = null
    if (!reduce && current && photo) {
      const sameAsOpened = lifted.current?.dataset.artOf === current.id ? lifted.current : null
      target = sameAsOpened ?? artOf(current.id, session.from)
      if (target && !sameAsOpened) {
        // Se pasó a otro producto: el de antes vuelve a verse y la lista se corre hasta el nuevo.
        if (lifted.current) lifted.current.style.visibility = ''
        if (!onScreen(target.getBoundingClientRect())) {
          target.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
        }
        target.style.visibility = 'hidden'
        lifted.current = target
      }
      if (target && !onScreen(target.getBoundingClientRect())) target = null
    }

    out(backdrop)
    out(chrome, 140)
    if (target && photo) {
      out(text, 140)
      const [small, big] = flightFrames(target, photo)
      animations.push(photo.animate([big, small], { duration, easing: EASE, fill: 'forwards' }))
    } else {
      out(scroller)
      if (!reduce && scroller) {
        animations.push(
          scroller.animate([{ transform: 'translateY(0px)' }, { transform: 'translateY(28px)' }], {
            duration,
            easing: 'ease-in',
            fill: 'forwards',
          }),
        )
      }
    }
    running.current.push(...animations)

    let cancelled = false
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (cancelled) return
      if (lifted.current) lifted.current.style.visibility = ''
      const opener = (lifted.current ?? session.from)?.closest('button')
      lifted.current = null
      setSession(null)
      opener?.focus({ preventScroll: true })
    })
    return () => {
      cancelled = true
    }
  }, [request, session])

  // Si la ficha se desmonta de golpe, el recuadro de la lista no queda vacío.
  useEffect(
    () => () => {
      if (lifted.current) lifted.current.style.visibility = ''
    },
    [],
  )

  // Bajar la ficha con el dedo para cerrarla, como una foto en el teléfono. Solo desde arriba de todo
  // (si la ficha está corrida, el dedo la corre) y solo si el gesto es hacia abajo: los costados son de
  // pasar al producto de al lado. Va con eventos de toque no pasivos para frenar el rebote de iOS.
  // biome-ignore lint/correctness/useExhaustiveDependencies: se engancha una vez por ficha abierta (`sessionKey`)
  useEffect(() => {
    const scroller = scrollerRef.current
    const pull = pullRef.current
    if (!scroller || !pull) return
    const dims = () => [backdropRef.current, chromeRef.current]
    let startX = 0
    let startY = 0
    let lastY = 0
    let lastT = 0
    let velocity = 0
    let active = false
    let pulling = false

    const settle = () => {
      pull.style.transition = `transform 340ms ${EASE}`
      pull.style.transform = ''
      for (const element of dims()) {
        if (!element) continue
        element.style.transition = 'opacity 340ms ease-out'
        element.style.opacity = ''
      }
    }
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (event.touches.length !== 1 || !touch || closing.current) return
      startX = touch.clientX
      startY = lastY = touch.clientY
      lastT = event.timeStamp
      velocity = 0
      active = true
      pulling = false
    }
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!active || !touch) return
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (!pulling) {
        if (dy > 10 && dy > Math.abs(dx) * 1.4 && scroller.scrollTop <= 0) {
          pulling = true
          pull.style.transition = 'none'
          for (const element of dims()) if (element) element.style.transition = 'none'
        } else if (Math.abs(dx) > 12 || dy < -4 || scroller.scrollTop > 0) {
          active = false
          return
        } else {
          return
        }
      }
      event.preventDefault()
      const progress = Math.min(1, Math.max(0, dy) / (window.innerHeight * 0.55))
      pull.style.transform = `translateY(${Math.max(0, dy) * 0.9}px)`
      const [backdrop, chrome] = dims()
      if (backdrop) backdrop.style.opacity = String(1 - progress * 0.7)
      if (chrome) chrome.style.opacity = String(1 - Math.min(1, progress * 3))
      velocity = (touch.clientY - lastY) / Math.max(1, event.timeStamp - lastT)
      lastY = touch.clientY
      lastT = event.timeStamp
    }
    const onEnd = () => {
      if (!active) return
      active = false
      if (!pulling) return
      pulling = false
      if (lastY - startY > 110 || velocity > 0.55) onCloseRef.current()
      else settle()
    }
    scroller.addEventListener('touchstart', onStart, { passive: true })
    scroller.addEventListener('touchmove', onMove, { passive: false })
    scroller.addEventListener('touchend', onEnd, { passive: true })
    scroller.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      scroller.removeEventListener('touchstart', onStart)
      scroller.removeEventListener('touchmove', onMove)
      scroller.removeEventListener('touchend', onEnd)
      scroller.removeEventListener('touchcancel', onEnd)
    }
  }, [sessionKey])

  const count = session?.list.length ?? 0
  const index = session?.index ?? 0

  const sessionRef = useRef(session)
  sessionRef.current = session

  const go = useCallback((step: 1 | -1) => {
    const current = sessionRef.current
    if (!current) return
    const next = current.index + step
    if (next < 0 || next >= current.list.length) return
    hapticTick()
    setDirection(step)
    setFresh(false)
    setSession({ ...current, index: next, placeholder: null })
    scrollerRef.current?.scrollTo({ top: 0 })
  }, [])

  const onDragEnd = useCallback(
    (_event: unknown, info: PanInfo) => {
      const { offset, velocity } = info
      if (Math.abs(offset.x) < Math.abs(offset.y)) return
      if (offset.x < -SWIPE_PX || velocity.x < -SWIPE_VELOCITY) go(1)
      else if (offset.x > SWIPE_PX || velocity.x > SWIPE_VELOCITY) go(-1)
    },
    [go],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowRight') go(1)
      else if (event.key === 'ArrowLeft') go(-1)
      if (event.key !== 'Tab') return
      // El foco no sale de la ficha.
      const nodes = rootRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href]',
      )
      const focusable = Array.from(nodes ?? []).filter((node) => node.offsetParent !== null)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [go, onClose],
  )

  if (!session) return null
  const listed = session.list[index]
  if (!listed) return null
  const item = resolve(listed.id) ?? listed
  const previous = index > 0 ? session.list[index - 1] : null
  const next = index < count - 1 ? session.list[index + 1] : null

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 text-(--carta-on-night)"
    >
      {/* La sala a oscuras, con la luz cayendo desde arriba sobre la foto. */}
      <div
        ref={backdropRef}
        aria-hidden
        className="absolute inset-0 bg-(--carta-night) bg-[radial-gradient(130%_70%_at_50%_0%,var(--carta-night-lift),transparent_70%)]"
      />

      {/* El alto de más (1 px) hace que siempre haya algo que correr: así el dedo nunca mueve la carta de atrás. */}
      <div ref={scrollerRef} className="absolute inset-0 overflow-y-auto overscroll-contain">
        <div ref={pullRef} className="relative min-h-full">
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <motion.div
              key={item.id}
              custom={direction}
              variants={reduceMotion ? slideReduced : slide}
              initial="enter"
              animate="center"
              exit="exit"
              drag={count > 1 ? 'x' : false}
              dragDirectionLock
              dragSnapToOrigin
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.55}
              onDragEnd={onDragEnd}
              className="relative mx-auto flex min-h-[calc(100%+1px)] w-full max-w-[34rem] flex-col lg:max-w-5xl lg:flex-row lg:items-center lg:gap-14 lg:px-12 lg:py-20"
            >
              <StagePhoto item={item} placeholder={session.placeholder} />
              <StageText
                item={item}
                titleId={titleId}
                sponsors={sponsors}
                rises={fresh}
                bare={!photoOf(item) && !item.video_url}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div ref={chromeRef} className="pointer-events-none absolute inset-0">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-3 pt-[max(env(safe-area-inset-top),0.75rem)] lg:px-12">
          {count > 1 ? (
            <p
              aria-live="polite"
              className="flex h-10 items-center rounded-full bg-black/35 px-3.5 text-[0.8125rem] font-semibold text-white backdrop-blur-md"
            >
              <span className="sr-only">Producto </span>
              {index + 1}
              <span className="px-1 text-white/55">de</span>
              {count}
            </p>
          ) : (
            <span />
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="carta-press pointer-events-auto flex size-11 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {count > 1 ? (
          <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-(--carta-night) from-55% to-transparent pt-10">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-3 pb-[max(env(safe-area-inset-bottom),0.875rem)] lg:px-12">
              <NeighborButton item={previous} side="previous" onGo={() => go(-1)} />
              <NeighborButton item={next} side="next" onGo={() => go(1)} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function NeighborButton({
  item,
  side,
  onGo,
}: {
  item: MenuItem | null | undefined
  side: 'previous' | 'next'
  onGo: () => void
}): React.JSX.Element {
  if (!item) return <span className="min-w-0 flex-1" />
  const isNext = side === 'next'
  return (
    <button
      type="button"
      onClick={onGo}
      aria-label={`${isNext ? 'Siguiente' : 'Anterior'}: ${item.name}`}
      className={cn(
        'carta-press pointer-events-auto flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl px-3 py-1.5 text-[0.8125rem] font-semibold leading-[1.25] text-(--carta-on-night-soft) outline-none focus-visible:ring-2 focus-visible:ring-white/80',
        isNext ? 'justify-end text-right' : 'justify-start text-left',
      )}
    >
      {isNext ? null : <ArrowLeft className="size-[1.125rem] shrink-0" aria-hidden />}
      {/* Dos renglones: lo que distingue a un plato del de al lado suele estar al final («… DOBLE»). */}
      <span className="line-clamp-2 text-balance">{item.name}</span>
      {isNext ? <ArrowRight className="size-[1.125rem] shrink-0" aria-hidden /> : null}
    </button>
  )
}

/**
 * La foto grande. Si el producto tiene video, va el video (sin sonido, en bucle; un toque le da sonido)
 * con su cuadro de portada mientras carga; si el video falla, queda la foto.
 */
function StagePhoto({
  item,
  placeholder,
}: {
  item: MenuItem
  placeholder: string | null
}): React.JSX.Element | null {
  const [muted, setMuted] = useState(true)
  const [videoFailed, setVideoFailed] = useState(false)
  const photo = photoOf(item)
  const poster = item.video_url ? posterUrlFor(item.video_url) : null
  const showVideo = Boolean(item.video_url) && !videoFailed

  if (!photo && !showVideo) return null

  return (
    <div
      data-stage-photo
      className="relative aspect-square w-full shrink-0 overflow-hidden rounded-b-[1.75rem] bg-(--carta-night-lift) lg:w-[min(46%,32rem)] lg:rounded-[1.75rem]"
    >
      {showVideo ? (
        <>
          {/* Video del plato, de adorno: arranca sin sonido y no lleva diálogo que subtitular. */}
          <video
            src={item.video_url ?? undefined}
            poster={poster ?? undefined}
            playsInline
            muted={muted}
            loop
            autoPlay
            preload="metadata"
            onError={() => setVideoFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? 'Activar el sonido' : 'Silenciar'}
            className="carta-press absolute bottom-3 right-3 flex size-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
        </>
      ) : photo ? (
        <>
          {placeholder ? (
            // biome-ignore lint/performance/noImgElement: es la misma imagen que el recuadro de la lista ya tenía cargada, para que la foto no llegue en blanco
            <img
              src={placeholder}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
          <StorageImage
            src={photo}
            alt={item.name}
            sizes="(min-width: 1024px) 512px, 100vw"
            priority
          />
        </>
      ) : null}
    </div>
  )
}

function StageText({
  item,
  titleId,
  sponsors,
  rises,
  bare,
}: {
  item: MenuItem
  titleId: string
  sponsors: CartaSponsor[]
  rises: boolean
  /** Sin foto ni video: el texto es toda la ficha y arranca más abajo, con el nombre más grande. */
  bare: boolean
}): React.JSX.Element {
  const credits = sponsorsForItem(item, sponsors)
  let order = 0
  const step = () => ({ '--i': order++ }) as CSSProperties

  return (
    <div
      data-stage-text
      className={cn(
        'min-w-0 flex-1 px-5 pb-32 lg:px-0 lg:pb-0',
        bare ? 'pt-28 lg:pt-0' : 'pt-7 lg:pt-0',
        rises && 'carta-stage-text',
      )}
    >
      <h2
        id={titleId}
        style={step()}
        className={cn(
          'font-serif font-medium leading-[1.03] tracking-[-0.032em] text-balance',
          bare ? 'text-[2.75rem] lg:text-[3.5rem]' : 'text-[2.25rem] lg:text-[3rem]',
        )}
      >
        {item.name}
      </h2>
      <p
        style={step()}
        className="mt-3.5 text-[1.5rem] font-semibold leading-none tracking-[-0.02em]"
      >
        {formatARS(item.price_cents)}
      </p>
      {item.tags.length > 0 ? (
        <div style={step()} className="mt-5">
          <DishTags tags={item.tags} className="gap-x-4 [&_li]:text-[0.8125rem]" />
        </div>
      ) : null}
      {item.description ? (
        <p
          style={step()}
          className="mt-5 max-w-[34rem] whitespace-pre-line text-[1.0625rem] leading-[1.58] text-(--carta-on-night-soft) text-pretty"
        >
          {item.description}
        </p>
      ) : null}
      {item.points_override != null ? (
        <p
          style={step()}
          className="mt-6 flex items-center gap-2 text-[0.9375rem] font-medium text-(--carta-on-night)"
        >
          <Sparkles className="size-4 text-warning" aria-hidden />
          Sumás {item.points_override} puntos con este producto.
        </p>
      ) : null}
      {credits.length > 0 ? (
        <div
          style={step()}
          className="mt-8 flex items-center gap-5 border-t border-(--carta-on-night-line) pt-6"
        >
          <span className="text-[0.8125rem] text-(--carta-on-night-soft)">Con</span>
          {credits.map((sponsor) => (
            <SponsorSeal key={sponsor.name} sponsor={sponsor} size={34} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
