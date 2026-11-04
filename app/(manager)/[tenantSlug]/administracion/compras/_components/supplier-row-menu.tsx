'use client'

import { BookOpen, Ellipsis, FilePlus2, HandCoins, ShoppingBasket, Tag } from 'lucide-react'
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

const ITEM = 'min-h-11 gap-2 md:min-h-8'

/**
 * El ⋯ de un proveedor en la planilla: lo que no es LA acción del momento (esa
 * es [Pagar], que va afuera, al lado del saldo). Cargarle una compra, una compra
 * que ya se le pagó, pagarle o dejarle plata a cuenta, elegir su categoría y
 * abrir su cuenta corriente. Las mismas reglas de siempre (`supplierRowActions`);
 * la contadora no lo ve.
 */
export function SupplierRowMenu({
  partyId,
  name,
  buyHref,
  paidHref,
  canPay,
  hasDebt,
  account,
  libretaHref,
}: {
  partyId: string
  name: string
  /** La compra con este proveedor ya elegido. `null`: está desactivado. */
  buyHref: string | null
  /** «Compra y pago»: la misma, ya pagada. `null`: está desactivado. */
  paidHref: string | null
  /** Hay algo para pagarle o está activo (plata a cuenta). */
  canPay: boolean
  /** Le debés algo: «Pagarle». Si no, «Dejarle plata a cuenta». */
  hasDebt: boolean
  /** `pick` le falta la categoría · `change` ya tiene · `null` se elige desde su hoja. */
  account: 'pick' | 'change' | null
  /** Su hoja. */
  libretaHref: string
}) {
  const { readOnly, openAction } = useAccounting()
  const picker = useSupplierAccountPicker()
  const accountItem = picker && account ? account : null
  if (readOnly) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 rounded-md text-muted-foreground hover:text-foreground md:pointer-fine:size-7"
          aria-label={`Más acciones con ${name}`}
        >
          <Ellipsis className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {buyHref ? (
          <>
            <DropdownMenuItem asChild className={ITEM}>
              <Link href={buyHref}>
                <FilePlus2 className="size-4" aria-hidden />
                Compra
              </Link>
            </DropdownMenuItem>
            {paidHref ? (
              <DropdownMenuItem asChild className={ITEM}>
                <Link href={paidHref}>
                  <ShoppingBasket className="size-4" aria-hidden />
                  Compra y pago
                </Link>
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
        {canPay ? (
          <DropdownMenuItem
            className={ITEM}
            onSelect={() => openAction('pagar', { proveedor: partyId })}
          >
            <HandCoins className="size-4" aria-hidden />
            {hasDebt ? 'Pagarle' : 'Dejarle plata a cuenta'}
          </DropdownMenuItem>
        ) : null}
        {buyHref || canPay ? <DropdownMenuSeparator /> : null}
        {accountItem ? (
          <DropdownMenuItem className={ITEM} onSelect={() => picker?.pick(partyId)}>
            <Tag className="size-4" aria-hidden />
            {accountItem === 'pick' ? 'Elegir categoría' : 'Cambiar la categoría'}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild className={ITEM}>
          <Link href={libretaHref}>
            <BookOpen className="size-4" aria-hidden />
            Ver su cuenta corriente
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
