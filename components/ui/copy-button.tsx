'use client'

import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Cuánto se queda el «Copiado» antes de volver a «Copiar». */
const COPIED_MS = 1800

export type CopyButtonProps = Omit<
  ButtonProps,
  'value' | 'children' | 'onClick' | 'loading' | 'loadingText' | 'asChild'
> & {
  /** El texto que se copia. */
  value: string
  label?: string
  copiedLabel?: string
  /** Solo el ícono: el nombre va en `aria-label`. */
  iconOnly?: boolean
}

/** El tamaño cuadrado que corresponde al `size` pedido cuando es solo ícono. */
function iconSizeFor(size: ButtonProps['size']): ButtonProps['size'] {
  if (size === 'icon-sm' || size === 'icon' || size === 'icon-lg') return size
  if (size === 'lg') return 'icon-lg'
  // Como antes: sm (el default) y md dan el ícono de 36 px; achicarlo a 32
  // movería las filas donde ya se usa.
  return 'icon'
}

/**
 * Copiar al portapapeles con confirmación visible (§3.1).
 *
 * Existe porque el mismo gesto estaba escrito cuatro veces en la app, cada una
 * con su propio manejo (o falta de manejo) del caso en que `navigator.clipboard`
 * no está disponible: pasa en http sin TLS y en algunos WebViews.
 *
 * - El ícono pasa de Copy a Check con un fundido de 150 ms y `blur(2px)` en el
 *   cruce (los dos íconos se apilan en la misma celda: el ancho no salta).
 * - Una región `aria-live` anuncia «Copiado» (afuera del botón, para no sumarse
 *   al nombre del botón) y a los 1,8 s todo vuelve a su estado.
 */
export function CopyButton({
  value,
  label = 'Copiar',
  copiedLabel = 'Copiado',
  variant = 'secondary',
  size = 'sm',
  iconOnly = false,
  className,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current)
    },
    [],
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timeout.current) clearTimeout(timeout.current)
      timeout.current = setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      // Sin permiso de portapapeles (http, WebView): al menos que el texto se
      // pueda seleccionar a mano en vez de fallar en silencio.
      toast.error('No pudimos copiar. Copialo a mano desde la barra.')
    }
  }

  const iconMotion =
    'col-start-1 row-start-1 size-4 transition-[opacity,filter] duration-(--duration-quick) ease-(--ease-ui)'

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={iconOnly ? iconSizeFor(size) : size}
        aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined}
        {...props}
        data-copied={copied ? '' : undefined}
        onClick={copy}
        className={cn(className)}
      >
        <span aria-hidden className="grid shrink-0 place-items-center">
          <Copy
            className={cn(iconMotion, copied ? 'opacity-0 blur-[2px]' : 'opacity-100 blur-none')}
          />
          <Check
            className={cn(
              iconMotion,
              'text-success',
              copied ? 'opacity-100 blur-none' : 'opacity-0 blur-[2px]',
            )}
          />
        </span>
        {iconOnly ? null : copied ? copiedLabel : label}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </>
  )
}
