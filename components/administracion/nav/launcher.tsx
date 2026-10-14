'use client'

import { ArrowRight, LoaderCircle, Plus } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  type MouseEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { ACTION_PARAM } from '@/components/administracion/acciones/types'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { cn } from '@/lib/utils'
import {
  LAUNCHER_DESCRIPTION,
  LAUNCHER_GROUPS,
  LAUNCHER_ITEMS,
  LAUNCHER_TITLE,
  type LauncherItem,
  launcherGroups,
  launcherHref,
} from './launcher-items'
import { NavDialog } from './nav-dialog'

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** `busy`: es la que se está abriendo. `wait`: se está abriendo otra. */
type DoorState = 'idle' | 'busy' | 'wait'
type DoorPick = (item: LauncherItem, event: MouseEvent<HTMLElement>) => void
type DoorProps = {
  item: LauncherItem
  /** La pantalla a la que lleva; `null` si abre una hoja (entonces es un botón). */
  href: string | null
  state: DoorState
  onPick: DoorPick
}

/** Un link (lleva a una pantalla) o un botón (abre una hoja), con el mismo aspecto. */
function Door({
  item,
  href,
  state,
  onPick,
  className,
  children,
}: DoorProps & { className: string; children: ReactNode }) {
  const shared = {
    'data-launcher-item': item.key,
    'aria-busy': state === 'busy' ? true : undefined,
    'aria-disabled': state === 'wait' ? true : undefined,
    className: cn(className, state === 'wait' && 'pointer-events-none opacity-45'),
    onClick: (event: MouseEvent<HTMLElement>) => onPick(item, event),
  }
  if (href) {
    return (
      <Link href={href} {...shared}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" {...shared}>
      {children}
    </button>
  )
}

/** El giro de «abriendo». Con movimiento reducido queda quieto: igual dice que está en eso. */
function Opening({ className }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={cn('size-4 shrink-0 animate-spin motion-reduce:animate-none', className)}
    />
  )
}

/**
 * Lo de todos los días: una tarjeta grande, con el ícono relleno de marca y el título en la
 * tipografía de los títulos. Son dos, lado a lado también en el celular (ahí el texto va debajo
 * del ícono).
 */
function FeatureDoor(props: DoorProps) {
  const { item, state } = props
  const Icon = item.icon
  return (
    <Door
      {...props}
      className={cn(
        'group card-hairline press-lift grid h-full w-full grid-cols-[auto_1fr] content-start items-center gap-x-3 gap-y-3 rounded-2xl border bg-card p-3.5 text-left shadow-xs hover:border-primary/30 hover:shadow-md sm:grid-cols-[auto_1fr_auto] sm:content-center sm:gap-x-3.5 sm:p-4',
        FOCUS,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs sm:size-12"
      >
        <Icon className="size-[22px]" />
      </span>
      <span className="justify-self-end text-muted-foreground sm:order-last">
        {state === 'busy' ? (
          <Opening className="text-foreground" />
        ) : (
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-[translate,color] duration-(--duration-fast) ease-(--ease-out) group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
          />
        )}
      </span>
      <span className="col-span-2 min-w-0 sm:col-span-1">
        <span className="block font-serif text-lg leading-tight font-semibold tracking-tight text-balance">
          {item.title}
        </span>
        <span className="mt-1 block text-[13px] leading-snug text-pretty text-muted-foreground">
          {item.hint}
        </span>
      </span>
    </Door>
  )
}

/** Lo de cada tanto: un renglón compacto (ícono chico, título, ejemplo en chico), sin flecha. */
function CompactDoor(props: DoorProps) {
  const { item, state } = props
  const Icon = item.icon
  return (
    <Door
      {...props}
      className={cn(
        'group flex min-h-13 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-[background-color,opacity] hover:bg-card motion-reduce:transition-none',
        FOCUS,
        'focus-visible:ring-inset',
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-foreground/80 transition-colors group-hover:border-primary/30 group-hover:text-foreground motion-reduce:transition-none"
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug font-medium text-pretty">{item.title}</span>
        <span className="block text-[13px] leading-snug text-pretty text-muted-foreground">
          {item.hint}
        </span>
      </span>
      {state === 'busy' ? <Opening /> : null}
    </Door>
  )
}

const GROUP_LABEL = 'px-1.5 pb-1.5 text-xs font-medium text-muted-foreground'

/**
 * Las ocho puertas del lanzador, en dos grupos: arriba las dos de todos los días, grandes;
 * abajo las seis de cada tanto, en una bandeja de renglones compactos. Sin el diálogo alrededor,
 * para poder mirarlas en un test.
 *
 * `pending` es la clave de la que se está abriendo: esa muestra el giro y las demás se apagan,
 * así nadie toca dos veces mientras llega la hoja.
 */
export function LauncherDoors({
  base,
  pending,
  onPick,
}: {
  /** `/<bar>/administracion`. */
  base: string
  pending: string | null
  onPick: DoorPick
}) {
  const id = useId()
  const { daily, sometimes } = launcherGroups()
  const opening = LAUNCHER_ITEMS.find((item) => item.key === pending)
  const door = (item: LauncherItem): DoorProps => ({
    item,
    href: launcherHref(base, item.target),
    state: pending === null ? 'idle' : pending === item.key ? 'busy' : 'wait',
    onPick,
  })
  return (
    <div className="space-y-3.5 sm:space-y-4">
      <section aria-labelledby={`${id}-daily`}>
        <h3 id={`${id}-daily`} className={GROUP_LABEL}>
          {LAUNCHER_GROUPS.daily}
        </h3>
        <ul className="grid grid-cols-2 gap-2 sm:gap-2.5">
          {daily.map((item) => (
            <li key={item.key} className="flex">
              <FeatureDoor {...door(item)} />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby={`${id}-sometimes`}>
        <h3 id={`${id}-sometimes`} className={GROUP_LABEL}>
          {LAUNCHER_GROUPS.sometimes}
        </h3>
        {/* Una bandeja, no seis tarjetas: adentro los renglones se separan con aire. */}
        <ul className="grid gap-0.5 rounded-2xl bg-secondary/50 p-1.5 sm:grid-cols-2">
          {sometimes.map((item) => (
            <li key={item.key} className={cn('flex', item.wide && 'sm:col-span-2')}>
              <CompactDoor {...door(item)} />
            </li>
          ))}
        </ul>
      </section>
      <p role="status" className="sr-only">
        {opening ? `Abriendo «${opening.title}»…` : ''}
      </p>
    </div>
  )
}

/** Avisa si hay una hoja de acción abierta (`?accion=` en la URL). */
function SheetWatch({ onChange }: { onChange: (sheetOpen: boolean) => void }) {
  const sheetOpen = useSearchParams().has(ACTION_PARAM)
  useEffect(() => {
    onChange(sheetOpen)
  }, [sheetOpen, onChange])
  return null
}

/** Si lo elegido no llegó en este tiempo, las puertas vuelven a quedar libres para reintentar. */
const OPENING_LIMIT_MS = 8000
/** Lo que tarda la hoja en terminar de irse: recién ahí se le devuelve el foco al botón. */
const SHEET_LEAVE_MS = 350

/**
 * El lanzador «¿Qué querés cargar?»: la única puerta de carga de la sección. Reemplaza a los dos
 * menús «Más» (el del encabezado y el de la barra del celular, que no decían lo mismo): ocho
 * puertas que se eligen por lo que pasó, y cada una abre la hoja (`?accion=`) o la pantalla que
 * ya existía.
 *
 * Al elegir una, el lanzador NO se cierra en el acto: esa puerta queda «abriendo» y el lanzador
 * se va recién cuando la hoja (o la pantalla) llegó. Abrir una hoja es una vuelta al servidor;
 * cerrando antes, la pantalla quedaba muda uno o dos segundos y daban ganas de tocar de nuevo.
 *
 * Controlado: quien lo abre guarda el estado (`LauncherButton`, el flotante del celular). Sin
 * permiso de escritura no se dibuja nada: la contadora no ve ninguna puerta de carga.
 */
export function Launcher({
  open,
  onOpenChange,
  onSheetClosed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** La hoja que se abrió desde acá se cerró: para devolverle el foco a quien abrió el lanzador. */
  onSheetClosed?: () => void
}) {
  const { tenantSlug, readOnly, openAction } = useAccounting()
  const pathname = usePathname()
  const base = `/${tenantSlug}/administracion`
  const [pending, setPending] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  /** El lanzador se cerró porque la hoja ya tomó la pantalla (y el foco). */
  const handedOff = useRef(false)
  /** Falta devolverle el foco al botón cuando esa hoja se cierre. */
  const owesFocus = useRef(false)

  // Elegir una pantalla navega: el lanzador se cierra con la navegación (`openedAt` evita
  // cerrarlo en el mismo render que lo abre).
  const openedAt = useRef(pathname)
  useEffect(() => {
    if (!open) {
      openedAt.current = pathname
      return
    }
    if (openedAt.current !== pathname) onOpenChange(false)
  }, [open, pathname, onOpenChange])

  // Elegir una hoja: se cierra cuando la hoja ya está en la URL. Nunca quedan los dos a la vez.
  useEffect(() => {
    if (!open || !sheetOpen) return
    handedOff.current = true
    owesFocus.current = true
    onOpenChange(false)
  }, [open, sheetOpen, onOpenChange])

  // La hoja que salió de acá se cerró: el foco vuelve al botón «Cargar» (la tarjeta donde
  // estaba ya no existe). Se espera a que la hoja termine de irse.
  useEffect(() => {
    if (sheetOpen || !owesFocus.current) return
    owesFocus.current = false
    window.setTimeout(() => onSheetClosed?.(), SHEET_LEAVE_MS)
  }, [sheetOpen, onSheetClosed])

  useEffect(() => {
    if (open) handedOff.current = false
    else setPending(null)
  }, [open])

  useEffect(() => {
    if (pending === null) return
    const timer = window.setTimeout(() => setPending(null), OPENING_LIMIT_MS)
    return () => window.clearTimeout(timer)
  }, [pending])

  const pick = useCallback<DoorPick>(
    (item, event) => {
      // Ya se está abriendo una: un segundo toque no hace nada (tampoco navega).
      if (pending !== null) {
        event.preventDefault()
        return
      }
      const { target } = item
      if (target.kind === 'sheet') {
        setPending(item.key)
        openAction(target.action)
        return
      }
      // Una pantalla: el link navega solo. En otra pestaña (⌘ clic), acá no cambia nada.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
      if (launcherHref(base, target) === pathname) onOpenChange(false)
      else setPending(item.key)
    },
    [pending, openAction, base, pathname, onOpenChange],
  )

  if (readOnly) return null

  return (
    <>
      {/* `useSearchParams` adentro de su propio Suspense: la barra nunca espera por esto. */}
      <Suspense fallback={null}>
        <SheetWatch onChange={setSheetOpen} />
      </Suspense>
      <NavDialog
        open={open}
        onOpenChange={onOpenChange}
        title={LAUNCHER_TITLE}
        description={LAUNCHER_DESCRIPTION}
        size="lg"
        onCloseAutoFocus={(event) => {
          // La hoja ya tiene el foco: no se lo saca para devolvérselo al botón.
          if (handedOff.current) event.preventDefault()
        }}
        footer={
          <p>
            ¿No sabés dónde va?{' '}
            <Link
              href={`${base}/guias`}
              onClick={() => onOpenChange(false)}
              className="rounded-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Mirá la guía
            </Link>
          </p>
        }
      >
        <LauncherDoors base={base} pending={pending} onPick={pick} />
      </NavDialog>
    </>
  )
}

/**
 * El botón «＋ Cargar» con su lanzador. Lo usa la barra de la sección en la compu, el flotante
 * del celular (`LauncherFab`) y lo puede usar cualquier pantalla que quiera ofrecer «cargar
 * algo» sin elegir por el usuario qué. En modo lectura no se muestra (ni deshabilitado).
 */
export function LauncherButton({
  children,
  className,
}: {
  /** Por defecto, «＋ Cargar». */
  children?: ReactNode
  className?: string
}) {
  const { readOnly } = useAccounting()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Al cerrarse la hoja que se abrió desde acá, el foco vuelve a este botón; solo si quedó en
  // el aire y este es el botón que se ve (hay uno en la barra y otro flotante).
  const returnFocus = useCallback(() => {
    const button = buttonRef.current
    if (!button || button.getClientRects().length === 0) return
    const focused = document.activeElement
    if (focused && focused !== document.body) return
    button.focus({ preventScroll: true })
  }, [])

  if (readOnly) return null
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-xs transition-[background-color,transform] hover:bg-primary/90 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
          className,
        )}
      >
        {children ?? (
          <>
            <Plus className="size-4" aria-hidden="true" />
            Cargar
          </>
        )}
      </button>
      <Launcher open={open} onOpenChange={setOpen} onSheetClosed={returnFocus} />
    </>
  )
}
