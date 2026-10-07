'use client'

import { Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ConnectButton({
  type,
  tenantSlug,
  disabled = false,
  label,
}: {
  type: 'whatsapp' | 'instagram'
  tenantSlug: string
  disabled?: boolean
  /** Texto alternativo del CTA (ej. "Volver a conectar" cuando el canal está en error). */
  label?: string
}) {
  const href = `/api/meta/${type}/connect?tenant=${encodeURIComponent(tenantSlug)}`
  const text = label ?? (type === 'whatsapp' ? 'Conectar mi WhatsApp' : 'Conectar mi Instagram')

  // Sin la app de Meta configurada, el botón queda deshabilitado (no lleva al
  // endpoint que devolvería un error) — la card explica qué falta.
  if (disabled) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled className="gap-2">
          <Plug className="size-4" aria-hidden />
          {text}
        </Button>
        <span className="text-xs text-muted-foreground">
          Se habilita cuando la plataforma termine la configuración de Meta.
        </span>
      </div>
    )
  }

  return (
    <Button asChild className="gap-2">
      <a href={href}>
        <Plug className="size-4" aria-hidden />
        {text}
      </a>
    </Button>
  )
}
