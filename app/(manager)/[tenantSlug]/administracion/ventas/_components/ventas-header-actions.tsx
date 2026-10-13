'use client'

import { CalendarCheck, HandCoins } from 'lucide-react'
import Link from 'next/link'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'

/**
 * Acciones de «Ventas y clientes» (H.9): [Cargar cierre] (principal) ·
 * [Registrar un cobro]. En el celular las dos viven en la barra de abajo. La
 * contadora no ve nada de esto. La factura de venta suelta ya no se ofrece
 * (pedido de los socios, 12/10/2026): los eventos se facturan con el cierre
 * del día.
 */
export function VentasHeaderActions({ base }: { base: string }) {
  const { readOnly } = useAccounting()
  if (readOnly) return null
  return (
    <div className="hidden items-center gap-2 lg:flex">
      <Button asChild className="gap-2">
        <Link href={`${base}/ventas/cierre`}>
          <CalendarCheck className="size-4" aria-hidden />
          Cargar cierre
        </Link>
      </Button>
      <ActionButton action="cobrar" variant="outline" className="gap-2">
        <HandCoins className="size-4" aria-hidden />
        Registrar un cobro
      </ActionButton>
    </div>
  )
}
