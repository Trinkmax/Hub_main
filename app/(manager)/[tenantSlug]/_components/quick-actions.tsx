import { CalendarPlus } from 'lucide-react'
import Link from 'next/link'
import { AwardPointsSheet } from '@/components/loyalty/award-points-sheet'
import { Button } from '@/components/ui/button'

/**
 * Lo que el dueño hace más seguido apenas abre el panel, a un toque: sumarle puntos a alguien (la
 * hoja se abre acá mismo, con la cámara en el celular) y cargar una reserva.
 */
export function QuickActions({ tenantSlug }: { tenantSlug: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <AwardPointsSheet tenantSlug={tenantSlug} />
      <Button asChild variant="outline" className="gap-2">
        <Link href={`/${tenantSlug}/reservas/nuevo`}>
          <CalendarPlus className="size-4" aria-hidden />
          Nueva reserva
        </Link>
      </Button>
    </div>
  )
}
