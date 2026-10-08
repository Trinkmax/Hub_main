'use client'

import { CalendarCheck, FilePlus2, HandCoins } from 'lucide-react'
import Link from 'next/link'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'

/**
 * Acciones de «Ventas y clientes» (H.9): [Cargar cierre] (principal) ·
 * [Registrar un cobro] · [Factura de venta]. En el celular, el cierre y el
 * cobro viven en la barra de abajo. La contadora no ve nada de esto.
 */
export function VentasHeaderActions({ base }: { base: string }) {
  const { readOnly } = useAccounting()
  if (readOnly) return null
  // Desde 1280 px los tres botones van en una fila (la descripción se acomoda);
  // más angosto, se reparten en dos.
  return (
    <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
      <Button asChild className="hidden gap-2 lg:inline-flex">
        <Link href={`${base}/ventas/cierre`}>
          <CalendarCheck className="size-4" aria-hidden />
          Cargar cierre
        </Link>
      </Button>
      <ActionButton action="cobrar" variant="outline" className="hidden gap-2 lg:inline-flex">
        <HandCoins className="size-4" aria-hidden />
        Registrar un cobro
      </ActionButton>
      <Button asChild variant="outline" className="gap-2">
        <Link href={`${base}/ventas/nueva-factura`}>
          <FilePlus2 className="size-4" aria-hidden />
          Factura de venta
        </Link>
      </Button>
    </div>
  )
}
