'use client'

import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Copiar al portapapeles con confirmación visible.
 *
 * Existe porque el mismo gesto estaba escrito cuatro veces en la app, cada una
 * con su propio manejo (o falta de manejo) del caso en que `navigator.clipboard`
 * no está disponible — pasa en http sin TLS y en algunos WebViews.
 */
export function CopyButton({
  value,
  label = 'Copiar',
  copiedLabel = 'Copiado',
  variant = 'outline',
  size = 'sm',
  className,
  iconOnly = false,
}: {
  value: string
  label?: string
  copiedLabel?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  className?: string
  iconOnly?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timeout.current) clearTimeout(timeout.current)
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timeout.current) clearTimeout(timeout.current)
      timeout.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      // Sin permiso de portapapeles (http, WebView): al menos que el texto se
      // pueda seleccionar a mano en vez de fallar en silencio.
      toast.error('No pudimos copiar. Copialo a mano desde la barra.')
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? 'icon' : size}
      onClick={copy}
      aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined}
      className={cn(className)}
    >
      {copied ? (
        <Check className="size-4 text-success" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
      {iconOnly ? null : copied ? copiedLabel : label}
    </Button>
  )
}
