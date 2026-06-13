'use client'

import { Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ConnectButton({
  type,
  tenantSlug,
  disabled = false,
}: {
  type: 'whatsapp' | 'instagram'
  tenantSlug: string
  disabled?: boolean
}) {
  const href = `/api/meta/${type}/connect?tenant=${encodeURIComponent(tenantSlug)}`
  const label = type === 'whatsapp' ? 'Conectar WhatsApp' : 'Conectar Instagram'

  // Sin la app de Meta configurada, el botón queda deshabilitado (no lleva al
  // endpoint que devolvería un error) — la card explica qué falta.
  if (disabled) {
    return (
      <Button disabled className="gap-2">
        <Plug className="size-4" />
        {label}
      </Button>
    )
  }

  return (
    <Button asChild className="gap-2">
      <a href={href}>
        <Plug className="size-4" />
        {label}
      </a>
    </Button>
  )
}
