'use client'

import { Ellipsis, FilePlus2, HandCoins, Tag } from 'lucide-react'
import Link from 'next/link'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSupplierAccountPicker } from './supplier-account-picker'

/**
 * Las acciones de un proveedor desde la lista (pedido de los socios,
 * 12/10/2026, que trabajan con cuenta corriente): [⋯] → Cargar compra · Pagar
 * · Elegir cuenta. Un menú y no dos botones: la fila ya lleva el saldo, el
 * vencido y el estado, y en el celular tiene que seguir leyéndose. La
 * contadora no lo ve.
 */
export function SupplierRowMenu({
  partyId,
  name,
  buyHref,
  canPay,
  account,
}: {
  partyId: string
  name: string
  /** La factura de compra con este proveedor ya elegido. `null`: está desactivado. */
  buyHref: string | null
  /** Hay algo para pagarle o está activo (un pago a cuenta). */
  canPay: boolean
  /** `pick` le falta la cuenta · `change` ya tiene · `null` se elige desde su ficha. */
  account: 'pick' | 'change' | null
}) {
  const { readOnly, openAction } = useAccounting()
  const picker = useSupplierAccountPicker()
  const accountItem = picker && account ? account : null
  if (readOnly || (!buyHref && !canPay && !accountItem)) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 shrink-0 md:size-8"
          aria-label={`Acciones con ${name}`}
        >
          <Ellipsis className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {buyHref ? (
          <DropdownMenuItem asChild className="min-h-11 gap-2 md:min-h-8">
            <Link href={buyHref}>
              <FilePlus2 className="size-4" aria-hidden />
              Cargar compra
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canPay ? (
          <DropdownMenuItem
            className="min-h-11 gap-2 md:min-h-8"
            onSelect={() => openAction('pagar', { proveedor: partyId })}
          >
            <HandCoins className="size-4" aria-hidden />
            Pagar
          </DropdownMenuItem>
        ) : null}
        {accountItem ? (
          <>
            {buyHref || canPay ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              className="min-h-11 gap-2 md:min-h-8"
              onSelect={() => picker?.pick(partyId)}
            >
              <Tag className="size-4" aria-hidden />
              {accountItem === 'pick' ? 'Elegir cuenta' : 'Cambiar la cuenta'}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
