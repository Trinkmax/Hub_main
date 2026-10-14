'use client'

import {
  Download,
  Ellipsis,
  FileMinus2,
  FilePlus2,
  HandCoins,
  PiggyBank,
  ShoppingBasket,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { useAccounting } from '@/components/administracion/accounting-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { downloadExport } from '../../../_components/export-button'

const ITEM = 'min-h-11 gap-2 md:min-h-8'

/**
 * La acción del momento en la tapa de un proveedor, grande y al lado del
 * número: con deuda, [Pagarle] (y [Cargarle una compra] al costado); sin
 * deuda, [Cargarle una compra] pasa a ser la principal.
 *
 * En el ⋯ queda lo de cada tanto: «Le pagué algo recién» (un gasto ya pago con
 * este proveedor), «Me hizo una nota de crédito», «Dejarle plata a cuenta»
 * (cuando no hay deuda) y el exporte de su libreta del año.
 *
 * La contadora solo ve el exporte: ningún botón de carga se dibuja.
 */
export function SupplierActions({
  partyId,
  partyName,
  newInvoiceHref,
  newCreditNoteHref,
  exportHref,
  exportFileName,
  canPay,
  hasDebt,
  canBuy,
  className,
}: {
  partyId: string
  partyName: string
  newInvoiceHref: string
  newCreditNoteHref: string
  exportHref: string
  exportFileName: string
  /** Hay algo para pagar o es un proveedor activo (si no, pagar no se ofrece). */
  canPay: boolean
  /** Le debés algo: [Pagarle] es el botón principal. */
  hasDebt: boolean
  /** Está activo: se le puede cargar una compra. */
  canBuy: boolean
  className?: string
}) {
  const { readOnly, openAction } = useAccounting()
  const [exporting, setExporting] = useState(false)

  const runExport = async () => {
    if (exporting) return
    setExporting(true)
    const outcome = await downloadExport(exportHref, exportFileName)
    setExporting(false)
    if (!outcome.ok) toast.error(outcome.message)
  }

  if (readOnly) {
    return (
      <div className={className}>
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-2 rounded-full px-5"
          aria-busy={exporting}
          onClick={() => void runExport()}
        >
          <Download className="size-4" aria-hidden />
          {exporting ? 'Preparando…' : 'Exportar su libreta de este año'}
        </Button>
      </div>
    )
  }

  const payFirst = hasDebt && canPay
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {payFirst ? (
        <Button
          type="button"
          // En el celular ocupa su renglón: abajo quedan «Cargarle una compra» y el ⋯ juntos.
          className="h-12 w-full gap-2 rounded-full px-6 text-base sm:w-auto"
          onClick={() => openAction('pagar', { proveedor: partyId })}
        >
          <HandCoins className="size-4" aria-hidden />
          Pagarle
        </Button>
      ) : null}
      {canBuy ? (
        <Button
          asChild
          variant={payFirst ? 'outline' : 'default'}
          className={cn(
            'gap-2 rounded-full',
            payFirst ? 'h-12 flex-1 px-5 sm:flex-none' : 'h-12 flex-1 px-6 text-base sm:flex-none',
          )}
        >
          <Link href={newInvoiceHref}>
            <FilePlus2 className="size-4" aria-hidden />
            Cargarle una compra
          </Link>
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-12 shrink-0 rounded-full"
            aria-label={`Más acciones con ${partyName}`}
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {canBuy ? (
            <>
              <DropdownMenuItem
                className={ITEM}
                onSelect={() => openAction('gasto', { proveedor: partyId })}
              >
                <ShoppingBasket className="size-4" aria-hidden />
                Le pagué algo recién
              </DropdownMenuItem>
              <DropdownMenuItem asChild className={ITEM}>
                <Link href={newCreditNoteHref}>
                  <FileMinus2 className="size-4" aria-hidden />
                  Me hizo una nota de crédito
                </Link>
              </DropdownMenuItem>
            </>
          ) : null}
          {canPay && !hasDebt ? (
            <DropdownMenuItem
              className={ITEM}
              onSelect={() => openAction('pagar', { proveedor: partyId })}
            >
              <PiggyBank className="size-4" aria-hidden />
              Dejarle plata a cuenta
            </DropdownMenuItem>
          ) : null}
          {canBuy || (canPay && !hasDebt) ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem className={ITEM} disabled={exporting} onSelect={() => void runExport()}>
            <Download className="size-4" aria-hidden />
            Exportar su libreta de este año
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
