'use client'

import { Download, Ellipsis, ListPlus, Tags } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { useAccountingOptional } from '@/components/administracion/accounting-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BulkSuppliersDialog } from './bulk-suppliers-dialog'
import { downloadExport } from './export-button'

const ITEM = 'min-h-11 gap-2 md:min-h-8'

/**
 * El «⋯» de arriba de la planilla de proveedores: lo de cada tanto. La contadora solo exporta. Con el
 * nivel «solo compras y pagos» no hay menú: el alta masiva y el exporte son del nivel completo, y lo
 * único que queda («Clasificar», con cuántos faltan) va como botón cuando hay alguno sin categoría.
 */
export function SuppliersMenu({
  tenantSlug,
  canWrite,
  existingNames,
  classifyHref,
  unclassified,
  exportHref,
  exportFileName,
}: {
  tenantSlug: string
  canWrite: boolean
  /** Los nombres ya cargados (para no repetirlos al pegar una lista). */
  existingNames: readonly string[]
  /** «Clasificar proveedores»: el mazo de fichas. */
  classifyHref: string
  /** Cuántos faltan clasificar. */
  unclassified: number
  exportHref: string
  exportFileName: string
}) {
  const buyer = useAccountingOptional()?.purchasesOnly === true
  const [listOpen, setListOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const runExport = async () => {
    if (exporting) return
    setExporting(true)
    const outcome = await downloadExport(exportHref, exportFileName)
    setExporting(false)
    if (!outcome.ok) toast.error(outcome.message)
  }

  // Con «solo compras y pagos» el menú tendría un solo renglón: va directo, y solo si hay a quién
  // clasificar (si no, no hay nada que ofrecer).
  if (buyer) {
    if (!canWrite || unclassified <= 0) return null
    return (
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="h-10 gap-1.5 text-muted-foreground hover:text-foreground md:pointer-fine:h-8"
      >
        <Link href={classifyHref}>
          <Tags className="size-4" aria-hidden />
          Clasificar
          <span className="rounded-full bg-secondary px-1.5 text-xs tabular-nums text-foreground">
            {unclassified}
          </span>
        </Link>
      </Button>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 text-muted-foreground hover:text-foreground md:pointer-fine:size-8"
            aria-label="Más opciones de proveedores"
            aria-busy={exporting}
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {canWrite ? (
            <>
              {buyer ? null : (
                <DropdownMenuItem className={ITEM} onSelect={() => setListOpen(true)}>
                  <ListPlus className="size-4" aria-hidden />
                  Agregar de una lista
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild className={ITEM}>
                <Link href={classifyHref}>
                  <Tags className="size-4" aria-hidden />
                  <span className="flex-1">Clasificar proveedores</span>
                  {unclassified > 0 ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {unclassified}
                    </span>
                  ) : null}
                </Link>
              </DropdownMenuItem>
              {buyer ? null : <DropdownMenuSeparator />}
            </>
          ) : null}
          {buyer ? null : (
            <DropdownMenuItem
              className={ITEM}
              disabled={exporting}
              onSelect={() => void runExport()}
            >
              <Download className="size-4" aria-hidden />
              {exporting ? 'Preparando…' : 'Exportar saldos'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canWrite && !buyer ? (
        <BulkSuppliersDialog
          tenantSlug={tenantSlug}
          existingNames={existingNames}
          open={listOpen}
          onOpenChange={setListOpen}
        />
      ) : null}
    </>
  )
}
