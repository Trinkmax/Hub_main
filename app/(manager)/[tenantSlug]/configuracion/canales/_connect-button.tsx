'use client'

import { Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ConnectButton({
  type,
  tenantSlug,
}: {
  type: 'whatsapp' | 'instagram'
  tenantSlug: string
}) {
  const href = `/api/meta/${type}/connect?tenant=${encodeURIComponent(tenantSlug)}`
  const label = type === 'whatsapp' ? 'Conectar WhatsApp' : 'Conectar Instagram'
  return (
    <Button asChild className="gap-2">
      <a href={href}>
        <Plug className="size-4" />
        {label}
      </a>
    </Button>
  )
}
