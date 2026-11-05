'use client'

import { Ellipsis } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * El «⋯» de la barra: las dos vistas que dejaron de ser pestañas. Es un componente de cliente a
 * propósito: con el botón armado en el servidor, `asChild` no lo llega a ver al dibujar la página y el
 * HTML sale sin él.
 */
export function ChartMoreMenu({ path }: { path: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 md:pointer-fine:size-8"
          aria-label="Más opciones del plan de cuentas"
        >
          <Ellipsis className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild className="min-h-11 md:min-h-8">
          <Link href={`${path}?tab=sistema`}>Cuentas del sistema</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-11 md:min-h-8">
          <Link href={`${path}?tab=categorias`}>Ver por categorías</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
