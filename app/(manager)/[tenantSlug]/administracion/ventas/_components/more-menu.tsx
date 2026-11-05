'use client'

import { MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** Un renglón del «⋯»: el mismo aire para un link y para un botón de exportar. */
export const MORE_ITEM =
  'flex min-h-10 w-full items-center justify-start gap-2 rounded-md px-2.5 text-sm font-normal outline-none transition-colors hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:pointer-fine:min-h-8'

/**
 * El «⋯» de una planilla: lo que existe y no se usa todos los días. Es un `Popover` y no un menú
 * porque adentro va `ExportButton`, un botón de verdad que sigue trabajando después de tocarlo.
 */
export function MoreMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 pointer-coarse:size-11"
          aria-label={label}
          title={label}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1.5">
        <div className="grid gap-0.5">{children}</div>
      </PopoverContent>
    </Popover>
  )
}
