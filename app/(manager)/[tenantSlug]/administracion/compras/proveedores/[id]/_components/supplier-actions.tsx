'use client'

import { Download, Ellipsis, FileMinus2, ShoppingBasket } from 'lucide-react'
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
const SMALL = 'h-10 md:pointer-fine:h-8'

/**
 * Lo que se hace con un proveedor desde su cuenta corriente: [Compra] y [Pagar] (sin deuda, le deja
 * plata a cuenta). En el ⋯, lo de cada tanto: «Compra y pago», la nota de crédito y el exporte del
 * año.
 *
 * La contadora solo ve el exporte: ningún botón de carga se dibuja.
 */
export function SupplierActions({
  partyId,
  partyName,
  newInvoiceHref,
  paidPurchaseHref,
  newCreditNoteHref,
  exportHref,
  exportFileName,
  canPay,
  canBuy,
  className,
}: {
  partyId: string
  partyName: string
  newInvoiceHref: string
  /** «Compra y pago»: la que se pagó en el momento. */
  paidPurchaseHref: string
  newCreditNoteHref: string
  exportHref: string
  exportFileName: string
  /** Hay algo para pagar o es un proveedor activo (si no, pagar no se ofrece). */
  canPay: boolean
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('gap-1.5', SMALL, className)}
        aria-busy={exporting}
        onClick={() => void runExport()}
      >
        <Download className="size-3.5" aria-hidden />
        {exporting ? 'Preparando…' : 'Exportar su cuenta de este año'}
      </Button>
    )
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {canBuy ? (
        <Button asChild variant="outline" size="sm" className={SMALL}>
          <Link href={newInvoiceHref}>Compra</Link>
        </Button>
      ) : null}
      {canPay ? (
        <Button
          type="button"
          size="sm"
          className={SMALL}
          onClick={() => openAction('pagar', { proveedor: partyId })}
        >
          Pagar
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 text-muted-foreground md:pointer-fine:size-8"
            aria-label={`Más acciones con ${partyName}`}
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {canBuy ? (
            <>
              <DropdownMenuItem asChild className={ITEM}>
                <Link href={paidPurchaseHref}>
                  <ShoppingBasket className="size-4" aria-hidden />
                  Compra y pago
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className={ITEM}>
                <Link href={newCreditNoteHref}>
                  <FileMinus2 className="size-4" aria-hidden />
                  Me hizo una nota de crédito
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem className={ITEM} disabled={exporting} onSelect={() => void runExport()}>
            <Download className="size-4" aria-hidden />
            Exportar su cuenta de este año
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
