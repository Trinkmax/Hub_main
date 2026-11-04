'use client'

import { Download, Ellipsis, ListPlus, Tags } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
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
 * El «⋯» de arriba de la planilla de proveedores: lo de cada tanto. La contadora solo exporta.
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
  const [listOpen, setListOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const runExport = async () => {
    if (exporting) return
    setExporting(true)
    const outcome = await downloadExport(exportHref, exportFileName)
    setExporting(false)
    if (!outcome.ok) toast.error(outcome.message)
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
              <DropdownMenuItem className={ITEM} onSelect={() => setListOpen(true)}>
                <ListPlus className="size-4" aria-hidden />
                Agregar de una lista
              </DropdownMenuItem>
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
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem className={ITEM} disabled={exporting} onSelect={() => void runExport()}>
            <Download className="size-4" aria-hidden />
            {exporting ? 'Preparando…' : 'Exportar saldos'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {canWrite ? (
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
