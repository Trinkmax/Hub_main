'use client'

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PosTopbar } from '@/components/pos/ui/pos-topbar'
import { posFont } from '@/lib/pos/font'
import { cn } from '@/lib/utils'
import '@/components/pos/order/order.css'

/** La mesa del link ya no está abierta (se cobró, se juntó con otra o el link es viejo). */
export default function PosOrderNotFound() {
  const params = useParams<{ tenantSlug: string }>()
  const map = `/${params.tenantSlug}/salon/mapa`
  return (
    <div className={cn('pos', posFont.variable)}>
      <div className="cmd" data-picker="closed">
        <PosTopbar>
          <Link href={map} className="cmd-back" aria-label="Volver al salón">
            <ChevronLeft aria-hidden strokeWidth={2.4} />
          </Link>
          <span className="cmd-title">Salón</span>
        </PosTopbar>
        <div className="cmd-main cmd-gone">
          <h1>Esa mesa ya no está abierta</h1>
          <p>Puede que la hayan cobrado o pasado a otra mesa. Buscala en el salón.</p>
          <Link href={map} className="pos-btn">
            Volver al salón
          </Link>
        </div>
      </div>
    </div>
  )
}
