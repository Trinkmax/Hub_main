'use client'

import { Download, Ellipsis, FileMinus2, FilePlus2, HandCoins, Plus } from 'lucide-react'
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
import { downloadExport } from '../../../_components/export-button'

/**
 * Las acciones de la ficha de un proveedor (H.7): [Pagar] · [Nueva factura] ·
 * [⋯] (Nuevo gasto con este proveedor · Nueva nota de crédito · Exportar
 * estado de cuenta). La contadora solo ve «Exportar».
 */
export function SupplierActions({
  partyId,
  partyName,
  newInvoiceHref,
  newCreditNoteHref,
  exportHref,
  exportFileName,
  canPay,
}: {
  partyId: string
  partyName: string
  newInvoiceHref: string
  newCreditNoteHref: string
  exportHref: string
  exportFileName: string
  /** Hay algo para pagar o es un proveedor activo (si no, «Pagar» no se ofrece). */
  canPay: boolean
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
        className="h-11 gap-2 md:h-8"
        aria-busy={exporting}
        onClick={() => void runExport()}
      >
        <Download className="size-3.5" aria-hidden />
        {exporting ? 'Preparando…' : 'Exportar estado de cuenta'}
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      {canPay ? (
        <Button
          type="button"
          size="sm"
          className="h-11 gap-2 md:h-8"
          onClick={() => openAction('pagar', { proveedor: partyId })}
        >
          <HandCoins className="size-3.5" aria-hidden />
          Pagar
        </Button>
      ) : null}
      <Button asChild variant="outline" size="sm" className="h-11 gap-2 md:h-8">
        <Link href={newInvoiceHref}>
          <FilePlus2 className="size-3.5" aria-hidden />
          Nueva factura
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 md:size-8"
            aria-label={`Más acciones con ${partyName}`}
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem
            className="min-h-11 gap-2 md:min-h-8"
            onSelect={() => openAction('gasto', { proveedor: partyId })}
          >
            <Plus className="size-4" aria-hidden />
            Nuevo gasto con este proveedor
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="min-h-11 gap-2 md:min-h-8">
            <Link href={newCreditNoteHref}>
              <FileMinus2 className="size-4" aria-hidden />
              Nueva nota de crédito
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="min-h-11 gap-2 md:min-h-8"
            disabled={exporting}
            onSelect={() => void runExport()}
          >
            <Download className="size-4" aria-hidden />
            Exportar estado de cuenta
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
