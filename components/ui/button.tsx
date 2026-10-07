import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/** Variantes del kit (§3.1). Un solo `primary` por vista o por formulario. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'link'
/** @deprecated default→primary · outline→secondary · secondary→secondary · destructive→danger · success→primary */
export type LegacyButtonVariant = 'default' | 'outline' | 'destructive' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon' | 'icon-lg'
/** @deprecated default→md · xl→lg (lg pasa de 40 a 44 px) */
export type LegacyButtonSize = 'default' | 'xl'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'press bg-primary text-primary-foreground hover:bg-primary-hover',
  secondary: 'press border border-border-strong bg-card text-foreground hover:bg-muted',
  // Cambio visible a propósito: el fantasma de antes era tinta; ahora es texto 2
  // (5,3:1 o más en todas las superficies) y se vuelve tinta al pasar el mouse.
  ghost: 'press text-muted-foreground hover:bg-hover hover:text-foreground',
  danger: 'press bg-destructive text-destructive-foreground hover:bg-destructive-hover',
  'danger-ghost': 'press text-destructive-text hover:bg-destructive-soft',
  // Subrayado siempre: el verde contra la tinta del texto da 1,64:1 y el color
  // solo no distingue un link (WCAG 1.4.1). Sin `press` y sin alto fijo.
  link: 'text-primary underline decoration-1 underline-offset-[3px] hover:decoration-2',
}

const SIZE: Record<ButtonSize, string> = {
  // sm e icon-sm dibujan 32/36 px: con el dedo agrandan el área a 44 (hit-area).
  sm: "relative hit-area h-(--control-sm) px-3 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-4",
  md: "h-(--control-md) px-4 text-sm has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-4",
  lg: "h-(--control-lg) px-5 text-base has-[>svg]:px-4 [&_svg:not([class*='size-'])]:size-5",
  'icon-sm': "relative hit-area size-(--control-sm) [&_svg:not([class*='size-'])]:size-4",
  icon: "size-(--control-md) [&_svg:not([class*='size-'])]:size-4",
  'icon-lg': "size-(--control-lg) [&_svg:not([class*='size-'])]:size-5",
}

/**
 * Sin `size`, el botón toma el de un `ControlSizeProvider` (una barra en `sm`)
 * por las variables que declara su envoltorio; sin proveedor, el respaldo es
 * `md`. Es CSS y no contexto porque el Button es server-safe (sin hooks).
 * Lleva `relative hit-area` por si el proveedor lo achica a 32 px: en md y lg
 * el área extra mide lo mismo que el botón y no cambia nada.
 */
const AUTO_SIZE = [
  'relative hit-area',
  'h-[var(--control-h,var(--control-md))] px-[var(--control-px,1rem)]',
  'text-[length:var(--control-text,0.875rem)] has-[>svg]:px-[var(--control-px-icon,0.75rem)]',
  "[&_svg:not([class*='size-'])]:size-[var(--control-icon,1rem)]",
].join(' ')

/**
 * Las clases del botón. Declara también las claves viejas como alias con las
 * mismas clases que su reemplazo: `contact-button.tsx` tipa sus props con
 * `VariantProps<typeof buttonVariants>` y usa `outline` por defecto, y
 * `alert-dialog.tsx` llama `buttonVariants({ variant: 'outline' })`.
 */
const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium',
    // Foco «afuera» (§3.0): siempre outline, nunca box-shadow (desaparece en el
    // alto contraste de Windows).
    'outline-offset-2 outline-(--ring) focus-visible:outline-2',
    // Deshabilitado de verdad: como antes, sin eventos (así tampoco pinta el
    // hover). Con aria-disabled sigue enfocable para poder explicar por qué no
    // anda; mientras carga también lo lleva, pero ahí se ve el spinner, no el gris.
    'disabled:pointer-events-none disabled:opacity-50',
    'aria-disabled:cursor-not-allowed aria-disabled:not-aria-busy:opacity-50',
    'aria-invalid:border-destructive',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        ...VARIANT,
        default: VARIANT.primary,
        outline: VARIANT.secondary,
        destructive: VARIANT.danger,
        // Los «Llegó» del operativo: en oscuro se ven dorados, no verdes. Se
        // revisa en el lote K.
        success: VARIANT.primary,
      } satisfies Record<ButtonVariant | LegacyButtonVariant, string>,
      size: {
        ...SIZE,
        default: SIZE.md,
        xl: SIZE.lg,
      } satisfies Record<ButtonSize | LegacyButtonSize, string>,
    },
    compoundVariants: [
      // El link va en línea con el texto: sin alto fijo ni padding de botón.
      { variant: 'link', className: 'h-auto px-0 has-[>svg]:px-0' },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export type ButtonProps = React.ComponentProps<'button'> & {
  /** Default `primary`. Los nombres viejos se aceptan y se mapean (ver `LegacyButtonVariant`). */
  variant?: ButtonVariant | LegacyButtonVariant | null
  /**
   * Sin `size`, el del `ControlSizeProvider` más cercano o `md`. Alto con mouse
   * / con el dedo: sm 32/36 · md 36/44 · lg 44/48; los `icon*` son cuadrados.
   */
  size?: ButtonSize | LegacyButtonSize | null
  /** Para `<Link>` o `<a>`: las props (data-tour incluido) pasan al hijo. */
  asChild?: boolean
  /**
   * Spinner + `aria-busy` + `aria-disabled`. Sigue enfocable y no reacciona:
   * mientras carga no corre `onClick` ni envía el formulario. Con `asChild` se
   * ignora (aviso en desarrollo).
   */
  loading?: boolean
  /** Reemplaza la etiqueta mientras carga («Guardando…»). */
  loadingText?: string
}

const ICON_SIZES = new Set<string>(['icon-sm', 'icon', 'icon-lg'])
const LARGE_SIZES = new Set<string>(['lg', 'xl', 'icon-lg'])

/**
 * ¿Es un ícono el primer hijo? Un componente (los íconos de lucide son
 * forwardRef) o un `<svg>`. Un `<span>`, un texto o un fragmento no: esos son
 * la etiqueta.
 */
function isIconElement(node: React.ReactNode): boolean {
  if (!React.isValidElement(node)) return false
  const { type } = node
  return type === 'svg' || typeof type === 'function' || (typeof type === 'object' && type !== null)
}

/** ¿El botón tiene texto para el lector? Un `sr-only` adentro también cuenta. */
function hasAccessibleText(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child).trim() !== ''
    if (!React.isValidElement<{ className?: unknown }>(child)) return false
    const cls = child.props.className
    return typeof cls === 'string' && cls.includes('sr-only')
  })
}

/**
 * Toda acción (§3.1). Es un `<button>` nativo y server-safe (sin hooks).
 *
 * - No se cambia el `type` por defecto: los formularios existentes dependen de
 *   que el default sea `submit`. Solo mientras carga pasa a `type="button"`,
 *   que es lo que impide un segundo envío sin pasarle una función (desde un
 *   Server Component no se pueden pasar funciones a un elemento).
 * - Cargando: el spinner reemplaza al ícono inicial; sin ícono se superpone
 *   centrado y la etiqueta queda transparente para que el ancho no salte; con
 *   `loadingText`, spinner + texto.
 * - Los `className` que fuerzan alto (`h-11`) siguen ganando: `cn()` deja la
 *   última clase de cada grupo.
 */
function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  loadingText,
  children,
  ...props
}: ButtonProps) {
  const sizeKey = size ?? null
  const isLoading = loading && !asChild
  const classes = cn(
    buttonVariants({ variant, size: sizeKey }),
    sizeKey === null && variant !== 'link' && AUTO_SIZE,
    // El spinner superpuesto se ubica contra el botón. Va antes del className:
    // un botón que ya viene `absolute` sigue absoluto (y también sirve de caja).
    isLoading && 'relative',
    className,
  )

  if (process.env.NODE_ENV !== 'production') {
    if (asChild && loading) {
      console.warn('[Button] `loading` no tiene efecto con `asChild`: el hijo decide qué dibujar.')
    }
    if (
      !asChild &&
      sizeKey !== null &&
      ICON_SIZES.has(sizeKey) &&
      !props['aria-label'] &&
      !props['aria-labelledby'] &&
      !props.title &&
      !hasAccessibleText(children)
    ) {
      console.warn('[Button] Un botón de ícono necesita `aria-label` para el lector de pantalla.')
    }
  }

  if (asChild) {
    return (
      <Slot data-slot="button" className={classes} {...props}>
        {children}
      </Slot>
    )
  }

  if (!isLoading) {
    return (
      <button data-slot="button" className={classes} {...props}>
        {children}
      </button>
    )
  }

  // Mientras carga: sin onClick ni formAction (un click no hace nada) y con
  // type="button" (no envía el formulario). Sin crear funciones, así sirve
  // también renderizado desde un Server Component.
  const { onClick: _onClick, formAction: _formAction, type: _type, ...rest } = props
  const spinner = (
    <Spinner
      aria-hidden
      size={sizeKey !== null && LARGE_SIZES.has(sizeKey) ? 20 : 16}
      className={sizeKey === null ? 'size-[var(--control-icon,1rem)]' : undefined}
    />
  )
  const items = React.Children.toArray(children)

  let content: React.ReactNode
  if (loadingText) {
    content = (
      <>
        {spinner}
        {loadingText}
      </>
    )
  } else if (items.length > 0 && isIconElement(items[0])) {
    // El spinner ocupa el lugar del ícono: mismo tamaño, el ancho no salta.
    content = (
      <>
        {spinner}
        {items.slice(1)}
      </>
    )
  } else {
    // Sin ícono: la etiqueta sigue ahí (transparente, y la lee el lector) para
    // que el botón conserve el ancho, y el spinner va encima, centrado.
    content = (
      <>
        <span data-slot="button-label" className="inline-flex items-center gap-2 opacity-0">
          {children}
        </span>
        <span
          data-slot="button-spinner"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          {spinner}
        </span>
      </>
    )
  }

  return (
    <button
      data-slot="button"
      data-loading=""
      {...rest}
      type="button"
      className={classes}
      aria-busy="true"
      aria-disabled="true"
    >
      {content}
    </button>
  )
}

export { Button, buttonVariants }
