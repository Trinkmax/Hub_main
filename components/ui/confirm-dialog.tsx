'use client'

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import type { LucideIcon } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { DIALOG_OVERLAY_CLASS, dialogContentClassName } from '@/components/ui/dialog'
import { usePortalContainer } from '@/components/ui/portal-container'
import { cn } from '@/lib/utils'

/**
 * La confirmación estándar del kit HUB (§3.7). Reemplaza a las 55
 * confirmaciones armadas a mano con `AlertDialog`:
 *
 * - **Espera la acción con el diálogo abierto.** El principal pasa a «cargando»
 *   (spinner + `pendingLabel`, `aria-busy`, `aria-disabled`) y «Cancelar» a
 *   `aria-disabled`. Ninguno se deshabilita de verdad: un botón `disabled`
 *   pierde el foco y el lector de pantalla queda en el `<body>`. Mientras
 *   espera, ni Esc ni «Cancelar» lo cierran. Adiós a los `e.preventDefault()`.
 * - **Si sale bien** (`void` u `{ ok: true, … }`), se cierra. **Si falla**
 *   (`{ ok: false, message }`, `{ ok: false, error }` o una excepción), queda
 *   abierto con el error adentro, los botones habilitados y el foco en el
 *   principal.
 * - **El resultado de la casa entra tal cual.** Las Server Actions devuelven
 *   `{ ok: true, … } | { ok: false, message }`: `onConfirm` y `formAction` las
 *   aceptan sin adaptar (`if (!r.ok) return r`, o `formAction={accion}`).
 * - **Modo Server Action** (`formAction`): un `<form action>` con
 *   `useActionState`; se cierra cuando el estado vuelve con `ok`.
 * - **Foco:** al abrir, en «Cancelar» (lo menos destructivo). Al cerrar, al
 *   disparador; si la acción lo borró, a `returnFocus()`; si no hay, al `<h1>`
 *   de la página. Nunca al `<body>`.
 *
 * Adentro de un `DropdownMenu` no va un `ConfirmDialog` (se desmonta con el
 * menú antes de confirmar): ahí va `useConfirm()` en el `onSelect`.
 */

/**
 * Una confirmación que falló. `message` es el de las Server Actions de la casa
 * (`{ ok: false, message }`); `error`, el de los formularios del kit. Sin
 * ninguno de los dos, el diálogo dice el genérico.
 */
export type ConfirmFailure = { ok: false; error?: string | null; message?: string | null }

/** Lo que resuelve una acción de confirmación: lo de la casa (`{ ok: true, … }`) o un fallo. */
export type ConfirmActionState = { ok: true } | ConfirmFailure

// `void` a propósito (no `undefined`): un `onConfirm` que no devuelve nada, o un
// `() => Promise<void>` declarado en otro lado, tiene que entrar sin adaptarlo.
// biome-ignore lint/suspicious/noConfusingVoidType: es el tipo de retorno de un callback, no un valor
export type ConfirmResult = void | ConfirmActionState

/** El estado del modo `formAction` (`useActionState`): `null` hasta la primera respuesta. */
export type ConfirmFormState = ConfirmActionState | null

/**
 * El mensaje de una confirmación que falló (`error` o `message`, el primero que
 * diga algo; si no, el genérico), o `null` si no falló.
 */
export function confirmFailureMessage(
  result: ConfirmResult | ConfirmFormState | undefined,
): string | null {
  if (!isFailure(result)) return null
  return result.error?.trim() || result.message?.trim() || GENERIC_ERROR
}

export type ConfirmDialogProps<S extends ConfirmActionState = ConfirmActionState> = {
  /** Una pregunta con el objeto entre «»: «¿Borrar la regla «2x1 en tragos»?» */
  title: string
  /** La consecuencia, en concreto: «Deja de sumar puntos desde hoy.» */
  description?: React.ReactNode
  /** El verbo: «Borrar regla», «Quitar etiqueta», «Cancelar reserva». */
  confirmLabel: string
  /** Mientras espera: «Borrando…». Sin él, el spinner va sobre la etiqueta. */
  pendingLabel?: string
  /** Default «Cancelar» («Volver» si cancelar no pierde nada). */
  cancelLabel?: string
  /** `danger`: botón rojo e ícono en un disco suave. Default `default`. */
  tone?: 'default' | 'danger'
  /** 40 px a la izquierda del título (arriba en el celular). */
  icon?: LucideIcon
  /** Se renderiza con `asChild`: un `Button` o cualquier elemento que acepte `ref`. */
  trigger?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Modo cliente. Puede devolver el resultado de la Server Action tal cual. */
  onConfirm?: () => ConfirmResult | Promise<ConfirmResult>
  /**
   * Modo Server Action (`useActionState`): el estado de la casa
   * (`{ ok: true, … } | { ok: false, message }`) o `{ ok, error }`, sin adaptar.
   */
  formAction?: (prev: S | null, formData: FormData) => Promise<S>
  /** Inputs ocultos del modo formulario. */
  hiddenFields?: Record<string, string>
  /** Campos extra (el motivo de una cancelación); en modo formulario, adentro del `<form>`. */
  children?: React.ReactNode
  /** Por ejemplo, hasta escribir el motivo. Queda enfocable (`aria-disabled`). */
  confirmDisabled?: boolean
  /** A dónde va el foco al cerrar si el disparador ya no existe (se borró su fila). */
  returnFocus?: () => HTMLElement | null
}

/** El texto del diálogo: todo lo que no es comportamiento. */
type ConfirmCopy = Pick<
  ConfirmDialogProps,
  'title' | 'description' | 'confirmLabel' | 'pendingLabel' | 'cancelLabel' | 'tone' | 'icon'
>

/** Para una excepción no hay mensaje que mostrar: el detalle queda en la consola. */
const GENERIC_ERROR = 'No se pudo completar. Probá de nuevo.'

function isFailure(result: ConfirmResult | ConfirmFormState | undefined): result is ConfirmFailure {
  return typeof result === 'object' && result !== null && result.ok === false
}

function isFocusable(el: HTMLElement | null | undefined): el is HTMLElement {
  return el?.isConnected === true && el !== document.body
}

/** El `<h1>` de la página como último lugar para el foco (con `tabIndex={-1}`). */
function pageHeading(): HTMLElement | null {
  const heading =
    document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('h1')
  if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
  return heading
}

function ConfirmDialog<S extends ConfirmActionState = ConfirmActionState>({
  open: openProp,
  onOpenChange,
  trigger,
  onConfirm,
  formAction,
  hiddenFields,
  children,
  confirmDisabled = false,
  returnFocus,
  ...copy
}: ConfirmDialogProps<S>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = openProp ?? uncontrolledOpen
  // Lo marca el cuerpo mientras espera la acción. Ref y no estado: lo leen
  // handlers (Esc, «Cancelar», el pedido de cierre) y no cambia lo que se ve.
  const busyRef = React.useRef(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  // Lo que tenía el foco al abrir: el disparador de un diálogo controlado
  // (Radix solo devuelve el foco a su propio `Trigger`).
  const openerRef = React.useRef<HTMLElement | null>(null)
  const container = usePortalContainer()

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next && busyRef.current) return
      if (openProp === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [openProp, onOpenChange],
  )
  const close = React.useCallback(() => handleOpenChange(false), [handleOpenChange])
  const tone = copy.tone ?? 'default'

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      {trigger ? (
        <AlertDialogPrimitive.Trigger asChild ref={triggerRef}>
          {trigger}
        </AlertDialogPrimitive.Trigger>
      ) : null}
      <AlertDialogPrimitive.Portal container={container}>
        <AlertDialogPrimitive.Overlay
          data-slot="confirm-dialog-overlay"
          className={DIALOG_OVERLAY_CLASS}
        />
        <AlertDialogPrimitive.Content
          data-slot="confirm-dialog"
          data-tone={tone}
          data-size="sm"
          className={dialogContentClassName('sm')}
          // Sin descripción, Radix avisa en consola salvo que se diga explícito.
          {...(copy.description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={() => {
            // Radix captura este mismo elemento y después enfoca «Cancelar».
            const active = document.activeElement
            openerRef.current = active instanceof HTMLElement ? active : null
          }}
          onEscapeKeyDown={(event) => {
            if (busyRef.current) event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            // La decisión es nuestra: Radix solo conoce su `Trigger` y, si la
            // acción lo borró, el foco terminaba en el <body>.
            event.preventDefault()
            const target = [triggerRef.current, openerRef.current, returnFocus?.()].find(
              isFocusable,
            )
            if (target) target.focus()
            else pageHeading()?.focus({ preventScroll: true })
          }}
        >
          {/* El cuerpo vive adentro del Content, que se desmonta al cerrar: el
              error y el formulario arrancan de cero cada vez que se abre. */}
          {formAction ? (
            <ConfirmFormBody
              copy={copy}
              formAction={formAction}
              hiddenFields={hiddenFields}
              confirmDisabled={confirmDisabled}
              busyRef={busyRef}
              onDone={close}
            >
              {children}
            </ConfirmFormBody>
          ) : (
            <ConfirmClientBody
              copy={copy}
              onConfirm={onConfirm}
              confirmDisabled={confirmDisabled}
              busyRef={busyRef}
              onDone={close}
            >
              {children}
            </ConfirmClientBody>
          )}
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}

type BodyProps = {
  copy: ConfirmCopy
  children?: React.ReactNode
  confirmDisabled: boolean
  busyRef: React.RefObject<boolean>
  onDone: () => void
}

function ConfirmClientBody({
  copy,
  children,
  confirmDisabled,
  busyRef,
  onDone,
  onConfirm,
}: BodyProps & Pick<ConfirmDialogProps, 'onConfirm'>) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const confirmRef = React.useRef<HTMLButtonElement>(null)

  const run = async () => {
    if (busyRef.current || confirmDisabled) return
    busyRef.current = true
    setPending(true)
    setError(null)
    let result: ConfirmResult | undefined
    try {
      result = await onConfirm?.()
    } catch (err) {
      console.error('[ConfirmDialog] la confirmación falló', err)
      result = { ok: false, error: GENERIC_ERROR }
    }
    busyRef.current = false
    setPending(false)
    const failure = confirmFailureMessage(result)
    if (failure !== null) {
      setError(failure)
      confirmRef.current?.focus()
      return
    }
    onDone()
  }

  return (
    <ConfirmLayout
      copy={copy}
      pending={pending}
      error={error}
      confirmDisabled={confirmDisabled}
      confirmRef={confirmRef}
      confirmType="button"
      onConfirmClick={() => void run()}
    >
      {children}
    </ConfirmLayout>
  )
}

function ConfirmFormBody<S extends ConfirmActionState>({
  copy,
  children,
  confirmDisabled,
  busyRef,
  onDone,
  formAction,
  hiddenFields,
}: BodyProps & {
  formAction: (prev: S | null, formData: FormData) => Promise<S>
  hiddenFields?: Record<string, string>
}) {
  const [state, dispatch, isPending] = React.useActionState<S | null, FormData>(formAction, null)
  const confirmRef = React.useRef<HTMLButtonElement>(null)
  // Cada respuesta se atiende una sola vez: `onDone` cambia de identidad con
  // los renders del que llama y el efecto vuelve a correr.
  const handledRef = React.useRef<S | null>(null)

  React.useEffect(() => {
    busyRef.current = isPending
  }, [busyRef, isPending])

  React.useEffect(() => {
    if (state === null || state === handledRef.current) return
    handledRef.current = state
    if (state.ok) onDone()
    else confirmRef.current?.focus()
  }, [state, onDone])

  const error = confirmFailureMessage(state)

  return (
    <form
      action={dispatch}
      data-slot="confirm-dialog-form"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        // Un Enter en un campo envía aunque el botón esté aria-disabled.
        if (confirmDisabled || busyRef.current) event.preventDefault()
        else busyRef.current = true
      }}
    >
      {hiddenFields
        ? Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}
      <ConfirmLayout
        copy={copy}
        pending={isPending}
        error={error}
        confirmDisabled={confirmDisabled}
        confirmRef={confirmRef}
        confirmType="submit"
      >
        {children}
      </ConfirmLayout>
    </form>
  )
}

function ConfirmLayout({
  copy,
  children,
  pending,
  error,
  confirmDisabled,
  confirmRef,
  confirmType,
  onConfirmClick,
}: {
  copy: ConfirmCopy
  children?: React.ReactNode
  pending: boolean
  error: string | null
  confirmDisabled: boolean
  confirmRef: React.RefObject<HTMLButtonElement | null>
  confirmType: 'button' | 'submit'
  onConfirmClick?: () => void
}) {
  const { title, description, confirmLabel, pendingLabel, cancelLabel = 'Cancelar' } = copy
  const Icon = copy.icon
  const danger = copy.tone === 'danger'
  return (
    <>
      <div
        data-slot="confirm-dialog-header"
        className="flex flex-col gap-4 sm:flex-row sm:items-start"
      >
        {Icon ? (
          <span
            data-slot="confirm-dialog-icon"
            aria-hidden="true"
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-full',
              danger ? 'bg-destructive-soft text-destructive-text' : 'bg-secondary text-foreground',
            )}
          >
            <Icon className="size-5" />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <AlertDialogPrimitive.Title
            data-slot="confirm-dialog-title"
            className="type-section text-balance text-foreground"
          >
            {title}
          </AlertDialogPrimitive.Title>
          {description ? (
            // div y no p: la descripción acepta cualquier nodo (un div adentro
            // de un p es HTML inválido y rompe la hidratación).
            <AlertDialogPrimitive.Description asChild>
              <div
                data-slot="confirm-dialog-description"
                className="type-body text-pretty text-muted-foreground"
              >
                {description}
              </div>
            </AlertDialogPrimitive.Description>
          ) : null}
        </div>
      </div>

      {children}

      {error ? (
        <Callout tone="danger" announce="assertive" data-slot="confirm-dialog-error">
          {error}
        </Callout>
      ) : null}

      <div
        data-slot="confirm-dialog-footer"
        className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
      >
        {/* El `Cancel` de Radix: recibe el foco al abrir. Mientras espera no
            cierra: el pedido de cierre se ignora (ver `handleOpenChange`). */}
        <AlertDialogPrimitive.Cancel asChild>
          <Button type="button" variant="secondary" aria-disabled={pending || undefined}>
            {cancelLabel}
          </Button>
        </AlertDialogPrimitive.Cancel>
        <Button
          ref={confirmRef}
          type={confirmType}
          variant={danger ? 'danger' : 'primary'}
          loading={pending}
          loadingText={pendingLabel}
          aria-disabled={confirmDisabled || undefined}
          onClick={onConfirmClick}
        >
          {confirmLabel}
        </Button>
      </div>
    </>
  )
}

// ─── useConfirm ──────────────────────────────────────────────────────────────

/** Lo que recibe `confirm()`: lo mismo que el diálogo, sin disparador ni formulario. */
export type ConfirmOptions = Omit<
  ConfirmDialogProps,
  'trigger' | 'open' | 'onOpenChange' | 'formAction' | 'hiddenFields' | 'children'
>

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

type ConfirmRequest = {
  id: number
  opts: ConfirmOptions
  /** El disparador «⋯» del menú desde el que se pidió (o lo que tenía el foco). */
  returnTo: HTMLElement | null
  confirmed: boolean
  settle: (confirmed: boolean) => void
}

const ConfirmContext = React.createContext<ConfirmFn | null>(null)

/**
 * Lo que tenía el foco al pedir la confirmación. Si es un ítem de menú (el
 * menú se está cerrando y sus ítems se van del DOM), sube hasta el botón que
 * abrió el menú por su `aria-labelledby`, también desde un submenú.
 */
function focusReturnTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  let el: Element | null = document.activeElement
  for (let depth = 0; el && depth < 5; depth += 1) {
    const menu = el.closest('[role="menu"]')
    if (!menu) break
    const labelledBy = menu.getAttribute('aria-labelledby')
    el = labelledBy ? document.getElementById(labelledBy) : null
  }
  return el instanceof HTMLElement && el !== document.body ? el : null
}

function nextFrame(callback: () => void) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => callback())
  } else {
    setTimeout(callback, 0)
  }
}

/**
 * Monta el diálogo de `useConfirm()` una sola vez (lo pone el shell del panel).
 * El diálogo vive acá y no adentro del menú que lo pide: así no se desmonta
 * con el menú antes de confirmar (lo que pasaba en `pages-list.tsx`).
 */
function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<ConfirmRequest | null>(null)
  const [open, setOpen] = React.useState(false)
  const currentRef = React.useRef<ConfirmRequest | null>(null)
  const seqRef = React.useRef(0)

  const confirm = React.useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        const returnTo = focusReturnTarget()
        // Abre en el cuadro siguiente: el menú que lo pidió ya terminó de
        // cerrarse y Radix no deja `pointer-events: none` pegado en el <body>.
        nextFrame(() => {
          // Uno nuevo reemplaza al que estaba abierto (que cuenta como cancelado).
          currentRef.current?.settle(false)
          let settled = false
          seqRef.current += 1
          const next: ConfirmRequest = {
            id: seqRef.current,
            opts,
            returnTo,
            confirmed: false,
            settle: (confirmed) => {
              if (settled) return
              settled = true
              resolve(confirmed)
            },
          }
          currentRef.current = next
          setRequest(next)
          setOpen(true)
        })
      }),
    [],
  )

  React.useEffect(() => () => currentRef.current?.settle(false), [])

  const handleOpenChange = React.useCallback((next: boolean) => {
    if (next) return
    setOpen(false)
    const current = currentRef.current
    current?.settle(current.confirmed)
  }, [])

  const handleConfirm = React.useCallback(async (): Promise<ConfirmResult> => {
    const current = currentRef.current
    const result = await current?.opts.onConfirm?.()
    if (current && !isFailure(result)) current.confirmed = true
    return result
  }, [])

  const handleReturnFocus = React.useCallback((): HTMLElement | null => {
    const current = currentRef.current
    const saved = current?.returnTo
    if (isFocusable(saved)) return saved
    return current?.opts.returnFocus?.() ?? null
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request ? (
        <ConfirmDialog
          key={request.id}
          {...request.opts}
          open={open}
          onOpenChange={handleOpenChange}
          onConfirm={handleConfirm}
          returnFocus={handleReturnFocus}
        />
      ) : null}
    </ConfirmContext.Provider>
  )
}

/**
 * La confirmación imperativa, para abrir desde un `DropdownMenuItem`:
 *
 * ```tsx
 * const confirm = useConfirm()
 * <DropdownMenuItem variant="destructive" onSelect={async () => {
 *   const ok = await confirm({ title: '¿Borrar la página «Promo»?', confirmLabel: 'Borrar página',
 *     pendingLabel: 'Borrando…', tone: 'danger', onConfirm: () => deletePage(id) })
 *   if (ok) toast.success('Página borrada')
 * }}>
 * ```
 *
 * Devuelve `true` solo si se confirmó y `onConfirm` salió bien. Al cerrar, el
 * foco vuelve al botón que abrió el menú.
 */
function useConfirm(): ConfirmFn {
  const confirm = React.useContext(ConfirmContext)
  if (!confirm) {
    throw new Error(
      'useConfirm necesita un <ConfirmProvider> más arriba (lo monta el shell del panel).',
    )
  }
  return confirm
}

export { ConfirmDialog, ConfirmProvider, useConfirm }
