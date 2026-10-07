'use client'

import { ArrowLeftRight, ChevronDown, Landmark, Scale } from 'lucide-react'
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
 * Acciones de «Cajas y bancos» (H.11): [Mover plata] (principal) · [Ajustar
 * saldo] · [Más ▾]. En el celular, Mover y Ajustar viven en la barra de abajo;
 * acá queda «Gasto bancario», que no está en la barra. La contadora no ve nada.
 */
export function CajasHeaderActions({ base }: { base: string }) {
  const { readOnly, openAction } = useAccounting()
  if (readOnly) return null
  return (
    <>
      <ActionButton action="mover" className="hidden gap-2 lg:inline-flex">
        <ArrowLeftRight className="size-4" aria-hidden />
        Mover plata
      </ActionButton>
      <ActionButton action="ajustar" variant="outline" className="hidden gap-2 lg:inline-flex">
        <Scale className="size-4" aria-hidden />
        Ajustar saldo
      </ActionButton>
      <Button asChild variant="outline" className="gap-2 lg:hidden">
        <Link href={`${base}/cajas/gasto-bancario`}>
          <Landmark className="size-4" aria-hidden />
          Gasto bancario
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="hidden gap-1.5 lg:inline-flex">
            Más
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem asChild className="min-h-9">
            <Link href={`${base}/cajas/gasto-bancario`}>Gasto bancario o impuesto debitado</Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-9" onSelect={() => openAction('movimiento')}>
            Otro ingreso o egreso
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="min-h-9">
            <Link href={`${base}/ajustes?tab=cajas`}>Agregar caja o cuenta</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
