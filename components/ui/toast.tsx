import type * as React from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * Avisos del kit HUB (§3.4): el «Deshacer» de toda la app y la regla de que
 * tocar un aviso nunca cierra el overlay de abajo. El `Toaster` vive en
 * `components/ui/sonner.tsx`; la API `toast.*` de sonner no cambia.
 *
 * Sin `'use client'` a propósito: son funciones y constantes que también puede
 * importar un módulo compartido (`UNDO_MS` desde un Server Component sería una
 * referencia de cliente, no un número). Todo lo que toca el DOM corre adentro
 * de handlers.
 */

/** Lo que dura todo «Deshacer» de la app. Antes convivían tres de 6 s y dos de 4 s. */
export const UNDO_MS = 6000

/**
 * Al soltar el foco o sacar el mouse, el aviso no se va en el mismo instante:
 * si quedaban 50 ms, se van a quedar 1 s (nunca más que el total del aviso).
 */
export const UNDO_MIN_RESUME_MS = 1000

/** El `<ol>` de sonner que contiene los avisos. */
export const TOASTER_SELECTOR = '[data-sonner-toaster]'

// ─── Clases compartidas con el Toaster ───────────────────────────────────────
// Los botones del aviso. `toastUndo` dibuja su propio botón (sonner no le pone
// clases a una acción que llega como nodo), así que las clases viven acá y el
// Toaster las usa para los botones que arma sonner. `-my-1.5` deja el botón de
// 32 px centrado contra la primera línea del aviso sin agrandarlo.
export const TOAST_ACTION_CLASS =
  'relative -my-1.5 h-8 shrink-0 rounded-md px-3 type-label text-primary hover:bg-hover hit-area focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)'
export const TOAST_CANCEL_CLASS =
  'relative -my-1.5 h-8 shrink-0 rounded-md px-3 type-label text-muted-foreground hover:bg-hover hover:text-foreground hit-area focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)'

// ─── Overlays y avisos ───────────────────────────────────────────────────────

type OutsideEvent = { target: EventTarget | null; preventDefault(): void }

/**
 * Comparado por forma (`closest`) y no con `instanceof Element`: así también
 * sirve para un nodo de otro documento y se puede probar sin DOM.
 */
function isInsideToaster(target: EventTarget | null): boolean {
  if (target === null || !('closest' in target)) return false
  const { closest } = target
  if (typeof closest !== 'function') return false
  const found: unknown = closest.call(target, TOASTER_SELECTOR)
  return found !== null && found !== undefined
}

/**
 * Para el `onInteractOutside` de un overlay de Radix: tocar un aviso no cuenta
 * como «afuera». El Toaster vive en el `<body>`, fuera del overlay, así que el
 * pointerdown sobre «Deshacer» (o sobre la X del aviso) cerraba la capa de
 * arriba antes de que corriera el click. Que el aviso reciba el click lo
 * resuelve `[data-sonner-toaster] { pointer-events: auto }` de globals.css.
 *
 * Dialog, Sheet, Popover y ConfirmDialog lo aplican solos (salvo
 * `closeOnToastClick`). La copia de `components/reservations/reservation-quick-view`
 * hace lo mismo y sigue exportada para los que ya la importan.
 */
export function keepOpenOnToast(event: OutsideEvent): void {
  if (isInsideToaster(event.target)) event.preventDefault()
}

/**
 * Compone el handler del que llama con `keepOpenOnToast`. Va en
 * `onInteractOutside`, que Radix llama tanto para el pointerdown como para el
 * foco que sale de la capa: alcanza con un solo lugar.
 */
export function keepOpenOnToastWith<E extends OutsideEvent>(
  handler?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    handler?.(event)
    keepOpenOnToast(event)
  }
}

// ─── El reloj del «Deshacer» (lógica pura) ───────────────────────────────────

/** Por qué el reloj está quieto: el foco en los avisos, el mouse encima o la pestaña oculta. */
export type UndoHold = 'focus' | 'hover' | 'hidden'

/**
 * El tiempo de un aviso con «Deshacer». `runningSince` es `null` mientras algo
 * lo retiene; `remaining` es lo que faltaba cuando arrancó o se frenó por
 * última vez.
 */
export type UndoClock = Readonly<{
  duration: number
  remaining: number
  runningSince: number | null
  holds: readonly UndoHold[]
}>

export function startUndoClock(duration: number, now: number): UndoClock {
  const total = Math.max(0, duration)
  return { duration: total, remaining: total, runningSince: now, holds: [] }
}

/** Frena el reloj por `hold`. Frenar dos veces por lo mismo no descuenta dos veces. */
export function holdUndoClock(clock: UndoClock, hold: UndoHold, now: number): UndoClock {
  if (clock.holds.includes(hold)) return clock
  const remaining =
    clock.runningSince === null
      ? clock.remaining
      : Math.max(0, clock.remaining - (now - clock.runningSince))
  return { ...clock, remaining, runningSince: null, holds: [...clock.holds, hold] }
}

/**
 * Suelta `hold`. El reloj arranca de nuevo recién cuando no queda nada que lo
 * retenga, con lo que le quedaba (y nunca menos de `UNDO_MIN_RESUME_MS`).
 */
export function releaseUndoClock(clock: UndoClock, hold: UndoHold, now: number): UndoClock {
  if (!clock.holds.includes(hold)) return clock
  const holds = clock.holds.filter((reason) => reason !== hold)
  if (holds.length > 0) return { ...clock, holds }
  const floor = Math.min(UNDO_MIN_RESUME_MS, clock.duration)
  return { ...clock, remaining: Math.max(clock.remaining, floor), runningSince: now, holds }
}

/** Cuánto falta para que el aviso se cierre solo; `null` mientras está retenido. */
export function undoClockDelay(clock: UndoClock, now: number): number | null {
  if (clock.runningSince === null) return null
  return Math.max(0, clock.remaining - (now - clock.runningSince))
}

// ─── toastUndo ───────────────────────────────────────────────────────────────

export type ToastUndoOptions = {
  /** Lo que revierte el cambio. Si falla, avisa el que llama (como hoy). */
  onUndo: () => void | Promise<void>
  /** Mismo `id`, mismo aviso: reemitirlo reemplaza al anterior y reinicia el tiempo. */
  id?: string | number
  description?: React.ReactNode
  /** Default «Deshacer». */
  undoLabel?: string
  /** Default `UNDO_MS`. */
  duration?: number
}

/** Los relojes vivos, por id: reemitir un aviso descarta el reloj del anterior. */
const undoClocks = new Map<string | number, () => void>()
let undoSeq = 0

function UndoButton({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      data-slot="toast-undo"
      className={cn(TOAST_ACTION_CLASS, className)}
      {...props}
    />
  )
}

/**
 * Un aviso con «Deshacer» que dura `UNDO_MS` en toda la app.
 *
 * **Se queda quieto mientras tiene el foco** (WCAG 2.2.1): quien llega con Tab
 * no pierde los segundos que tardó en llegar. Sonner 2.0.7 pausa con el mouse
 * encima, al presionar y con la pestaña oculta, pero no con el foco. La
 * especificación proponía reemitir el aviso con `duration: Infinity` al tomar
 * foco y con el resto al soltarlo, pero sonner arrastra el inicio del timer
 * viejo cuando se pausa justo después de cambiar la duración (foco sin mouse y
 * soltarlo con el mouse encima lo cerraba de golpe). Por eso el aviso va con
 * `duration: Infinity` desde el principio y el tiempo lo lleva este reloj, que
 * se frena por las mismas razones que sonner (mouse encima de los avisos,
 * pestaña oculta) más el foco adentro de los avisos (también Alt + T).
 *
 * El aviso es un atajo, no la única salida: lo que se deshace acá también se
 * revierte desde la pantalla. Un borrado definitivo va con `ConfirmDialog`.
 */
export function toastUndo(message: string, opts: ToastUndoOptions): string | number {
  undoSeq += 1
  const id = opts.id ?? `undo-${undoSeq}`
  undoClocks.get(id)?.()

  let clock = startUndoClock(opts.duration ?? UNDO_MS, Date.now())
  let timer: ReturnType<typeof setTimeout> | undefined
  let detachList: (() => void) | null = null
  let disposed = false
  let undone = false

  const schedule = () => {
    clearTimeout(timer)
    const delay = undoClockDelay(clock, Date.now())
    if (delay !== null) timer = setTimeout(() => toast.dismiss(id), delay)
  }
  const hold = (reason: UndoHold) => {
    if (disposed) return
    clock = holdUndoClock(clock, reason, Date.now())
    schedule()
  }
  const release = (reason: UndoHold) => {
    if (disposed) return
    clock = releaseUndoClock(clock, reason, Date.now())
    schedule()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') hold('hidden')
    else release('hidden')
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    clearTimeout(timer)
    detachList?.()
    detachList = null
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
    if (undoClocks.get(id) === dispose) undoClocks.delete(id)
  }
  undoClocks.set(id, dispose)

  // El botón se monta adentro del <ol> de sonner: desde ahí se engancha la
  // lista entera, así el mouse sobre cualquier aviso o el foco en cualquiera
  // (incluido el Alt + T de sonner) frenan este reloj, como frenan los demás.
  const attachList = (button: HTMLButtonElement | null) => {
    detachList?.()
    detachList = null
    const list = button?.closest<HTMLElement>(TOASTER_SELECTOR)
    if (!list || disposed) return
    const onEnter = () => hold('hover')
    const onLeave = () => release('hover')
    const onFocusIn = () => hold('focus')
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget
      if (!(next instanceof Node && list.contains(next))) release('focus')
    }
    list.addEventListener('mouseenter', onEnter)
    list.addEventListener('mouseleave', onLeave)
    list.addEventListener('focusin', onFocusIn)
    list.addEventListener('focusout', onFocusOut)
    detachList = () => {
      list.removeEventListener('mouseenter', onEnter)
      list.removeEventListener('mouseleave', onLeave)
      list.removeEventListener('focusin', onFocusIn)
      list.removeEventListener('focusout', onFocusOut)
    }
    if (list.matches(':hover')) hold('hover')
    if (list.contains(document.activeElement)) hold('focus')
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
    if (document.visibilityState === 'hidden') hold('hidden')
  }

  const undo = () => {
    if (undone) return
    undone = true
    toast.dismiss(id)
    dispose()
    // Sincrónico, como el `action.onClick` de sonner: el que llama puede
    // actualizar estado en el mismo evento. Si la promesa falla, el que llama
    // ya muestra su error; acá solo queda registrado.
    try {
      const result = opts.onUndo()
      if (result instanceof Promise) {
        result.catch((error: unknown) => console.error('[toastUndo] falló «Deshacer»', error))
      }
    } catch (error) {
      console.error('[toastUndo] falló «Deshacer»', error)
    }
  }

  toast(message, {
    id,
    description: opts.description,
    // El tiempo lo lleva el reloj de arriba: sonner no cierra el aviso solo.
    duration: Number.POSITIVE_INFINITY,
    action: (
      <UndoButton ref={attachList} onClick={undo}>
        {opts.undoLabel ?? 'Deshacer'}
      </UndoButton>
    ),
    onDismiss: dispose,
    onAutoClose: dispose,
  })
  schedule()
  return id
}
