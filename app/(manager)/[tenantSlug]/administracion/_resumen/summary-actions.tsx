'use client'

import { BookText, ChevronDown, Plus, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { ActionButton } from '@/components/administracion/quick-actions'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Acciones del encabezado del Resumen (H.4). Dueño: [Más ▾] [Cierre del día]
 * [Nuevo gasto] en la compu (en el celular las acciones van en la barra de
 * abajo y acá queda solo Ajustes). Contadora: [Ajustes] [Libros del mes].
 */
export function SummaryActions({ base }: { base: string }) {
  const { readOnly, openAction } = useAccounting()

  if (readOnly) {
    return (
      <>
        <Button asChild variant="outline" className="h-11 gap-2 md:h-9">
          <Link href={`${base}/ajustes`}>
            <Settings2 className="size-4" aria-hidden />
            Ajustes
          </Link>
        </Button>
        <Button asChild className="h-11 gap-2 md:h-9">
          <Link href={`${base}/libros`}>
            <BookText className="size-4" aria-hidden />
            Libros del mes
          </Link>
        </Button>
      </>
    )
  }

  return (
    <>
      <Button asChild variant="outline" className="h-11 gap-2 lg:hidden">
        <Link href={`${base}/ajustes`}>
          <Settings2 className="size-4" aria-hidden />
          Ajustes
        </Link>
      </Button>
      <div className="hidden items-center gap-2 lg:flex">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="gap-1.5">
              Más
              <ChevronDown className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => openAction('pagar')}>
              Pagar a un proveedor
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAction('cobrar')}>
              Registrar un cobro
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAction('mover')}>Mover plata</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAction('ajustar')}>
              Ajustar saldo de una caja
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`${base}/compras/nueva`}>Factura de proveedor</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`${base}/libros/asiento-manual`}>Asiento manual</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`${base}/ajustes`}>Ajustes</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button asChild variant="outline">
          <Link href={`${base}/ventas/cierre`}>Cierre del día</Link>
        </Button>
        <ActionButton action="gasto" className="gap-2">
          <Plus className="size-4" aria-hidden />
          Nuevo gasto
        </ActionButton>
      </div>
    </>
  )
}
